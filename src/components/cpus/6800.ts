import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep } from "./execution-records.ts";
import { flagRegister } from "./flags.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { signed8, readWordBE } from "./binary.ts";
import { modifyByte } from "./memory-operations.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { defineState, copyState, readState, unsigned, flag, boolean, group } from "./state.ts";
import type { StateValues, ReadonlyState } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { motorolaAccumulatorOperations, motorolaByteAlu, motorolaConditionPairs } from "./motorola.ts";
import { subtract, shiftLeft, shiftRight } from "./alu.ts";
import type { ShiftResult } from "./alu.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu6800StateDescription = defineState({
  a: unsigned(8), b: unsigned(8), x: unsigned(16), sp: unsigned(16), pc: unsigned(16),
  flags: group({ h: flag, i: flag, n: flag, z: flag, v: flag, c: flag }),
  waiting: boolean,
});

export type Cpu6800State = StateValues<typeof cpu6800StateDescription>;
export type Cpu6800Flags = Cpu6800State["flags"];

export type Cpu6800Snapshot = ReadonlyState<Cpu6800State>;

export type Cpu6800MemoryAccess = MemoryAccess;

export type Cpu6800Instruction = FetchedInstruction;

export type Cpu6800StepRecord = InstructionStep<Cpu6800Snapshot> | (StateTransition<Cpu6800Snapshot> & {
  readonly outcome: "waiting";
  readonly instruction: Cpu6800Instruction | null;
});

export type Cpu6800ResetRecord = StateTransition<Cpu6800Snapshot>;

export type Cpu6800InterruptSource = "irq" | "nmi";

/** External entry performs stack/vector accesses without fetching an instruction. */
export type Cpu6800InterruptRecord = StateTransition<Cpu6800Snapshot> & { readonly instruction: null } & (
  | { readonly source: Cpu6800InterruptSource; readonly outcome: "accepted" }
  | { readonly source: "irq"; readonly outcome: "ignored"; readonly reason: "masked" }
);

type OpcodeHandler = (instruction: InstructionContext) => void;
type Accumulator = "a" | "b";
type WordRegister = "sp" | "x";
type ByteOperation = (value: number) => number;
type AddressReader = (instruction: InstructionContext) => number;

const instructionPattern = opcodePattern<OpcodeHandler>;
const packedFlags = flagRegister({ h: 5, i: 4, n: 3, z: 2, v: 1, c: 0 }, 0xc0);

/** Instruction-level Motorola 6800 with explicit boundary IRQ/NMI delivery. */
export class Cpu6800 {
  readonly #ram: Ram;
  readonly #state: Cpu6800State;
  readonly #atBoundary = executionBoundary("6800 step, reset, and interrupt calls must not be reentrant.");
  readonly #alu = motorolaByteAlu(() => this.#state.flags);

  constructor(ram: Ram, initialState: Cpu6800Snapshot) {
    if (ram.size !== 0x10000) throw new RangeError("The 6800 model requires exactly 64 KiB of RAM.");
    this.#ram = ram;
    this.#state = readState(cpu6800StateDescription, initialState);
  }

  /** Inspect detached registers and flags without accessing RAM. */
  snapshot(): Cpu6800Snapshot {
    return copyState(cpu6800StateDescription, this.#state);
  }

  /** Read the reset vector, set I, and release WAI; preserve other state and RAM. */
  reset(): Cpu6800ResetRecord {
    return this.#atBoundary(() => {
      const before = this.snapshot();
      const { accesses, readByte } = recordMemory(this.#ram);
      this.#state.pc = this.#readWord(0xfffe, readByte);
      this.#state.flags.i = true;
      this.#state.waiting = false;
      return { before, after: this.snapshot(), accesses };
    });
  }

  /** Attempt one instruction; waiting CPUs do not fetch, and unsupported opcodes preserve state. */
  step(): Cpu6800StepRecord {
    return this.#atBoundary<Cpu6800StepRecord>(() => {
      const before = this.snapshot();
      if (this.#state.waiting) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "waiting" };
      }
      const { instruction, accesses, executed } = executeByteInstruction(this.#state, this.#ram, this.#opcodeHandlers, readWordBE);
      const record = { before, after: this.snapshot(), instruction, accesses };
      return executed
        ? { ...record, outcome: this.#state.waiting ? "waiting" : "executed" }
        : { ...record, outcome: "unsupported", reason: "opcode" };
    });
  }

  /** Offer a selected request at this boundary; the caller owns pending signals and NMI edges. */
  interrupt(source: Cpu6800InterruptSource): Cpu6800InterruptRecord {
    return this.#atBoundary<Cpu6800InterruptRecord>(() => {
      if (source !== "irq" && source !== "nmi") throw new RangeError("6800 interrupt source must be irq or nmi.");
      const before = this.snapshot();
      // Boundary offers consult current I; hardware look-ahead and pin sampling are unmodeled.
      if (source === "irq" && this.#state.flags.i) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], source, outcome: "ignored", reason: "masked" };
      }
      const memory = recordMemory(this.#ram);
      this.#enterInterrupt(source === "irq" ? 0xfff8 : 0xfffc, memory);
      return { before, after: this.snapshot(), instruction: null, accesses: memory.accesses, source, outcome: "accepted" };
    });
  }

  // Opcode selectors and construction. Each group labels its own encoding fields.

  // mm in 1 r mm oooo: 00 is immediate; the other modes resolve a data address.
  readonly #memoryModes: readonly { bits: string; address: AddressReader }[] = [
    { bits: "01", address: ({ fetchByte }) => fetchByte() }, // Direct, page zero
    { bits: "10", address: ({ fetchByte }) => this.#indexedAddress(fetchByte()) }, // Indexed, unsigned offset
    { bits: "11", address: ({ fetchWord }) => fetchWord() }, // Extended
  ];
  readonly #operandReaders: readonly ((instruction: InstructionContext) => number)[] = [
    ({ fetchByte }) => fetchByte(),
    ...this.#memoryModes.map(({ address }) => (instruction: InstructionContext) => instruction.readByte(address(instruction))),
  ];
  readonly #wordOperandReaders: readonly ((instruction: InstructionContext) => number)[] = [
    ({ fetchWord }) => fetchWord(),
    ...this.#memoryModes.map(({ address }) => (instruction: InstructionContext) => this.#readWord(address(instruction), instruction.readByte)),
  ];
  readonly #wordRegisters = ["sp", "x"] as const;

  // 01 tt oooo: tt=00 A, 01 B, 10 indexed, 11 extended; oooo selects the operation.
  // TST (1101) only reads; CLR (1111) only writes. Neither needs a byte transform.
  readonly #unaryOperations: readonly { bits: string; apply: ByteOperation }[] = [
    { bits: "0000", apply: value => this.#alu.subtract(0, value) }, // NEG
    { bits: "0011", apply: value => this.#alu.complement(value) }, // COM
    { bits: "0100", apply: value => this.#shiftResult(shiftRight(8, value, 0)) }, // LSR
    { bits: "0110", apply: value => this.#shiftResult(shiftRight(8, value, this.#state.flags.c ? 1 : 0)) }, // ROR
    { bits: "0111", apply: value => this.#shiftResult(shiftRight(8, value, value >= 0x80 ? 1 : 0)) }, // ASR
    { bits: "1000", apply: value => this.#shiftResult(shiftLeft(8, value, 0)) }, // ASL
    { bits: "1001", apply: value => this.#shiftResult(shiftLeft(8, value, this.#state.flags.c ? 1 : 0)) }, // ROL
    { bits: "1010", apply: value => this.#alu.adjust(value, -1) }, // DEC
    { bits: "1100", apply: value => this.#alu.adjust(value, 1) }, // INC
  ];

  // 1 r mm oooo shares the 6809's byte operations; word operations and stores remain below.
  readonly #accumulatorOperations = motorolaAccumulatorOperations(() => this.#state, this.#alu);

  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    ...instructionPattern("0000 0001", () => {}), // NOP

    // 0000011 d: d=0 moves A's low six bits into CC; d=1 packs CC into A with bits 7/6 set.
    ...instructionPattern("0000011 0", () => { this.#state.flags = packedFlags.decode(this.#state.a); }), // TAP
    ...instructionPattern("0000011 1", () => { this.#state.a = packedFlags.encode(this.#state.flags); }), // TPA

    // 00001 ff v: ff=00 adjusts X; ff=01/10/11 clears or sets V/C/I.
    ...opcodeFamily("00001 00 d", { d: [1, -1] }, ({ d: delta }) => () => this.#adjustIndex(delta)), // INX / DEX; only Z changes
    ...opcodeFamily("00001 01 v", { v: [false, true] }, ({ v: value }) => () => { this.#state.flags.v = value; }), // CLV / SEV
    ...opcodeFamily("00001 10 v", { v: [false, true] }, ({ v: value }) => () => { this.#state.flags.c = value; }), // CLC / SEC
    ...opcodeFamily("00001 11 v", { v: [false, true] }, ({ v: value }) => () => { this.#state.flags.i = value; }), // CLI / SEI

    // 0001000 c: subtract B from A; c=1 compares without replacing A. Both ignore incoming carry.
    ...instructionPattern("0001000 0", () => { this.#state.a = this.#alu.subtract(this.#state.a, this.#state.b); }), // SBA
    ...instructionPattern("0001000 1", () => { this.#alu.subtract(this.#state.a, this.#state.b); }), // CBA

    // 0001011 d: d=0 transfers A to B; d=1 transfers B to A. Both update N/Z/V.
    ...instructionPattern("0001011 0", () => this.#loadAccumulator("b", this.#state.a)), // TAB
    ...instructionPattern("0001011 1", () => this.#loadAccumulator("a", this.#state.b)), // TBA

    ...instructionPattern("0001 1001", () => { this.#state.a = this.#alu.decimalAdjust(this.#state.a); }), // DAA
    ...instructionPattern("0001 1011", () => { this.#state.a = this.#alu.add(this.#state.a, this.#state.b); }), // ABA

    // 0010 ttt p: bits 3..1 select a condition; bit 0 selects it (0) or its inverse (1).
    // ttt=000 has only BRA. The original 6800 leaves 21 unused; it has no BRN.
    ...instructionPattern("0010 000 0", ({ fetchByte }: InstructionContext) => this.#branch(fetchByte(), true)), // BRA
    ...this.#branchPair("0010 001 p", 1), // BHI / BLS
    ...this.#branchPair("0010 010 p", 2), // BCC / BCS
    ...this.#branchPair("0010 011 p", 3), // BNE / BEQ
    ...this.#branchPair("0010 100 p", 4), // BVC / BVS
    ...this.#branchPair("0010 101 p", 5), // BPL / BMI
    ...this.#branchPair("0010 110 p", 6), // BGE / BLT
    ...this.#branchPair("0010 111 p", 7), // BGT / BLE

    // 00110 p q r: q=1 pulls (p=0) or pushes (p=1) A/B (r=0/1).
    // q=0 manipulates SP/X. Every instruction in this group preserves all flags.
    ...instructionPattern("00110 0 0 0", () => { this.#state.x = (this.#state.sp + 1) & 0xffff; }), // TSX
    ...instructionPattern("00110 0 0 1", () => { this.#state.sp = (this.#state.sp + 1) & 0xffff; }), // INS
    ...opcodeFamily("00110 0 1 r", { r: ["a", "b"] }, ({ r: register }) => ({ readByte }: InstructionContext) => { this.#state[register] = this.#pullByte(readByte); }), // PULA / PULB
    ...instructionPattern("00110 1 0 0", () => { this.#state.sp = (this.#state.sp - 1) & 0xffff; }), // DES
    ...instructionPattern("00110 1 0 1", () => { this.#state.sp = (this.#state.x - 1) & 0xffff; }), // TXS
    ...opcodeFamily("00110 1 1 r", { r: ["a", "b"] }, ({ r: register }) => ({ writeByte }: InstructionContext) => this.#pushByte(this.#state[register], writeByte)), // PSHA / PSHB
    ...instructionPattern("0011 1001", ({ readByte }: InstructionContext) => this.#return(readByte)), // RTS
    ...instructionPattern("0011 1011", ({ readByte }) => this.#returnFromInterrupt(readByte)), // RTI

    // 0011111 s: both save the full frame; s=0 waits, s=1 enters the software vector.
    ...instructionPattern("0011111 0", ({ writeByte }) => { this.#saveInterruptFrame(writeByte); this.#state.waiting = true; }), // WAI
    ...instructionPattern("0011111 1", instruction => this.#enterInterrupt(0xfffa, instruction)), // SWI

    // 010 r oooo (tt=00/01): r selects A=0/B=1. 1110 is unused here.
    ...this.#unaryOperations.flatMap(({ bits, apply }) => opcodeFamily(`010 r ${bits}`,
      { r: ["a", "b"] }, ({ r }) => () => { this.#state[r] = apply(this.#state[r]); })),
    ...opcodeFamily("010 r 1101", { r: ["a", "b"] }, ({ r }) => () => this.#test(this.#state[r])), // TSTA / TSTB
    ...opcodeFamily("010 r 1111", { r: ["a", "b"] }, ({ r }) => () => { this.#state[r] = this.#alu.clear(); }), // CLRA / CLRB

    // 011 m oooo (tt=10/11): m selects indexed=0/extended=1; JMP (1110) uses the address without reading data.
    ...this.#memoryUnaryHandlers("0110", ({ fetchByte }) => this.#indexedAddress(fetchByte())),
    ...this.#memoryUnaryHandlers("0111", ({ fetchWord }) => fetchWord()),

    // 1 r mm oooo: r (bit 6) selects A=0/B=1; mm (bits 5–4) selects addressing;
    // oooo (bits 3–0) selects a shared byte operation; 0011 remains undefined.
    // Byte-operation selectors are shared with the 6809; CMP/BIT leave A/B unchanged.
    ...this.#accumulatorOperations.flatMap(({ bits, apply }) => opcodeFamily(`1 r mm ${bits}`,
      { r: ["a", "b"], m: this.#operandReaders }, ({ r, m: read }) => (instruction: InstructionContext) => apply(r, read(instruction)))),
    // Stores have no immediate form: expand only the three address-bearing modes.
    ...this.#memoryModes.flatMap(({ bits, address }) => opcodeFamily(`1 r ${bits} 0111`, { r: ["a", "b"] },
      ({ r }) => (instruction: InstructionContext) => this.#storeAccumulator(r, address(instruction), instruction.writeByte))), // STAA / STAB

    // 10 mm 1100: compare X with a word. The original 6800 compares its bytes separately.
    ...opcodeFamily("10 mm 1100", { m: this.#wordOperandReaders }, ({ m: read }) => (instruction: InstructionContext) => this.#compareIndex(read(instruction))), // CPX

    // 10 mm 1101: mm=00 is BSR, 10/11 are indexed/extended JSR; 01 is undefined.
    ...instructionPattern("10 00 1101", ({ fetchByte, writeByte }: InstructionContext) => this.#call(this.#relativeAddress(fetchByte()), writeByte)), // BSR rel
    ...instructionPattern("10 10 1101", ({ fetchByte, writeByte }: InstructionContext) => this.#call(this.#indexedAddress(fetchByte()), writeByte)), // JSR offset,X
    ...instructionPattern("10 11 1101", ({ fetchWord, writeByte }: InstructionContext) => this.#call(fetchWord(), writeByte)), // JSR addr

    // 1 r mm 111s: r selects SP=0/X=1; s=0 loads, s=1 stores. No immediate store.
    ...opcodeFamily("1 r mm 1110", { r: this.#wordRegisters, m: this.#wordOperandReaders },
      ({ r, m: read }) => (instruction: InstructionContext) => this.#loadWord(r, read(instruction))), // LDS / LDX
    ...this.#memoryModes.flatMap(({ bits, address }) => opcodeFamily(`1 r ${bits} 1111`, { r: this.#wordRegisters },
      ({ r }) => (instruction: InstructionContext) => this.#storeWord(r, address(instruction), instruction.writeByte))), // STS / STX

    // All 197 documented encodings are covered; undefined encodings remain unsupported.
  ]);

  #branchPair(pattern: string, condition: number): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { p: [false, true] }, ({ p: invert }) =>
      ({ fetchByte }: InstructionContext) => this.#branch(fetchByte(), motorolaConditionPairs[condition]!(this.#state.flags) !== invert));
  }

  #memoryUnaryHandlers(prefix: "0110" | "0111", address: AddressReader): readonly OpcodeEntry<OpcodeHandler>[] {
    return [
      ...this.#unaryOperations.flatMap(({ bits, apply }) => instructionPattern(`${prefix} ${bits}`,
        instruction => modifyByte(address(instruction), apply, instruction))),
      ...instructionPattern(`${prefix} 1101`, instruction => this.#test(instruction.readByte(address(instruction)))), // TST
      ...instructionPattern(`${prefix} 1110`, instruction => { this.#state.pc = address(instruction); }), // JMP
      ...instructionPattern(`${prefix} 1111`, instruction => instruction.writeByte(address(instruction), this.#alu.clear())), // CLR
    ];
  }

  // Addressing. The original 6800 adds an unsigned displacement and leaves X unchanged.

  #indexedAddress(offset: number): number {
    return (this.#state.x + offset) & 0xffff;
  }

  // Loads, stores, and accumulator operations.

  #loadAccumulator(register: Accumulator, value: number): void {
    this.#state[register] = value;
    this.#alu.test(value);
  }

  #loadWord(register: WordRegister, value: number): void {
    this.#state[register] = value;
    this.#alu.test(value, 16);
  }

  #storeAccumulator(register: Accumulator, address: number, writeByte: InstructionContext["writeByte"]): void {
    const value = this.#state[register];
    writeByte(address, value);
    this.#alu.test(value);
  }

  #storeWord(register: WordRegister, address: number, writeByte: InstructionContext["writeByte"]): void {
    const value = this.#state[register];
    writeByte(address, value >>> 8);
    writeByte((address + 1) & 0xffff, value & 0xff);
    this.#alu.test(value, 16);
  }

  #adjustIndex(delta: -1 | 1): void {
    this.#state.x = (this.#state.x + delta) & 0xffff;
    this.#state.flags.z = this.#state.x === 0;
  }

  // Control flow and stack operations.

  #branch(displacement: number, take: boolean): void {
    if (take) this.#state.pc = this.#relativeAddress(displacement);
  }

  #relativeAddress(displacement: number): number {
    // Branches and BSR fetch the displacement before computing this relative address.
    const offset = signed8(displacement);
    return (this.#state.pc + offset) & 0xffff;
  }

  #call(address: number, writeByte: InstructionContext["writeByte"]): void {
    // All instruction bytes are fetched before stacking the return PC, low byte first.
    this.#pushWord(this.#state.pc, writeByte);
    this.#state.pc = address;
  }

  #return(readByte: InstructionContext["readByte"]): void {
    this.#state.pc = this.#pullWord(readByte);
  }

  #saveInterruptFrame(writeByte: ByteMemory["writeByte"]): void {
    // Descending stack: PC low/high, X low/high, A, B, then CC with the original I.
    this.#pushWord(this.#state.pc, writeByte);
    this.#pushWord(this.#state.x, writeByte);
    this.#pushByte(this.#state.a, writeByte);
    this.#pushByte(this.#state.b, writeByte);
    this.#pushByte(packedFlags.encode(this.#state.flags), writeByte);
  }

  #enterInterrupt(vector: number, memory: ByteMemory): void {
    // WAI already saved the frame; waking only masks IRQ and loads the vector.
    if (!this.#state.waiting) this.#saveInterruptFrame(memory.writeByte);
    this.#state.waiting = false;
    this.#state.flags.i = true;
    this.#state.pc = this.#readWord(vector, memory.readByte);
  }

  #returnFromInterrupt(readByte: ByteMemory["readByte"]): void {
    this.#state.flags = packedFlags.decode(this.#pullByte(readByte));
    this.#state.b = this.#pullByte(readByte);
    this.#state.a = this.#pullByte(readByte);
    this.#state.x = this.#pullWord(readByte);
    this.#return(readByte);
  }

  #pushWord(value: number, writeByte: ByteMemory["writeByte"]): void {
    this.#pushByte(value & 0xff, writeByte);
    this.#pushByte(value >>> 8, writeByte);
  }

  #pullWord(readByte: ByteMemory["readByte"]): number {
    return readWordBE(() => this.#pullByte(readByte));
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

  // CPU-specific flag effects beyond the shared byte ALU.

  #compareIndex(value: number): void {
    // N/V describe the high-byte subtraction without a borrow from the low byte.
    // Z tests equality of the whole word; H/I/C are preserved.
    const { result, overflow } = subtract(8, this.#state.x >>> 8, value >>> 8);
    this.#state.flags.n = (result & 0x80) !== 0;
    this.#state.flags.z = this.#state.x === value;
    this.#state.flags.v = overflow;
  }

  #shiftResult(shifted: ShiftResult): number {
    const result = this.#alu.shift(shifted);
    // Every 6800 shift/rotate sets V=N XOR C; the 6809's right shifts preserve V.
    this.#state.flags.v = this.#state.flags.n !== this.#state.flags.c;
    return result;
  }

  #test(value: number): void {
    this.#alu.test(value);
    this.#state.flags.c = false; // Unlike 6809 TST, 6800 TST clears C.
  }

  // Memory operations.

  #readWord(address: number, readByte: InstructionContext["readByte"]): number {
    const high = readByte(address);
    const low = readByte((address + 1) & 0xffff);
    return (high << 8) | low;
  }
}
