import type { Ram } from "../memory/ram.js";
import { checkUnsigned } from "../validation.js";

export interface Cpu6800Flags {
  h: boolean;
  i: boolean;
  n: boolean;
  z: boolean;
  v: boolean;
  c: boolean;
}

export interface Cpu6800State {
  a: number;
  b: number;
  x: number;
  sp: number;
  pc: number;
  flags: Cpu6800Flags;
}

export type Cpu6800Snapshot = Readonly<Omit<Cpu6800State, "flags">> & {
  readonly flags: Readonly<Cpu6800Flags>;
};

export interface Cpu6800MemoryAccess {
  readonly kind: "read" | "write";
  readonly address: number;
  readonly value: number;
}

export interface Cpu6800Instruction {
  readonly address: number;
  readonly bytes: readonly number[];
}

export type Cpu6800StepRecord = {
  readonly instruction: Cpu6800Instruction;
  readonly before: Cpu6800Snapshot;
  readonly after: Cpu6800Snapshot;
  readonly accesses: readonly Cpu6800MemoryAccess[];
} & (
  | { readonly outcome: "executed" }
  | { readonly outcome: "unsupported"; readonly reason: "opcode" }
);

export interface Cpu6800ResetRecord {
  readonly before: Cpu6800Snapshot;
  readonly after: Cpu6800Snapshot;
  readonly accesses: readonly Cpu6800MemoryAccess[];
}

interface InstructionContext {
  readonly fetchByte: () => number;
  readonly fetchWord: () => number;
  readonly writeByte: (address: number, value: number) => void;
}

type OpcodeHandler = (instruction: InstructionContext) => void;

function copyState(state: Cpu6800State): Cpu6800State {
  const flags = state.flags;
  // Copy each declared field once; ignore extra metadata and other CPUs' register views.
  return {
    a: state.a, b: state.b, x: state.x, sp: state.sp, pc: state.pc,
    flags: { h: flags.h, i: flags.i, n: flags.n, z: flags.z, v: flags.v, c: flags.c },
  };
}

/** Instruction-level Motorola 6800 subset with flat 64 KiB RAM. */
export class Cpu6800 {
  readonly #ram: Ram;
  readonly #state: Cpu6800State;

  constructor(ram: Ram, initialState: Cpu6800State) {
    if (ram.size !== 0x10000) throw new RangeError("The 6800 model requires exactly 64 KiB of RAM.");
    const state = copyState(initialState);
    for (const name of ["a", "b"] as const) checkUnsigned(name, state[name], 0xff);
    for (const name of ["x", "sp", "pc"] as const) checkUnsigned(name, state[name], 0xffff);
    for (const name of ["h", "i", "n", "z", "v", "c"] as const) {
      if (typeof state.flags[name] !== "boolean") throw new TypeError(`Flag ${name} must be a boolean.`);
    }
    this.#ram = ram;
    this.#state = state;
  }

  /** Inspect detached registers and flags without accessing RAM. */
  snapshot(): Cpu6800Snapshot {
    return copyState(this.#state);
  }

  /** Read the reset vector and set I; preserve other state and RAM under the model policy. */
  reset(): Cpu6800ResetRecord {
    const before = this.snapshot();
    const accesses: Cpu6800MemoryAccess[] = [];
    const high = this.#read(0xfffe, accesses);
    const low = this.#read(0xffff, accesses);
    this.#state.pc = (high << 8) | low;
    this.#state.flags.i = true;
    return { before, after: this.snapshot(), accesses };
  }

  /** Attempt one instruction; unsupported opcodes preserve all state and RAM. */
  step(): Cpu6800StepRecord {
    const before = this.snapshot();
    const accesses: Cpu6800MemoryAccess[] = [];
    const address = this.#state.pc;
    const opcode = this.#read(address, accesses);
    const bytes = [opcode];
    const handler = this.#opcodeHandlers[opcode];
    if (handler) {
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
          const high = fetchByte();
          const low = fetchByte();
          return (high << 8) | low;
        },
        writeByte: (address, value) => this.#write(address, value, accesses),
      });
    }
    const record = { instruction: { address, bytes }, before, after: this.snapshot(), accesses };
    return handler
      ? { ...record, outcome: "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
  }

  // Opcode construction. These accumulator forms use 1 r mm oooo:
  // r (bit 6) selects A=0/B=1; mm (bits 5–4) selects the addressing mode;
  // oooo (bits 3–0) selects load=0110, store=0111, or add=1011.
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>> = {
    // 1 0 00 oooo: A with an immediate operand; stores have no immediate form.
    0b1_0_00_0110: ({ fetchByte }) => this.#loadAccumulator(fetchByte()), // LDAA #n
    0b1_0_00_1011: ({ fetchByte }) => this.#addToAccumulator(fetchByte()), // ADDA #n

    // mm=01 (direct) and mm=10 (indexed) remain unsupported.
    // 1 0 11 0111: STAA with an extended address, fetched high byte first.
    0b1_0_11_0111: ({ fetchWord, writeByte }) => this.#storeAccumulator(fetchWord(), writeByte), // STAA addr

    // B-register forms and other operation groups remain unsupported.
  };

  // Loads and stores.

  #loadAccumulator(value: number): void {
    this.#state.a = value;
    this.#setLoadStoreFlags(value);
  }

  #storeAccumulator(address: number, writeByte: InstructionContext["writeByte"]): void {
    const value = this.#state.a;
    writeByte(address, value);
    this.#setLoadStoreFlags(value);
  }

  // Arithmetic and flags.

  #addToAccumulator(value: number): void {
    const accumulator = this.#state.a;
    const sum = accumulator + value;
    const result = sum & 0xff;
    this.#loadAccumulator(result);
    this.#state.flags.h = (accumulator & 0x0f) + (value & 0x0f) > 0x0f;
    this.#state.flags.c = sum > 0xff;
    // Like-signed operands producing an opposite-signed result indicate overflow.
    this.#state.flags.v = (~(accumulator ^ value) & (accumulator ^ result) & 0x80) !== 0;
  }

  #setLoadStoreFlags(value: number): void {
    this.#state.flags.n = (value & 0x80) !== 0;
    this.#state.flags.z = value === 0;
    this.#state.flags.v = false;
  }

  // Recorded memory access.

  #read(address: number, accesses: Cpu6800MemoryAccess[]): number {
    const value = this.#ram.read(address);
    accesses.push({ kind: "read", address, value });
    return value;
  }

  #write(address: number, value: number, accesses: Cpu6800MemoryAccess[]): void {
    this.#ram.write(address, value);
    accesses.push({ kind: "write", address, value });
  }
}
