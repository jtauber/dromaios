import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition } from "./execution-records.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { signed8, readWordBE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { defineState, copyState, readState, unsigned, flag, group } from "./state.ts";
import type { StateValues } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { add, subtract, shiftLeft, shiftRight } from "./alu.ts";
import type { ShiftResult } from "./alu.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu6800StateDescription = defineState({
  a: unsigned(8), b: unsigned(8), x: unsigned(16), sp: unsigned(16), pc: unsigned(16),
  flags: group({ h: flag, i: flag, n: flag, z: flag, v: flag, c: flag }),
});

export type Cpu6800State = StateValues<typeof cpu6800StateDescription>;
export type Cpu6800Flags = Cpu6800State["flags"];

export type Cpu6800Snapshot = Readonly<Omit<Cpu6800State, "flags">> & {
  readonly flags: Readonly<Cpu6800Flags>;
};

export type Cpu6800MemoryAccess = MemoryAccess;

export type Cpu6800Instruction = FetchedInstruction;

export type Cpu6800StepRecord = StateTransition<Cpu6800Snapshot> & {
  readonly instruction: Cpu6800Instruction;
} & (
  | { readonly outcome: "executed" }
  | { readonly outcome: "unsupported"; readonly reason: "opcode" }
);

export type Cpu6800ResetRecord = StateTransition<Cpu6800Snapshot>;

type OpcodeHandler = (instruction: InstructionContext) => void;
type Accumulator = "a" | "b";
type ByteOperation = (value: number) => number;
type AddressReader = (instruction: InstructionContext) => number;

const instructionPattern = opcodePattern<OpcodeHandler>;

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
    const { accesses, readByte } = recordMemory(this.#ram);
    const high = readByte(0xfffe);
    const low = readByte(0xffff);
    this.#state.pc = (high << 8) | low;
    this.#state.flags.i = true;
    return { before, after: this.snapshot(), accesses };
  }

  /** Attempt one instruction; unsupported opcodes preserve all state and RAM. */
  step(): Cpu6800StepRecord {
    const before = this.snapshot();
    const { instruction, accesses, executed } = executeByteInstruction(this.#state, this.#ram, this.#opcodeHandlers, readWordBE);
    const record = { before, after: this.snapshot(), instruction, accesses };
    return executed
      ? { ...record, outcome: "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
  }

  // Opcode selectors and construction. Each group labels its own encoding fields.

  // mm in 1 r mm oooo: immediate, direct (page zero), indexed (X + unsigned byte), extended.
  readonly #operandReaders: readonly ((instruction: InstructionContext) => number)[] = [
    ({ fetchByte }) => fetchByte(),
    ({ fetchByte, readByte }) => readByte(fetchByte()),
    ({ fetchByte, readByte }) => readByte(this.#indexedAddress(fetchByte())),
    ({ fetchWord, readByte }) => readByte(fetchWord()),
  ];

  // 01 tt oooo: tt=00 A, 01 B, 10 indexed, 11 extended; oooo selects the operation.
  // TST (1101) only reads; CLR (1111) only writes. Neither needs a byte transform.
  readonly #unaryOperations: readonly { bits: string; apply: ByteOperation }[] = [
    { bits: "0000", apply: value => this.#subtract(0, value) }, // NEG
    { bits: "0011", apply: value => this.#complement(value) }, // COM
    { bits: "0100", apply: value => this.#shiftResult(shiftRight(8, value, 0)) }, // LSR
    { bits: "0110", apply: value => this.#shiftResult(shiftRight(8, value, this.#state.flags.c ? 1 : 0)) }, // ROR
    { bits: "0111", apply: value => this.#shiftResult(shiftRight(8, value, value >= 0x80 ? 1 : 0)) }, // ASR
    { bits: "1000", apply: value => this.#shiftResult(shiftLeft(8, value, 0)) }, // ASL
    { bits: "1001", apply: value => this.#shiftResult(shiftLeft(8, value, this.#state.flags.c ? 1 : 0)) }, // ROL
    { bits: "1010", apply: value => this.#adjust(value, -1) }, // DEC
    { bits: "1100", apply: value => this.#adjust(value, 1) }, // INC
  ];

  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // 0001011 d: d=0 transfers A to B; d=1 transfers B to A. Both update N/Z/V.
    ...instructionPattern("0001011 0", () => this.#loadAccumulator("b", this.#state.a)), // TAB
    ...instructionPattern("0001011 1", () => this.#loadAccumulator("a", this.#state.b)), // TBA

    // 0010 ttt p: bits 3..1 select a condition; bit 0 selects it (0) or its inverse (1).
    // ttt=000 has only BRA. The original 6800 leaves 21 unused; it has no BRN.
    ...instructionPattern("0010 000 0", ({ fetchByte }: InstructionContext) => this.#branch(fetchByte(), true)), // BRA
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
    ...instructionPattern("0011 1001", ({ readByte }: InstructionContext) => this.#return(readByte)), // RTS

    // 010 r oooo (tt=00/01): r selects A=0/B=1. 1110 is unused here.
    ...this.#unaryOperations.flatMap(({ bits, apply }) => opcodeFamily(`010 r ${bits}`,
      { r: ["a", "b"] }, ({ r }) => () => { this.#state[r] = apply(this.#state[r]); })),
    ...opcodeFamily("010 r 1101", { r: ["a", "b"] }, ({ r }) => () => this.#test(this.#state[r])), // TSTA / TSTB
    ...opcodeFamily("010 r 1111", { r: ["a", "b"] }, ({ r }) => () => { this.#state[r] = this.#clear(); }), // CLRA / CLRB

    // 011 m oooo (tt=10/11): m selects indexed=0/extended=1. JMP (1110) is deferred.
    ...this.#memoryUnaryHandlers("0110", ({ fetchByte }) => this.#indexedAddress(fetchByte())),
    ...this.#memoryUnaryHandlers("0111", ({ fetchWord }) => fetchWord()),

    // 1 r mm oooo: r (bit 6) selects A=0/B=1; mm (bits 5–4) selects addressing;
    // oooo (bits 3–0) selects the operation, as labeled on each row.
    // Every reader supplies one byte. CMP and BIT update flags without writing the accumulator.
    ...this.#accumulatorHandlers("1 r mm 0000", (r, value) => { this.#state[r] = this.#subtract(this.#state[r], value); }), // SUBA / SUBB
    ...this.#accumulatorHandlers("1 r mm 0001", (r, value) => { this.#subtract(this.#state[r], value); }), // CMPA / CMPB
    ...this.#accumulatorHandlers("1 r mm 0010", (r, value) => { this.#state[r] = this.#subtract(this.#state[r], value, this.#state.flags.c ? 1 : 0); }), // SBCA / SBCB
    // oooo=0011 has no accumulator-byte operation on the original 6800.
    ...this.#accumulatorHandlers("1 r mm 0100", (r, value) => this.#loadAccumulator(r, this.#state[r] & value)), // ANDA / ANDB
    ...this.#accumulatorHandlers("1 r mm 0101", (r, value) => this.#setResultFlags(this.#state[r] & value)), // BITA / BITB
    ...this.#accumulatorHandlers("1 r mm 0110", (r, value) => this.#loadAccumulator(r, value)), // LDAA / LDAB
    // Stores have no immediate form: expand only the three address-bearing modes.
    ...opcodeFamily("1 r 01 0111", { r: ["a", "b"] }, ({ r }) => ({ fetchByte, writeByte }: InstructionContext) => this.#storeAccumulator(r, fetchByte(), writeByte)), // STAA / STAB direct
    ...opcodeFamily("1 r 10 0111", { r: ["a", "b"] }, ({ r }) => ({ fetchByte, writeByte }: InstructionContext) => this.#storeAccumulator(r, this.#indexedAddress(fetchByte()), writeByte)), // STAA / STAB indexed
    ...opcodeFamily("1 r 11 0111", { r: ["a", "b"] }, ({ r }) => ({ fetchWord, writeByte }: InstructionContext) => this.#storeAccumulator(r, fetchWord(), writeByte)), // STAA / STAB extended
    ...this.#accumulatorHandlers("1 r mm 1000", (r, value) => this.#loadAccumulator(r, this.#state[r] ^ value)), // EORA / EORB
    ...this.#accumulatorHandlers("1 r mm 1001", (r, value) => { this.#state[r] = this.#add(this.#state[r], value, this.#state.flags.c ? 1 : 0); }), // ADCA / ADCB
    ...this.#accumulatorHandlers("1 r mm 1010", (r, value) => this.#loadAccumulator(r, this.#state[r] | value)), // ORAA / ORAB
    ...this.#accumulatorHandlers("1 r mm 1011", (r, value) => { this.#state[r] = this.#add(this.#state[r], value); }), // ADDA / ADDB

    // 10 mm 1101: mm=00 is relative BSR; mm=11 is extended JSR. Indexed JSR is deferred.
    ...instructionPattern("10 00 1101", ({ fetchByte, writeByte }: InstructionContext) => this.#call(this.#relativeAddress(fetchByte()), writeByte)), // BSR rel
    ...instructionPattern("10 11 1101", ({ fetchWord, writeByte }: InstructionContext) => this.#call(fetchWord(), writeByte)), // JSR addr

    // 1 r mm 1110: r selects SP=0/X=1 rather than an accumulator; only immediate LDS is supported.
    ...instructionPattern("1 0 00 1110", ({ fetchWord }: InstructionContext) => this.#loadStackPointer(fetchWord())), // LDS #nn

    // Other instruction groups, including interrupt controls, are unsupported.
  ]);

  #branchPair(pattern: string, test: () => boolean): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { p: [false, true] }, ({ p: invert }) =>
      ({ fetchByte }: InstructionContext) => this.#branch(fetchByte(), test() !== invert));
  }

  #memoryUnaryHandlers(prefix: "0110" | "0111", address: AddressReader): readonly OpcodeEntry<OpcodeHandler>[] {
    return [
      ...this.#unaryOperations.flatMap(({ bits, apply }) => instructionPattern(`${prefix} ${bits}`,
        instruction => this.#modifyMemory(address(instruction), apply, instruction))),
      ...instructionPattern(`${prefix} 1101`, instruction => this.#test(instruction.readByte(address(instruction)))), // TST
      ...instructionPattern(`${prefix} 1111`, instruction => instruction.writeByte(address(instruction), this.#clear())), // CLR
    ];
  }

  #accumulatorHandlers(pattern: string, apply: (register: Accumulator, value: number) => void): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { r: ["a", "b"], m: this.#operandReaders }, ({ r, m: read }) =>
      (instruction: InstructionContext) => apply(r, read(instruction)));
  }

  // Addressing. The original 6800 adds an unsigned displacement and leaves X unchanged.

  #indexedAddress(offset: number): number {
    return (this.#state.x + offset) & 0xffff;
  }

  // Loads, stores, and accumulator operations.

  #loadAccumulator(register: Accumulator, value: number): void {
    this.#state[register] = value;
    this.#setResultFlags(value);
  }

  #loadStackPointer(value: number): void {
    this.#state.sp = value;
    this.#setResultFlags(value, 0x8000);
  }

  #storeAccumulator(register: Accumulator, address: number, writeByte: InstructionContext["writeByte"]): void {
    const value = this.#state[register];
    writeByte(address, value);
    this.#setResultFlags(value);
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

  // Arithmetic, logic, and flags.

  #add(left: number, right: number, carryIn: 0 | 1 = 0): number {
    const { result, carry, halfCarry, overflow } = add(8, left, right, carryIn);
    this.#setResultFlags(result);
    this.#state.flags.h = halfCarry;
    this.#state.flags.c = carry;
    this.#state.flags.v = overflow;
    return result;
  }

  #subtract(left: number, right: number, borrowIn: 0 | 1 = 0): number {
    const { result, borrow, overflow } = subtract(8, left, right, borrowIn);
    this.#setResultFlags(result);
    this.#state.flags.c = borrow;
    this.#state.flags.v = overflow;
    // H and I are unaffected by SUB, SBC, and CMP on the original 6800.
    return result;
  }

  #complement(value: number): number {
    const result = value ^ 0xff;
    this.#setResultFlags(result);
    this.#state.flags.c = true;
    return result;
  }

  #shiftResult({ result, carry }: ShiftResult): number {
    this.#setResultFlags(result);
    this.#state.flags.c = carry;
    // Every 6800 shift/rotate sets V=N XOR C; the 6809's right shifts preserve V.
    this.#state.flags.v = this.#state.flags.n !== carry;
    return result;
  }

  #adjust(value: number, delta: -1 | 1): number {
    const result = (value + delta) & 0xff;
    this.#setResultFlags(result);
    this.#state.flags.v = value === (delta === 1 ? 0x7f : 0x80);
    return result;
  }

  #test(value: number): void {
    this.#setResultFlags(value);
    this.#state.flags.c = false; // Unlike 6809 TST, 6800 TST clears C.
  }

  #clear(): number {
    this.#test(0);
    return 0;
  }

  #setResultFlags(value: number, signBit = 0x80): void {
    // Loads, stores, and logic share these N/Z/V rules; arithmetic may replace V afterward.
    this.#state.flags.n = (value & signBit) !== 0;
    this.#state.flags.z = value === 0;
    this.#state.flags.v = false;
  }

  // Memory operations.

  #modifyMemory(address: number, operation: ByteOperation, { readByte, writeByte }: InstructionContext): void {
    const value = readByte(address);
    writeByte(address, operation(value));
  }
}
