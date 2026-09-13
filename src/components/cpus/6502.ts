import type { Ram } from "../memory/ram.js";
import { checkUnsigned } from "../validation.js";

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
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>> = {
    0x18: () => this.#clearCarry(), // CLC
    0x48: ({ writeByte }) => this.#pushByte(this.#state.a, writeByte), // PHA
    0x68: ({ readByte }) => this.#loadAccumulator(this.#pullByte(readByte)), // PLA
    0x69: ({ fetchByte }) => this.#addWithCarry(fetchByte()), // ADC #n (binary)
    0x85: ({ fetchByte, writeByte }) => writeByte(fetchByte(), this.#state.a), // STA zp
    0x8d: ({ fetchWord, writeByte }) => writeByte(fetchWord(), this.#state.a), // STA addr
    0xa5: ({ fetchByte, readByte }) => this.#loadAccumulator(readByte(fetchByte())), // LDA zp
    0xa9: ({ fetchByte }) => this.#loadAccumulator(fetchByte()), // LDA #n
  };

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
    const decimalModeUnsupported = opcode === 0x69 && this.#state.flags.d;
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

  #pushByte(value: number, writeByte: InstructionContext["writeByte"]): void {
    writeByte(0x0100 | this.#state.sp, value);
    this.#state.sp = (this.#state.sp - 1) & 0xff;
  }

  #pullByte(readByte: InstructionContext["readByte"]): number {
    this.#state.sp = (this.#state.sp + 1) & 0xff;
    return readByte(0x0100 | this.#state.sp);
  }

  #clearCarry(): void {
    this.#state.flags.c = false;
  }

  #loadAccumulator(value: number): void {
    this.#state.a = value;
    this.#state.flags.n = (value & 0x80) !== 0;
    this.#state.flags.z = value === 0;
  }

  #addWithCarry(value: number): void {
    const accumulator = this.#state.a;
    const sum = accumulator + value + (this.#state.flags.c ? 1 : 0);
    const result = sum & 0xff;
    this.#loadAccumulator(result);
    this.#state.flags.c = sum > 0xff;
    // Like-signed operands producing an opposite-signed result indicate overflow.
    this.#state.flags.v = (~(accumulator ^ value) & (accumulator ^ result) & 0x80) !== 0;
  }

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
