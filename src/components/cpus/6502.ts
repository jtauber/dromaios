import type { Ram } from "../memory/ram.js";
import { checkUnsigned } from "../validation.js";
import { opcodeFamily, opcodeTable } from "./opcodes.js";

export interface Cpu6502Flags {
  n: boolean;
  v: boolean;
  d: boolean;
  i: boolean;
  z: boolean;
  c: boolean;
}

export interface Cpu6502State {
  a: number;
  x: number;
  y: number;
  sp: number;
  pc: number;
  flags: Cpu6502Flags;
}

export type Cpu6502Snapshot = Readonly<Omit<Cpu6502State, "flags">> & {
  readonly flags: Readonly<Cpu6502Flags>;
};

export interface Cpu6502MemoryAccess {
  readonly kind: "read" | "write";
  readonly address: number;
  readonly value: number;
}

export interface Cpu6502Instruction {
  readonly address: number;
  readonly bytes: readonly number[];
}

export type Cpu6502StepRecord = {
  readonly instruction: Cpu6502Instruction;
  readonly before: Cpu6502Snapshot;
  readonly after: Cpu6502Snapshot;
  readonly accesses: readonly Cpu6502MemoryAccess[];
} & (
  | { readonly outcome: "executed" }
  | { readonly outcome: "unsupported"; readonly reason: "opcode" | "decimal-mode" }
);

export interface Cpu6502ResetRecord {
  readonly before: Cpu6502Snapshot;
  readonly after: Cpu6502Snapshot;
  readonly accesses: readonly Cpu6502MemoryAccess[];
}

interface InstructionContext {
  readonly fetchByte: () => number;
  readonly fetchWord: () => number;
  readonly readByte: (address: number) => number;
  readonly writeByte: (address: number, value: number) => void;
}

type OpcodeHandler = (instruction: InstructionContext) => void;
type ByteRegister = "a" | "x" | "y";

function copyState(state: Cpu6502Snapshot): Cpu6502State {
  const flags = state.flags;
  // Copy declared fields only, including non-enumerable fields and inherited getters.
  return {
    a: state.a,
    x: state.x,
    y: state.y,
    sp: state.sp,
    pc: state.pc,
    flags: { n: flags.n, v: flags.v, d: flags.d, i: flags.i, z: flags.z, c: flags.c },
  };
}

/** Instruction-level NMOS 6502 subset for the 6502 examples. */
export class Cpu6502 {
  readonly #ram: Ram;
  readonly #state: Cpu6502State;

  constructor(ram: Ram, initialState: Cpu6502Snapshot) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 6502 model requires exactly 64 KiB of RAM.");
    }
    const state = copyState(initialState);
    for (const name of ["a", "x", "y", "sp"] as const) {
      checkUnsigned(name, state[name], 0xff);
    }
    checkUnsigned("pc", state.pc, 0xffff);
    for (const name of ["n", "v", "d", "i", "z", "c"] as const) {
      if (typeof state.flags[name] !== "boolean") {
        throw new TypeError(`Flag ${name} must be a boolean.`);
      }
    }
    this.#ram = ram;
    this.#state = state;
  }

  /** Inspect a detached copy, readonly to TypeScript, without accessing RAM. */
  snapshot(): Cpu6502Snapshot {
    return copyState(this.#state);
  }

  /** Reset PC, I, and SP with only the vector reads; preserve other state and RAM. */
  reset(): Cpu6502ResetRecord {
    const before = this.snapshot();
    const accesses: Cpu6502MemoryAccess[] = [];
    const low = this.#read(0xfffc, accesses);
    const high = this.#read(0xfffd, accesses);
    this.#state.pc = low | (high << 8);
    this.#state.flags.i = true;
    this.#state.sp = (this.#state.sp - 3) & 0xff;
    return { before, after: this.snapshot(), accesses };
  }

  /** Attempt one instruction; unsupported opcodes or modes leave all state unchanged. */
  step(): Cpu6502StepRecord {
    const before = this.snapshot();
    const accesses: Cpu6502MemoryAccess[] = [];
    const address = this.#state.pc;
    const opcode = this.#read(address, accesses);
    const bytes = [opcode];
    const handler = this.#opcodeHandlers[opcode];
    // Reject decimal ADC before advancing PC or fetching its operand.
    const decimalModeUnsupported = opcode === 0b011_010_01 && this.#state.flags.d;
    if (handler && !decimalModeUnsupported) {
      // Advance only for supported instructions; operand fetches advance themselves.
      this.#state.pc = (address + 1) & 0xffff;
      const fetchByte = (): number => {
        const pc = this.#state.pc;
        const byte = this.#read(pc, accesses);
        this.#state.pc = (pc + 1) & 0xffff;
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
        readByte: (address) => this.#read(address, accesses),
        writeByte: (address, value) => this.#write(address, value, accesses),
      });
    }

    const record = {
      instruction: { address, bytes },
      before,
      after: this.snapshot(),
      accesses,
    };
    return handler && !decimalModeUnsupported
      ? { ...record, outcome: "executed" }
      : { ...record, outcome: "unsupported", reason: decimalModeUnsupported ? "decimal-mode" : "opcode" };
  }

  // Opcode selectors and construction.

  // Opcode bits: 7 6 5 | 4 3 2 | 1 0 = aaa bbb cc.
  // cc selects a group. In cc=01, aaa selects the operation and bbb its addressing mode.
  // The cc=00 and cc=10 instructions below have their own patterns.
  // Only implemented encodings enter the table; this is not a decoder for every combination.
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // cc=00, bbb=000: aaa=101 selects LDY immediate.
    [0b101_000_00, ({ fetchByte }) => this.#loadRegister("y", fetchByte())], // LDY #n

    // cc=00, bbb=010: 01p 010 00 selects push A (p=0) or pull A (p=1).
    [0b01_0_010_00, ({ writeByte }) => this.#pushByte(this.#state.a, writeByte)], // PHA
    [0b01_1_010_00, ({ readByte }) => this.#loadRegister("a", this.#pullByte(readByte))], // PLA
    // aaa=100..111 selects DEY, TAY, INY, INX in this subgroup.
    [0b100_010_00, () => this.#adjustIndex("y", -1)], // DEY
    [0b101_010_00, () => this.#loadRegister("y", this.#state.a)], // TAY
    [0b110_010_00, () => this.#adjustIndex("y", 1)], // INY
    [0b111_010_00, () => this.#adjustIndex("x", 1)], // INX

    // cc=00, bbb=100: ffv 100 00 selects a flag and the value required to branch.
    // ff (bits 7..6): 00 N, 01 V, 10 C, 11 Z.
    // v (bit 5): 0 clear (BPL/BVC/BCC/BNE), 1 set (BMI/BVS/BCS/BEQ).
    ...opcodeFamily("ff v 100 00", {
      f: ["n", "v", "c", "z"],
      v: [false, true],
    }, ({ f: flag, v: value }) => ({ fetchByte }: InstructionContext) =>
      this.#branch(fetchByte(), this.#state.flags[flag] === value)),

    // cc=00, bbb=110: aaa=000 selects CLC; aaa=100 selects TYA.
    [0b000_110_00, () => this.#clearCarry()], // CLC
    [0b100_110_00, () => this.#loadRegister("a", this.#state.y)], // TYA

    // cc=01: the operations used here are aaa=011 ADC, 100 STA, 101 LDA.
    // bbb=001 selects zero-page addressing.
    [0b100_001_01, ({ fetchByte, writeByte }) => writeByte(fetchByte(), this.#state.a)], // STA zp
    [0b101_001_01, ({ fetchByte, readByte }) => this.#loadRegister("a", readByte(fetchByte()))], // LDA zp

    // bbb=010 selects an immediate operand; STA has no immediate form.
    [0b011_010_01, ({ fetchByte }) => this.#addWithCarry(fetchByte())], // ADC #n (binary)
    [0b101_010_01, ({ fetchByte }) => this.#loadRegister("a", fetchByte())], // LDA #n

    // bbb=011 selects absolute addressing.
    [0b100_011_01, ({ fetchWord, writeByte }) => writeByte(fetchWord(), this.#state.a)], // STA addr

    // cc=10, bbb=000: aaa=101 selects LDX immediate.
    [0b101_000_10, ({ fetchByte }) => this.#loadRegister("x", fetchByte())], // LDX #n

    // cc=10, bbb=010: aaa=100..110 selects TXA, TAX, DEX.
    [0b100_010_10, () => this.#loadRegister("a", this.#state.x)], // TXA
    [0b101_010_10, () => this.#loadRegister("x", this.#state.a)], // TAX
    [0b110_010_10, () => this.#adjustIndex("x", -1)], // DEX
  ]);

  // Loads and register operations.

  #loadRegister(register: ByteRegister, value: number): void {
    this.#state[register] = value;
    this.#state.flags.n = (value & 0x80) !== 0;
    this.#state.flags.z = value === 0;
  }

  #adjustIndex(register: "x" | "y", delta: -1 | 1): void {
    this.#loadRegister(register, (this.#state[register] + delta) & 0xff);
  }

  // Control flow.

  #branch(displacement: number, take: boolean): void {
    // The operand is fetched on either path; PC now points past both instruction bytes.
    if (take) {
      const offset = displacement < 0x80 ? displacement : displacement - 0x100;
      this.#state.pc = (this.#state.pc + offset) & 0xffff;
    }
  }

  // Stack operations.

  #pushByte(value: number, writeByte: InstructionContext["writeByte"]): void {
    writeByte(0x0100 | this.#state.sp, value);
    this.#state.sp = (this.#state.sp - 1) & 0xff;
  }

  #pullByte(readByte: InstructionContext["readByte"]): number {
    this.#state.sp = (this.#state.sp + 1) & 0xff;
    return readByte(0x0100 | this.#state.sp);
  }

  // Arithmetic and flags.

  #clearCarry(): void {
    this.#state.flags.c = false;
  }

  #addWithCarry(value: number): void {
    const accumulator = this.#state.a;
    const sum = accumulator + value + (this.#state.flags.c ? 1 : 0);
    const result = sum & 0xff;
    this.#loadRegister("a", result);
    this.#state.flags.c = sum > 0xff;
    // Like-signed operands producing an opposite-signed result indicate overflow.
    this.#state.flags.v = (~(accumulator ^ value) & (accumulator ^ result) & 0x80) !== 0;
  }

  // Recorded memory access.

  #read(address: number, accesses: Cpu6502MemoryAccess[]): number {
    const value = this.#ram.read(address);
    accesses.push({ kind: "read", address, value });
    return value;
  }

  #write(address: number, value: number, accesses: Cpu6502MemoryAccess[]): void {
    this.#ram.write(address, value);
    accesses.push({ kind: "write", address, value });
  }
}
