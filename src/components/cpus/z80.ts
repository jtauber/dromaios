import type { Ram } from "../memory/ram.js";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { defineState, copyState, readState, unsigned, flag, boolean, choices, group } from "./state.ts";
import type { StateDescription } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.js";
import { add8 } from "./alu.ts";

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

const bankFields = defineState({
  a: unsigned(8), b: unsigned(8), c: unsigned(8), d: unsigned(8), e: unsigned(8), h: unsigned(8), l: unsigned(8),
  flags: group({ s: flag, z: flag, h: flag, pv: flag, n: flag, c: flag }),
} satisfies StateDescription<CpuZ80RegisterBank>);

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpuZ80StateDescription = defineState({
  ...bankFields, alternate: group(bankFields),
  ix: unsigned(16), iy: unsigned(16), pc: unsigned(16), sp: unsigned(16), i: unsigned(8), r: unsigned(8),
  iff1: boolean, iff2: boolean, im: choices(0, 1, 2), halted: boolean,
} satisfies StateDescription<CpuZ80State>);

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

export type CpuZ80MemoryAccess = MemoryAccess;

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

type OpcodeHandler = (instruction: InstructionContext) => void;
type ByteRegister = "a" | "b" | "c" | "d" | "e" | "h" | "l";
type ByteOperand = ByteRegister | "(hl)";
type RegisterPair = readonly [ByteRegister, ByteRegister] | "sp";

function pairViews(bank: CpuZ80RegisterBank): { readonly bc: number; readonly de: number; readonly hl: number } {
  return { bc: (bank.b << 8) | bank.c, de: (bank.d << 8) | bank.e, hl: (bank.h << 8) | bank.l };
}

/** Instruction-level Zilog Z80 subset with documented flags and opcode-fetch R updates. */
export class CpuZ80 {
  readonly #ram: Ram;
  readonly #state: CpuZ80State;

  constructor(ram: Ram, initialState: CpuZ80State) {
    if (ram.size !== 0x10000) throw new RangeError("The Z80 model requires exactly 64 KiB of RAM.");
    this.#ram = ram;
    this.#state = readState(cpuZ80StateDescription, initialState);
  }

  /** Inspect detached register banks and their derived pair views without reading RAM. */
  snapshot(): CpuZ80Snapshot {
    const state = copyState(cpuZ80StateDescription, this.#state);
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
    const { accesses, readByte, writeByte } = recordMemory(this.#ram);
    const address = this.#state.pc;
    const opcode = readByte(address);
    const bytes = [opcode];
    const handler = this.#opcodeHandlers[opcode];
    if (handler) {
      this.#state.pc = (address + 1) & 0xffff;
      // Only the opcode fetch increments R; operand fetches are ordinary reads.
      this.#state.r = (this.#state.r & 0x80) | ((this.#state.r + 1) & 0x7f);
      const fetchByte = (): number => {
        const byte = readByte(this.#state.pc);
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
        readByte,
        writeByte,
      });
    }
    const record = { instruction: { address, bytes }, before, after: this.snapshot(), accesses };
    return handler
      ? { ...record, outcome: this.#state.halted ? "halted" : "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
  }

  // Register views.

  get #hl(): number {
    return (this.#state.h << 8) | this.#state.l;
  }

  // Opcode selectors and construction.

  // rrr/ddd/sss select B/C/D/E/H/L/(HL)/A in order; 110 addresses RAM through HL.
  readonly #byteOperands = ["b", "c", "d", "e", "h", "l", "(hl)", "a"] as const;

  // pp selects BC/DE/HL/SP. Pairs name their high and low stored bytes.
  readonly #registerPairs = [["b", "c"], ["d", "e"], ["h", "l"], "sp"] as const;

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
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // xx=00, zzz=000: yyy=010 selects DJNZ, 011 JR, and 1cc conditional JR.
    // yyy=000 (NOP) and 001 (EX AF,AF') remain unsupported.
    ...opcodePattern("00 010 000", ({ fetchByte }: InstructionContext) => this.#decrementAndJump(fetchByte())), // DJNZ e
    ...opcodePattern("00 011 000", ({ fetchByte }: InstructionContext) => this.#jumpRelative(fetchByte(), true)), // JR e
    ...opcodeFamily("00 1cc 000", { c: this.#relativeConditions }, ({ c: condition }) => ({ fetchByte }: InstructionContext) => this.#jumpRelative(fetchByte(), condition())), // JR NZ/Z/NC/C,e

    // 00 pp q 001: pp (bits 5..4) selects the pair; q=0 loads nn (low byte first).
    ...opcodeFamily("00 pp 0 001", { p: this.#registerPairs }, ({ p: pair }) => ({ fetchWord }: InstructionContext) => this.#loadPair(pair, fetchWord())), // LD dd,nn

    // xx=00, zzz=010: pp=11 selects A at address nn; q=0 stores (q=1 would load).
    ...opcodePattern("00 11 0 010", ({ fetchWord, writeByte }: InstructionContext) => writeByte(fetchWord(), this.#state.a)), // LD (nn),A

    // 00 rrr zzz: rrr (bits 5..3) selects the byte register; zzz selects the operation.
    // rrr=110 selects (HL); INC/DEC omit that slot, while LD includes it.
    ...this.#byteRegisterHandlers(0b00_000_100, register => this.#adjustRegister(register, 1)), // 00 rrr 100: INC r
    ...this.#byteRegisterHandlers(0b00_000_101, register => this.#adjustRegister(register, -1)), // 00 rrr 101: DEC r
    ...opcodeFamily("00 rrr 110", { r: this.#byteOperands }, ({ r: operand }) => (instruction: InstructionContext) => this.#writeOperand(operand, instruction.fetchByte(), instruction)), // LD r,n / LD (HL),n

    // 01 ddd sss: ddd (bits 5..3) selects destination; sss (bits 2..0) selects source.
    // 01 110 110 is HALT, not LD (HL),(HL); the binding handles this exception.
    ...opcodeFamily("01 ddd sss", { d: this.#byteOperands, s: this.#byteOperands }, ({ d: destination, s: source }) => this.#transferHandler(destination, source)), // LD r,r' / LD r,(HL) / LD (HL),r / HALT

    // xx=10 register/memory ALU forms are not implemented yet.

    // xx=11, zzz=110: 11 ooo 110 selects immediate ALU; ooo=000 is ADD.
    ...opcodePattern("11 000 110", ({ fetchByte }: InstructionContext) => this.#addToAccumulator(fetchByte())), // ADD A,n
  ]);

  #byteRegisterHandlers(
    base: number,
    operation: (register: ByteRegister) => void,
  ): readonly OpcodeEntry<OpcodeHandler>[] {
    const handlers: OpcodeEntry<OpcodeHandler>[] = [];
    for (const [registerCode, register] of this.#byteOperands.entries()) {
      if (register === "(hl)") continue;
      // 00 rrr zzz: rrr occupies bits 5..3; the base supplies the operation's zzz.
      handlers.push([base | (registerCode << 3), () => operation(register)]);
    }
    return handlers;
  }

  #transferHandler(destination: ByteOperand, source: ByteOperand): OpcodeHandler {
    if (destination === "(hl)" && source === "(hl)") return () => this.#halt();
    return instruction => this.#writeOperand(destination, this.#readOperand(source, instruction), instruction);
  }

  // Addressing and loads.

  #readOperand(operand: ByteOperand, { readByte }: InstructionContext): number {
    return operand === "(hl)" ? readByte(this.#hl) : this.#state[operand];
  }

  #writeOperand(operand: ByteOperand, value: number, { writeByte }: InstructionContext): void {
    if (operand === "(hl)") writeByte(this.#hl, value);
    else this.#state[operand] = value;
  }

  #loadPair(pair: RegisterPair, value: number): void {
    if (pair === "sp") this.#state.sp = value;
    else {
      this.#state[pair[0]] = value >>> 8;
      this.#state[pair[1]] = value & 0xff;
    }
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
    const { result, carry, halfCarry, overflow } = add8(this.#state.a, value);
    this.#state.a = result;
    this.#state.flags = {
      s: (result & 0x80) !== 0,
      z: result === 0,
      h: halfCarry,
      pv: overflow,
      n: false,
      c: carry,
    };
  }
}
