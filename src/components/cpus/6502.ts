import type { Ram } from "../memory/ram.js";

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

interface InstructionContext {
  readonly fetchByte: () => number;
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

function checkUnsigned(name: string, value: number, maximum: number): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 0 to ${maximum}.`);
  }
}

/** Instruction-level NMOS 6502 subset supporting CLC (18) and LDA immediate (A9). */
export class Cpu6502 {
  readonly #ram: Ram;
  readonly #state: Cpu6502State;
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>> = {
    0x18: () => this.#clearCarry(), // CLC
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

  /** Attempt one instruction; unsupported opcodes leave PC and all other state unchanged. */
  step(): Cpu6502StepRecord {
    const before = this.snapshot();
    const accesses: Cpu6502MemoryAccess[] = [];
    const address = this.#state.pc;
    const opcode = this.#read(address, accesses);
    const bytes = [opcode];
    const handler = this.#opcodeHandlers[opcode];
    if (handler) {
      // Advance only after recognizing the opcode; operand fetches advance themselves.
      this.#state.pc = (address + 1) & 0xffff;
      handler({
        fetchByte: () => {
          const pc = this.#state.pc;
          const byte = this.#read(pc, accesses);
          this.#state.pc = (pc + 1) & 0xffff;
          bytes.push(byte);
          return byte;
        },
      });
    }

    const record = {
      instruction: { address, bytes },
      before,
      after: this.snapshot(),
      accesses,
    };
    return handler
      ? { ...record, outcome: "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
  }

  #clearCarry(): void {
    this.#state.flags.c = false;
  }

  #loadAccumulator(value: number): void {
    this.#state.a = value;
    this.#state.flags.n = (value & 0x80) !== 0;
    this.#state.flags.z = value === 0;
  }

  #read(address: number, accesses: Cpu6502MemoryAccess[]): number {
    const value = this.#ram.read(address);
    accesses.push({ kind: "read", address, value });
    return value;
  }
}
