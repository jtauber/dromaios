import type { Ram } from "../memory/ram.js";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { defineState, copyState, readState, unsigned, flag, group } from "./state.ts";
import type { StateDescription } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import { add8 } from "./alu.ts";

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

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu6809StateDescription = defineState({
  a: unsigned(8), b: unsigned(8), dp: unsigned(8),
  x: unsigned(16), y: unsigned(16), s: unsigned(16), u: unsigned(16), pc: unsigned(16),
  flags: group({ e: flag, f: flag, h: flag, i: flag, n: flag, z: flag, v: flag, c: flag }),
} satisfies StateDescription<Cpu6809State>);

export type Cpu6809Snapshot = Readonly<Omit<Cpu6809State, "flags">> & {
  readonly flags: Readonly<Cpu6809Flags>;
  readonly d: number;
};

export type Cpu6809MemoryAccess = MemoryAccess;

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

export interface Cpu6809ResetRecord {
  readonly before: Cpu6809Snapshot;
  readonly after: Cpu6809Snapshot;
  readonly accesses: readonly Cpu6809MemoryAccess[];
}

type OpcodeHandler = (instruction: InstructionContext) => void;
type Accumulator = "a" | "b";
type StackPointer = "s" | "u";

/** Instruction-level MC6809 subset for the 6809 examples. */
export class Cpu6809 {
  readonly #ram: Ram;
  readonly #state: Cpu6809State;

  constructor(ram: Ram, initialState: Omit<Cpu6809Snapshot, "d">) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 6809 model requires exactly 64 KiB of RAM.");
    }
    this.#ram = ram;
    this.#state = readState(cpu6809StateDescription, initialState);
  }

  /** Inspect a detached copy, including D derived from A/B, without accessing RAM. */
  snapshot(): Cpu6809Snapshot {
    const state = copyState(cpu6809StateDescription, this.#state);
    return { ...state, d: (state.a << 8) | state.b };
  }

  /** Reset PC, DP, F, and I with only the vector reads; preserve other state and RAM. */
  reset(): Cpu6809ResetRecord {
    const before = this.snapshot();
    const { accesses, readByte } = recordMemory(this.#ram);
    const high = readByte(0xfffe);
    const low = readByte(0xffff);
    this.#state.pc = (high << 8) | low;
    this.#state.dp = 0;
    this.#state.flags.f = true;
    this.#state.flags.i = true;
    return { before, after: this.snapshot(), accesses };
  }

  /** Attempt one instruction; unsupported bytes (including prefixes) leave state unchanged. */
  step(): Cpu6809StepRecord {
    const before = this.snapshot();
    const { accesses, readByte, writeByte } = recordMemory(this.#ram);
    const address = this.#state.pc;
    const opcode = readByte(address);
    const bytes = [opcode];
    const handler = this.#opcodeHandlers[opcode];
    if (handler) {
      // Advance only for supported instructions; operand fetches advance themselves.
      this.#state.pc = (address + 1) & 0xffff;
      const fetchByte = (): number => {
        const pc = this.#state.pc;
        const byte = readByte(pc);
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
        readByte,
        writeByte,
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

  // Register and flag views.

  get #cc(): number {
    const flags = this.#state.flags;
    // CC bits 7..0: E F H I N Z V C.
    return (Number(flags.e) << 7) | (Number(flags.f) << 6)
      | (Number(flags.h) << 5) | (Number(flags.i) << 4)
      | (Number(flags.n) << 3) | (Number(flags.z) << 2)
      | (Number(flags.v) << 1) | Number(flags.c);
  }

  set #cc(value: number) {
    this.#state.flags = {
      e: (value & 0x80) !== 0, f: (value & 0x40) !== 0,
      h: (value & 0x20) !== 0, i: (value & 0x10) !== 0,
      n: (value & 0x08) !== 0, z: (value & 0x04) !== 0,
      v: (value & 0x02) !== 0, c: (value & 0x01) !== 0,
    };
  }

  // Opcode selectors and construction.

  // Branches 20–2F use 0010 ttt p: bits 3..1 select the test; bit 0 inverts it.
  // Each entry gives the p=0 test, followed by its p=0 / p=1 mnemonics.
  readonly #branchConditions = [
    () => true, // 000: BRA / BRN
    () => !this.#state.flags.c && !this.#state.flags.z, // 001: BHI / BLS
    () => !this.#state.flags.c, // 010: BCC (BHS) / BCS (BLO)
    () => !this.#state.flags.z, // 011: BNE / BEQ
    () => !this.#state.flags.v, // 100: BVC / BVS
    () => !this.#state.flags.n, // 101: BPL / BMI
    () => this.#state.flags.n === this.#state.flags.v, // 110: BGE / BLT
    () => !this.#state.flags.z && this.#state.flags.n === this.#state.flags.v, // 111: BGT / BLE
  ] as const;

  // Base opcode page only; prefix bytes 0x10 and 0x11 remain unsupported.
  // Each family below labels its own fields; stack masks are separate postbytes.
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // 0010 ttt p: all sixteen short branches, including BRA and BRN.
    ...opcodeFamily("0010 ttt p", {
      t: this.#branchConditions,
      p: [false, true],
    }, ({ t: test, p: invert }) => ({ fetchByte }: InstructionContext) =>
      this.#branch(fetchByte(), test() !== invert)),

    // 001101 s p: s=0 selects S, s=1 selects U; p=0 pushes, p=1 pulls.
    ...opcodePattern("001101 0 0", ({ fetchByte, writeByte }: InstructionContext) => this.#pushRegisters("s", fetchByte(), writeByte)), // PSHS
    ...opcodePattern("001101 0 1", ({ fetchByte, readByte }: InstructionContext) => this.#pullRegisters("s", fetchByte(), readByte)), // PULS
    ...opcodePattern("001101 1 0", ({ fetchByte, writeByte }: InstructionContext) => this.#pushRegisters("u", fetchByte(), writeByte)), // PSHU
    ...opcodePattern("001101 1 1", ({ fetchByte, readByte }: InstructionContext) => this.#pullRegisters("u", fetchByte(), readByte)), // PULU

    // 010 r oooo: r=0 selects A, r=1 selects B; oooo=1010 decrements, 1100 increments.
    ...opcodePattern("010 0 1010", () => this.#adjustAccumulator("a", -1)), // DECA
    ...opcodePattern("010 0 1100", () => this.#adjustAccumulator("a", 1)), // INCA
    ...opcodePattern("010 1 1010", () => this.#adjustAccumulator("b", -1)), // DECB
    ...opcodePattern("010 1 1100", () => this.#adjustAccumulator("b", 1)), // INCB

    // These A-register forms use 10 mm oooo: mm selects addressing, oooo the operation.
    // oooo=0110 loads A, 0111 stores A, 1011 adds to A.
    // mm=00 selects an immediate operand; stores have no immediate form.
    ...opcodePattern("10 00 0110", ({ fetchByte }: InstructionContext) => this.#loadAccumulator("a", fetchByte())), // LDA #n
    ...opcodePattern("10 00 1011", ({ fetchByte }: InstructionContext) => this.#addToAccumulator(fetchByte())), // ADDA #n

    // mm=01 selects direct addressing through DP.
    ...opcodePattern("10 01 0110", ({ fetchByte, readByte }: InstructionContext) => this.#loadAccumulator("a", readByte(this.#directAddress(fetchByte())))), // LDA direct
    ...opcodePattern("10 01 0111", ({ fetchByte, writeByte }: InstructionContext) => this.#storeAccumulator(this.#directAddress(fetchByte()), writeByte)), // STA direct

    // mm=10 (indexed) has no implemented forms yet.
    // mm=11 selects an extended address operand.
    ...opcodePattern("10 11 0111", ({ fetchWord, writeByte }: InstructionContext) => this.#storeAccumulator(fetchWord(), writeByte)), // STA extended

    // 11 mm oooo contains the corresponding B forms for these byte operations.
    // Only mm=00, oooo=0110 (immediate LDB) is implemented in this group.
    ...opcodePattern("11 00 0110", ({ fetchByte }: InstructionContext) => this.#loadAccumulator("b", fetchByte())), // LDB #n
  ]);

  // Addressing.

  #directAddress(offset: number): number {
    return (this.#state.dp << 8) | offset;
  }

  // Loads and stores.

  #loadAccumulator(register: Accumulator, value: number): void {
    this.#state[register] = value;
    this.#setLoadStoreFlags(value);
  }

  #storeAccumulator(address: number, writeByte: InstructionContext["writeByte"]): void {
    const value = this.#state.a;
    writeByte(address, value);
    this.#setLoadStoreFlags(value);
  }

  // Control flow.

  #branch(displacement: number, take: boolean): void {
    // Every branch fetches its operand; PC now points past both instruction bytes.
    if (take) {
      const offset = displacement < 0x80 ? displacement : displacement - 0x100;
      this.#state.pc = (this.#state.pc + offset) & 0xffff;
    }
  }

  // Stack operations.
  // Postbyte bits 7..0: PC, other stack pointer, Y, X, DP, B, A, CC.
  // Bit 6 always names the pointer not selected by the opcode's s bit.

  #pushRegisters(stack: StackPointer, mask: number, writeByte: InstructionContext["writeByte"]): void {
    const pushByte = (value: number): void => {
      this.#state[stack] = (this.#state[stack] - 1) & 0xffff;
      writeByte(this.#state[stack], value);
    };
    const pushWord = (value: number): void => {
      pushByte(value & 0xff);
      pushByte(value >>> 8);
    };
    // Descending mask order; PC has already advanced past the postbyte.
    if (mask & 0x80) pushWord(this.#state.pc);
    if (mask & 0x40) pushWord(this.#state[stack === "s" ? "u" : "s"]);
    if (mask & 0x20) pushWord(this.#state.y);
    if (mask & 0x10) pushWord(this.#state.x);
    if (mask & 0x08) pushByte(this.#state.dp);
    if (mask & 0x04) pushByte(this.#state.b);
    if (mask & 0x02) pushByte(this.#state.a);
    if (mask & 0x01) pushByte(this.#cc);
  }

  #pullRegisters(stack: StackPointer, mask: number, readByte: InstructionContext["readByte"]): void {
    const pullByte = (): number => {
      const value = readByte(this.#state[stack]);
      this.#state[stack] = (this.#state[stack] + 1) & 0xffff;
      return value;
    };
    const pullWord = (): number => {
      const high = pullByte();
      return (high << 8) | pullByte();
    };
    // Reverse the push order; ordinary pulls do not apply load-instruction flags.
    if (mask & 0x01) this.#cc = pullByte();
    if (mask & 0x02) this.#state.a = pullByte();
    if (mask & 0x04) this.#state.b = pullByte();
    if (mask & 0x08) this.#state.dp = pullByte();
    if (mask & 0x10) this.#state.x = pullWord();
    if (mask & 0x20) this.#state.y = pullWord();
    if (mask & 0x40) this.#state[stack === "s" ? "u" : "s"] = pullWord();
    if (mask & 0x80) this.#state.pc = pullWord();
  }

  // Arithmetic and flags.

  #adjustAccumulator(register: Accumulator, delta: -1 | 1): void {
    const value = this.#state[register];
    this.#loadAccumulator(register, (value + delta) & 0xff);
    // Incrementing +127 or decrementing -128 overflows the signed byte range.
    this.#state.flags.v = value === (delta === 1 ? 0x7f : 0x80);
  }

  #addToAccumulator(value: number): void {
    const { result, carry, halfCarry, overflow } = add8(this.#state.a, value);
    this.#loadAccumulator("a", result);
    this.#state.flags.h = halfCarry;
    this.#state.flags.c = carry;
    this.#state.flags.v = overflow;
  }

  #setLoadStoreFlags(value: number): void {
    this.#state.flags.n = (value & 0x80) !== 0;
    this.#state.flags.z = value === 0;
    this.#state.flags.v = false;
  }
}
