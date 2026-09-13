import type { Ram } from "../memory/ram.js";
import { checkUnsigned } from "../validation.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.js";
import type { OpcodeEntry } from "./opcodes.js";

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
type Accumulator = "a" | "b";

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

  // Opcode selectors and construction. Each group labels its own encoding fields.

  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // 0001011 d: d=0 transfers A to B; d=1 transfers B to A. Both update N/Z/V.
    ...opcodePattern("0001011 0", () => this.#loadAccumulator("b", this.#state.a)), // TAB
    ...opcodePattern("0001011 1", () => this.#loadAccumulator("a", this.#state.b)), // TBA

    // 0010 ttt p: bits 3..1 select a condition; bit 0 selects it (0) or its inverse (1).
    // ttt=000 has only BRA. The original 6800 leaves 21 unused; it has no BRN.
    ...opcodePattern("0010 000 0", ({ fetchByte }: InstructionContext) => this.#branch(fetchByte(), true)), // BRA
    ...this.#branchPair("0010 001 p", () => !this.#state.flags.c && !this.#state.flags.z), // BHI / BLS
    ...this.#branchPair("0010 010 p", () => !this.#state.flags.c), // BCC / BCS
    ...this.#branchPair("0010 011 p", () => !this.#state.flags.z), // BNE / BEQ
    ...this.#branchPair("0010 100 p", () => !this.#state.flags.v), // BVC / BVS
    ...this.#branchPair("0010 101 p", () => !this.#state.flags.n), // BPL / BMI
    ...this.#branchPair("0010 110 p", () => this.#state.flags.n === this.#state.flags.v), // BGE / BLT
    ...this.#branchPair("0010 111 p", () => !this.#state.flags.z && this.#state.flags.n === this.#state.flags.v), // BGT / BLE

    // 010 r oooo: r (bit 4) selects A=0/B=1; oooo=1010 decrements, 1100 increments.
    ...opcodeFamily("010 r 1010", { r: ["a", "b"] }, ({ r: register }) => () => this.#adjustAccumulator(register, -1)), // DECA / DECB
    ...opcodeFamily("010 r 1100", { r: ["a", "b"] }, ({ r: register }) => () => this.#adjustAccumulator(register, 1)), // INCA / INCB

    // 1 r mm oooo: r (bit 6) selects A=0/B=1; mm (bits 5–4) selects addressing;
    // oooo (bits 3–0) selects load=0110, store=0111, or add=1011 in this subset.
    // mm=00 supplies an immediate byte. Both loads and only the A add are implemented.
    ...opcodeFamily("1 r 00 0110", { r: ["a", "b"] }, ({ r: register }) => ({ fetchByte }: InstructionContext) => this.#loadAccumulator(register, fetchByte())), // LDAA / LDAB #n
    ...opcodePattern("1 0 00 1011", ({ fetchByte }: InstructionContext) => this.#addToAccumulator(fetchByte())), // ADDA #n

    // mm=01 (direct) and mm=10 (indexed) remain unsupported.
    // 1 0 11 0111: STAA with an extended address, fetched high byte first.
    ...opcodePattern("1 0 11 0111", ({ fetchWord, writeByte }: InstructionContext) => this.#storeAccumulator(fetchWord(), writeByte)), // STAA addr

    // Other instruction groups, including stack operations and interrupt controls, are unsupported.
  ]);

  #branchPair(pattern: string, test: () => boolean): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { p: [false, true] }, ({ p: invert }) =>
      ({ fetchByte }: InstructionContext) => this.#branch(fetchByte(), test() !== invert));
  }

  // Loads, stores, and accumulator operations.

  #loadAccumulator(register: Accumulator, value: number): void {
    this.#state[register] = value;
    this.#setLoadStoreFlags(value);
  }

  #storeAccumulator(address: number, writeByte: InstructionContext["writeByte"]): void {
    const value = this.#state.a;
    writeByte(address, value);
    this.#setLoadStoreFlags(value);
  }

  #adjustAccumulator(register: Accumulator, delta: -1 | 1): void {
    const value = this.#state[register];
    this.#loadAccumulator(register, (value + delta) & 0xff);
    // Incrementing +127 or decrementing -128 overflows the signed byte range.
    this.#state.flags.v = value === (delta === 1 ? 0x7f : 0x80);
  }

  // Control flow.

  #branch(displacement: number, take: boolean): void {
    // Both paths fetch the displacement; PC now points past the two instruction bytes.
    if (take) {
      const offset = displacement < 0x80 ? displacement : displacement - 0x100;
      this.#state.pc = (this.#state.pc + offset) & 0xffff;
    }
  }

  // Arithmetic and flags.

  #addToAccumulator(value: number): void {
    const accumulator = this.#state.a;
    const sum = accumulator + value;
    const result = sum & 0xff;
    this.#loadAccumulator("a", result);
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
