import type { Ram } from "../memory/ram.js";

export interface Cpu6809Flags {
  e: boolean;
  f: boolean;
  h: boolean;
  i: boolean;
  n: boolean;
  z: boolean;
  v: boolean;
  c: boolean;
}

export interface Cpu6809State {
  a: number;
  b: number;
  dp: number;
  x: number;
  y: number;
  s: number;
  u: number;
  pc: number;
  flags: Cpu6809Flags;
}

export type Cpu6809Snapshot = Readonly<Omit<Cpu6809State, "flags">> & {
  readonly flags: Readonly<Cpu6809Flags>;
  readonly d: number;
};

export interface Cpu6809MemoryAccess {
  readonly kind: "read" | "write";
  readonly address: number;
  readonly value: number;
}

export interface Cpu6809Instruction {
  readonly address: number;
  readonly bytes: readonly number[];
}

export type Cpu6809StepRecord = {
  readonly instruction: Cpu6809Instruction;
  readonly before: Cpu6809Snapshot;
  readonly after: Cpu6809Snapshot;
  readonly accesses: readonly Cpu6809MemoryAccess[];
} & (
  | { readonly outcome: "executed" }
  | { readonly outcome: "unsupported"; readonly reason: "opcode" }
);

interface InstructionContext {
  readonly fetchByte: () => number;
}

type OpcodeHandler = (instruction: InstructionContext) => void;

function copyState(state: Omit<Cpu6809Snapshot, "d">): Cpu6809State {
  const flags = state.flags;
  // Copy declared stored fields only; a supplied D or metadata getter is ignored.
  return {
    a: state.a,
    b: state.b,
    dp: state.dp,
    x: state.x,
    y: state.y,
    s: state.s,
    u: state.u,
    pc: state.pc,
    flags: {
      e: flags.e, f: flags.f, h: flags.h, i: flags.i,
      n: flags.n, z: flags.z, v: flags.v, c: flags.c,
    },
  };
}

function checkUnsigned(name: string, value: number, maximum: number): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 0 to ${maximum}.`);
  }
}

/** Instruction-level MC6809 subset for the first 6809 example. */
export class Cpu6809 {
  readonly #ram: Ram;
  readonly #state: Cpu6809State;
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>> = {
    0x86: ({ fetchByte }) => this.#loadAccumulator(fetchByte()), // LDA #n
  };

  constructor(ram: Ram, initialState: Omit<Cpu6809Snapshot, "d">) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 6809 model requires exactly 64 KiB of RAM.");
    }
    const state = copyState(initialState);
    for (const name of ["a", "b", "dp"] as const) {
      checkUnsigned(name, state[name], 0xff);
    }
    for (const name of ["x", "y", "s", "u", "pc"] as const) {
      checkUnsigned(name, state[name], 0xffff);
    }
    for (const name of ["e", "f", "h", "i", "n", "z", "v", "c"] as const) {
      if (typeof state.flags[name] !== "boolean") {
        throw new TypeError(`Flag ${name} must be a boolean.`);
      }
    }
    this.#ram = ram;
    this.#state = state;
  }

  /** Inspect a detached copy, including D derived from A/B, without accessing RAM. */
  snapshot(): Cpu6809Snapshot {
    const state = copyState(this.#state);
    return { ...state, d: (state.a << 8) | state.b };
  }

  /** Attempt one instruction; unsupported bytes (including prefixes) leave state unchanged. */
  step(): Cpu6809StepRecord {
    const before = this.snapshot();
    const accesses: Cpu6809MemoryAccess[] = [];
    const address = this.#state.pc;
    const opcode = this.#read(address, accesses);
    const bytes = [opcode];
    const handler = this.#opcodeHandlers[opcode];
    if (handler) {
      // Advance only for supported instructions; operand fetches advance themselves.
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

  #loadAccumulator(value: number): void {
    this.#state.a = value;
    this.#state.flags.n = (value & 0x80) !== 0;
    this.#state.flags.z = value === 0;
    this.#state.flags.v = false;
  }

  #read(address: number, accesses: Cpu6809MemoryAccess[]): number {
    const value = this.#ram.read(address);
    accesses.push({ kind: "read", address, value });
    return value;
  }
}
