import type { Ram } from "../memory/ram.js";
import { checkUnsigned } from "../validation.js";

/** The six documented flags; undocumented F bits 3 and 5 are outside this model. */
export interface CpuZ80Flags {
  s: boolean;
  z: boolean;
  h: boolean;
  pv: boolean;
  n: boolean;
  c: boolean;
}

export interface CpuZ80RegisterBank {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  h: number;
  l: number;
  flags: CpuZ80Flags;
}

export interface CpuZ80State extends CpuZ80RegisterBank {
  alternate: CpuZ80RegisterBank;
  ix: number;
  iy: number;
  pc: number;
  sp: number;
  i: number;
  r: number;
  iff1: boolean;
  iff2: boolean;
  im: 0 | 1 | 2;
  halted: boolean;
}

export type CpuZ80BankSnapshot = Readonly<Omit<CpuZ80RegisterBank, "flags">> & {
  readonly flags: Readonly<CpuZ80Flags>;
  readonly bc: number;
  readonly de: number;
  readonly hl: number;
};

export type CpuZ80Snapshot = CpuZ80BankSnapshot &
  Readonly<Omit<CpuZ80State, keyof CpuZ80RegisterBank | "alternate">> & {
    readonly alternate: CpuZ80BankSnapshot;
  };

export interface CpuZ80MemoryAccess {
  readonly kind: "read" | "write";
  readonly address: number;
  readonly value: number;
}

export interface CpuZ80Instruction {
  readonly address: number;
  readonly bytes: readonly number[];
}

export type CpuZ80StepRecord = {
  readonly before: CpuZ80Snapshot;
  readonly after: CpuZ80Snapshot;
  readonly accesses: readonly CpuZ80MemoryAccess[];
} & (
  | { readonly outcome: "executed"; readonly instruction: CpuZ80Instruction }
  | { readonly outcome: "unsupported"; readonly instruction: CpuZ80Instruction; readonly reason: "opcode" }
  | { readonly outcome: "halted"; readonly instruction: CpuZ80Instruction | null }
);

export interface CpuZ80ResetRecord {
  readonly before: CpuZ80Snapshot;
  readonly after: CpuZ80Snapshot;
  readonly accesses: readonly CpuZ80MemoryAccess[];
}

interface InstructionContext {
  readonly fetchByte: () => number;
  readonly fetchWord: () => number;
  readonly writeByte: (address: number, value: number) => void;
}

type OpcodeHandler = (instruction: InstructionContext) => void;
type ByteRegister = "a" | "b" | "c" | "d" | "e" | "h" | "l";

function copyBank(bank: CpuZ80RegisterBank): CpuZ80RegisterBank {
  const flags = bank.flags;
  // Copy declared stored fields only, ignoring derived views and other metadata.
  return {
    a: bank.a, b: bank.b, c: bank.c, d: bank.d, e: bank.e, h: bank.h, l: bank.l,
    flags: { s: flags.s, z: flags.z, h: flags.h, pv: flags.pv, n: flags.n, c: flags.c },
  };
}

function copyState(state: CpuZ80State): CpuZ80State {
  return {
    ...copyBank(state), alternate: copyBank(state.alternate),
    ix: state.ix, iy: state.iy, pc: state.pc, sp: state.sp, i: state.i, r: state.r,
    iff1: state.iff1, iff2: state.iff2, im: state.im, halted: state.halted,
  };
}

function pairViews(bank: CpuZ80RegisterBank): { readonly bc: number; readonly de: number; readonly hl: number } {
  return { bc: (bank.b << 8) | bank.c, de: (bank.d << 8) | bank.e, hl: (bank.h << 8) | bank.l };
}

/** Instruction-level Zilog Z80 subset with documented flags and opcode-fetch R updates. */
export class CpuZ80 {
  readonly #ram: Ram;
  readonly #state: CpuZ80State;

  constructor(ram: Ram, initialState: CpuZ80State) {
    if (ram.size !== 0x10000) throw new RangeError("The Z80 model requires exactly 64 KiB of RAM.");
    const state = copyState(initialState);
    for (const [label, bank] of [["", state], ["alternate.", state.alternate]] as const) {
      for (const name of ["a", "b", "c", "d", "e", "h", "l"] as const) {
        checkUnsigned(`${label}${name}`, bank[name], 0xff);
      }
      for (const name of ["s", "z", "h", "pv", "n", "c"] as const) {
        if (typeof bank.flags[name] !== "boolean") throw new TypeError(`Flag ${label}${name} must be a boolean.`);
      }
    }
    for (const name of ["ix", "iy", "pc", "sp"] as const) checkUnsigned(name, state[name], 0xffff);
    for (const name of ["i", "r"] as const) checkUnsigned(name, state[name], 0xff);
    checkUnsigned("im", state.im, 2);
    for (const name of ["iff1", "iff2", "halted"] as const) {
      if (typeof state[name] !== "boolean") throw new TypeError(`${name} must be a boolean.`);
    }
    this.#ram = ram;
    this.#state = state;
  }

  /** Inspect detached register banks and their derived pair views without reading RAM. */
  snapshot(): CpuZ80Snapshot {
    const state = copyState(this.#state);
    return { ...state, ...pairViews(state), alternate: { ...state.alternate, ...pairViews(state.alternate) } };
  }

  /** Apply documented reset effects, release HALT, and preserve other stored state and RAM. */
  reset(): CpuZ80ResetRecord {
    const before = this.snapshot();
    this.#state.pc = 0;
    this.#state.i = 0;
    this.#state.r = 0;
    this.#state.iff1 = false;
    this.#state.iff2 = false;
    this.#state.im = 0;
    this.#state.halted = false;
    return { before, after: this.snapshot(), accesses: [] };
  }

  /** Attempt one instruction; unsupported and already halted attempts preserve all state, including R. */
  step(): CpuZ80StepRecord {
    const before = this.snapshot();
    if (this.#state.halted) {
      return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "halted" };
    }
    const accesses: CpuZ80MemoryAccess[] = [];
    const address = this.#state.pc;
    const opcode = this.#read(address, accesses);
    const bytes = [opcode];
    const handler = this.#opcodeHandlers[opcode];
    if (handler) {
      this.#state.pc = (address + 1) & 0xffff;
      // Only the opcode fetch increments R; operand fetches are ordinary reads.
      this.#state.r = (this.#state.r & 0x80) | ((this.#state.r + 1) & 0x7f);
      const fetchByte = (): number => {
        const byte = this.#read(this.#state.pc, accesses);
        this.#state.pc = (this.#state.pc + 1) & 0xffff;
        bytes.push(byte);
        return byte;
      };
      handler({
        fetchByte,
        fetchWord: () => {
          const low = fetchByte();
          const high = fetchByte();
          return low | (high << 8);
        },
        writeByte: (address, value) => this.#write(address, value, accesses),
      });
    }
    const record = { instruction: { address, bytes }, before, after: this.snapshot(), accesses };
    return handler
      ? { ...record, outcome: this.#state.halted ? "halted" : "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
  }

  // Opcode selectors and construction.

  // rrr selects B/C/D/E/H/L/(HL)/A in order. The 110 memory slot is not implemented.
  readonly #byteRegisters = ["b", "c", "d", "e", "h", "l", undefined, "a"] as const;

  // Conditional JR uses just two condition bits: 00 NZ, 01 Z, 10 NC, 11 C.
  readonly #relativeConditions = [
    () => !this.#state.flags.z,
    () => this.#state.flags.z,
    () => !this.#state.flags.c,
    () => this.#state.flags.c,
  ] as const;

  // Unprefixed opcode bits: 7 6 | 5 4 3 | 2 1 0 = xx yyy zzz.
  // xx selects a block; the other fields select its operation and operands.
  // Pair families split yyy into pp q. Prefixed instructions remain unsupported.
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>> = {
    // xx=00, zzz=000: yyy=010 selects DJNZ, 011 JR, and 1cc conditional JR.
    // yyy=000 (NOP) and 001 (EX AF,AF') remain unsupported.
    0b00_010_000: ({ fetchByte }) => this.#decrementAndJump(fetchByte()), // DJNZ e
    0b00_011_000: ({ fetchByte }) => this.#jumpRelative(fetchByte(), true), // JR e
    ...this.#relativeJumpHandlers(), // JR NZ/Z/NC/C,e

    // xx=00, zzz=010: pp=11 selects A at address nn; q=0 stores (q=1 would load).
    0b00_11_0_010: ({ fetchWord, writeByte }) => writeByte(fetchWord(), this.#state.a), // LD (nn),A

    // 00 rrr zzz: rrr (bits 5..3) selects the byte register; zzz selects the operation.
    // rrr=110 selects (HL); these memory forms are omitted.
    ...this.#byteRegisterHandlers(0b00_000_100, register => this.#adjustRegister(register, 1)), // 00 rrr 100: INC r
    ...this.#byteRegisterHandlers(0b00_000_101, register => this.#adjustRegister(register, -1)), // 00 rrr 101: DEC r
    ...this.#byteRegisterHandlers(0b00_000_110, (register, { fetchByte }) =>
      this.#loadRegister(register, fetchByte())), // 00 rrr 110: LD r,n

    // xx=01: 01 ddd sss encodes register/memory loads; 110 selects (HL).
    0b01_110_110: () => this.#halt(), // HALT occupies the (HL),(HL) slot.

    // xx=10 register/memory ALU forms are not implemented yet.

    // xx=11, zzz=110: 11 ooo 110 selects immediate ALU; ooo=000 is ADD.
    0b11_000_110: ({ fetchByte }) => this.#addToAccumulator(fetchByte()), // ADD A,n
  };

  #relativeJumpHandlers(): Partial<Record<number, OpcodeHandler>> {
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [conditionCode, condition] of this.#relativeConditions.entries()) {
      // 00 1 cc 000: cc occupies bits 4..3; bit 5 is fixed at 1.
      const opcode = 0b00_1_00_000 | (conditionCode << 3);
      handlers[opcode] = ({ fetchByte }) => this.#jumpRelative(fetchByte(), condition());
    }
    return handlers;
  }

  #byteRegisterHandlers(
    base: number,
    operation: (register: ByteRegister, instruction: InstructionContext) => void,
  ): Partial<Record<number, OpcodeHandler>> {
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [registerCode, register] of this.#byteRegisters.entries()) {
      if (register === undefined) continue;
      // 00 rrr zzz: rrr occupies bits 5..3; the base supplies the operation's zzz.
      handlers[base | (registerCode << 3)] = instruction => operation(register, instruction);
    }
    return handlers;
  }

  // Loads.

  #loadRegister(register: ByteRegister, value: number): void {
    this.#state[register] = value;
  }

  // Control flow.

  #jumpRelative(displacement: number, take: boolean): void {
    // Both paths fetch the operand; PC now points past both instruction bytes.
    if (take) {
      const offset = displacement < 0x80 ? displacement : displacement - 0x100;
      this.#state.pc = (this.#state.pc + offset) & 0xffff;
    }
  }

  #decrementAndJump(displacement: number): void {
    // DJNZ decrements B without applying DEC's flag changes.
    this.#state.b = (this.#state.b - 1) & 0xff;
    this.#jumpRelative(displacement, this.#state.b !== 0);
  }

  #halt(): void {
    this.#state.halted = true;
  }

  // Arithmetic and flags.

  #adjustRegister(register: ByteRegister, delta: -1 | 1): void {
    const value = this.#state[register];
    const result = (value + delta) & 0xff;
    this.#state[register] = result;
    this.#state.flags.s = (result & 0x80) !== 0;
    this.#state.flags.z = result === 0;
    // INC carries out of bit 3; DEC borrows from bit 4. Both preserve C.
    this.#state.flags.h = delta === 1 ? (value & 0x0f) === 0x0f : (value & 0x0f) === 0;
    this.#state.flags.pv = value === (delta === 1 ? 0x7f : 0x80);
    this.#state.flags.n = delta === -1;
  }

  #addToAccumulator(value: number): void {
    const a = this.#state.a;
    const sum = a + value;
    const result = sum & 0xff;
    this.#state.a = result;
    this.#state.flags = {
      s: (result & 0x80) !== 0,
      z: result === 0,
      h: (a & 0x0f) + (value & 0x0f) > 0x0f,
      pv: (~(a ^ value) & (a ^ result) & 0x80) !== 0,
      n: false,
      c: sum > 0xff,
    };
  }

  // Recorded memory access.

  #read(address: number, accesses: CpuZ80MemoryAccess[]): number {
    const value = this.#ram.read(address);
    accesses.push({ kind: "read", address, value });
    return value;
  }

  #write(address: number, value: number, accesses: CpuZ80MemoryAccess[]): void {
    this.#ram.write(address, value);
    accesses.push({ kind: "write", address, value });
  }
}
