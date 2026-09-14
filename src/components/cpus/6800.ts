import type { Ram } from "../memory/ram.js";
import { defineState, copyState, readState, unsigned, flag, group } from "./state.ts";
import type { StateDescription } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { add8 } from "./alu.ts";

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

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu6800StateDescription = defineState({
  a: unsigned(8), b: unsigned(8), x: unsigned(16), sp: unsigned(16), pc: unsigned(16),
  flags: group({ h: flag, i: flag, n: flag, z: flag, v: flag, c: flag }),
} satisfies StateDescription<Cpu6800State>);

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
  readonly readByte: (address: number) => number;
  readonly writeByte: (address: number, value: number) => void;
}

type OpcodeHandler = (instruction: InstructionContext) => void;
type Accumulator = "a" | "b";

/** Instruction-level Motorola 6800 subset with flat 64 KiB RAM. */
export class Cpu6800 {
  readonly #ram: Ram;
  readonly #state: Cpu6800State;

  constructor(ram: Ram, initialState: Cpu6800State) {
    if (ram.size !== 0x10000) throw new RangeError("The 6800 model requires exactly 64 KiB of RAM.");
    this.#ram = ram;
    this.#state = readState(cpu6800StateDescription, initialState);
  }

  /** Inspect detached registers and flags without accessing RAM. */
  snapshot(): Cpu6800Snapshot {
    return copyState(cpu6800StateDescription, this.#state);
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
        readByte: address => this.#read(address, accesses),
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

    // 00110 p 1 r: p (bit 2) selects pull=0/push=1; r (bit 0) selects A=0/B=1.
    // Pulls preserve flags, unlike ordinary accumulator loads.
    ...opcodeFamily("00110 0 1 r", { r: ["a", "b"] }, ({ r: register }) => ({ readByte }: InstructionContext) => { this.#state[register] = this.#pullByte(readByte); }), // PULA / PULB
    ...opcodeFamily("00110 1 1 r", { r: ["a", "b"] }, ({ r: register }) => ({ writeByte }: InstructionContext) => this.#pushByte(this.#state[register], writeByte)), // PSHA / PSHB
    ...opcodePattern("0011 1001", ({ readByte }: InstructionContext) => this.#return(readByte)), // RTS

    // 010 r oooo: r (bit 4) selects A=0/B=1; oooo=1010 decrements, 1100 increments.
    ...opcodeFamily("010 r 1010", { r: ["a", "b"] }, ({ r: register }) => () => this.#adjustAccumulator(register, -1)), // DECA / DECB
    ...opcodeFamily("010 r 1100", { r: ["a", "b"] }, ({ r: register }) => () => this.#adjustAccumulator(register, 1)), // INCA / INCB

    // 1 r mm oooo: r (bit 6) selects A=0/B=1; mm (bits 5–4) selects addressing;
    // oooo (bits 3–0) selects load=0110, store=0111, or add=1011 in this subset.
    // mm=00 supplies an immediate byte. Both loads and only the A add are implemented.
    ...opcodeFamily("1 r 00 0110", { r: ["a", "b"] }, ({ r: register }) => ({ fetchByte }: InstructionContext) => this.#loadAccumulator(register, fetchByte())), // LDAA / LDAB #n
    ...opcodePattern("1 0 00 1011", ({ fetchByte }: InstructionContext) => this.#addToAccumulator(fetchByte())), // ADDA #n

    // 10 mm 1101: mm=00 is relative BSR; mm=11 is extended JSR below.
    ...opcodePattern("10 00 1101", ({ fetchByte, writeByte }: InstructionContext) => this.#call(this.#relativeAddress(fetchByte()), writeByte)), // BSR rel

    // 1 r mm 1110: r selects SP=0/X=1 rather than an accumulator; only immediate LDS is supported.
    ...opcodePattern("1 0 00 1110", ({ fetchWord }: InstructionContext) => this.#loadStackPointer(fetchWord())), // LDS #nn

    // mm=01 (direct) and mm=10 (indexed) remain unsupported.
    // 1 0 11 0111: STAA with an extended address, fetched high byte first.
    ...opcodePattern("1 0 11 0111", ({ fetchWord, writeByte }: InstructionContext) => this.#storeAccumulator(fetchWord(), writeByte)), // STAA addr
    ...opcodePattern("10 11 1101", ({ fetchWord, writeByte }: InstructionContext) => this.#call(fetchWord(), writeByte)), // JSR addr

    // Other instruction groups, including interrupt controls, are unsupported.
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

  #loadStackPointer(value: number): void {
    this.#state.sp = value;
    this.#setLoadStoreFlags(value, 0x8000);
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

  // Control flow and stack operations.

  #branch(displacement: number, take: boolean): void {
    if (take) this.#state.pc = this.#relativeAddress(displacement);
  }

  #relativeAddress(displacement: number): number {
    // Branches and BSR fetch the displacement before computing this relative address.
    const offset = displacement < 0x80 ? displacement : displacement - 0x100;
    return (this.#state.pc + offset) & 0xffff;
  }

  #call(address: number, writeByte: InstructionContext["writeByte"]): void {
    // All instruction bytes are fetched before stacking the return PC, low byte first.
    const returnAddress = this.#state.pc;
    this.#pushByte(returnAddress & 0xff, writeByte);
    this.#pushByte(returnAddress >>> 8, writeByte);
    this.#state.pc = address;
  }

  #return(readByte: InstructionContext["readByte"]): void {
    const high = this.#pullByte(readByte);
    const low = this.#pullByte(readByte);
    this.#state.pc = (high << 8) | low;
  }

  #pushByte(value: number, writeByte: InstructionContext["writeByte"]): void {
    // SP points at the next free byte: write first, then decrement across the full address space.
    writeByte(this.#state.sp, value);
    this.#state.sp = (this.#state.sp - 1) & 0xffff;
  }

  #pullByte(readByte: InstructionContext["readByte"]): number {
    this.#state.sp = (this.#state.sp + 1) & 0xffff;
    return readByte(this.#state.sp);
  }

  // Arithmetic and flags.

  #addToAccumulator(value: number): void {
    const { result, carry, halfCarry, overflow } = add8(this.#state.a, value);
    this.#loadAccumulator("a", result);
    this.#state.flags.h = halfCarry;
    this.#state.flags.c = carry;
    this.#state.flags.v = overflow;
  }

  #setLoadStoreFlags(value: number, signBit = 0x80): void {
    this.#state.flags.n = (value & signBit) !== 0;
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
