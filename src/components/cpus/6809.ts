import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition } from "./execution-records.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { signed8, readWordBE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { defineState, copyState, readState, unsigned, flag, group } from "./state.ts";
import type { StateValues } from "./state.js";
import type { OpcodeEntry } from "./opcodes.ts";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import { add, subtract } from "./alu.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu6809StateDescription = defineState({
  a: unsigned(8), b: unsigned(8), dp: unsigned(8),
  x: unsigned(16), y: unsigned(16), s: unsigned(16), u: unsigned(16), pc: unsigned(16),
  flags: group({ e: flag, f: flag, h: flag, i: flag, n: flag, z: flag, v: flag, c: flag }),
});

export type Cpu6809State = StateValues<typeof cpu6809StateDescription>;
export type Cpu6809Flags = Cpu6809State["flags"];

export type Cpu6809Snapshot = Readonly<Omit<Cpu6809State, "flags">> & {
  readonly flags: Readonly<Cpu6809Flags>;
  readonly d: number;
};

export type Cpu6809MemoryAccess = MemoryAccess;

export type Cpu6809Instruction = FetchedInstruction;

export type Cpu6809StepRecord = StateTransition<Cpu6809Snapshot> & {
  readonly instruction: Cpu6809Instruction;
} & (
  | { readonly outcome: "executed" }
  | { readonly outcome: "unsupported"; readonly reason: "opcode" }
);

export type Cpu6809ResetRecord = StateTransition<Cpu6809Snapshot>;

type OpcodeHandler = (instruction: InstructionContext) => void;
type Accumulator = "a" | "b";
type StackPointer = "s" | "u";
type ByteOperation = (value: number) => number;
type AccumulatorOperation = (register: Accumulator, value: number) => void;
type OperandReader = (instruction: InstructionContext) => number;

const instructionPattern = opcodePattern<OpcodeHandler>;

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
    const { instruction, accesses, executed } = executeByteInstruction(this.#state, this.#ram, this.#opcodeHandlers, readWordBE);
    const record = { before, after: this.snapshot(), instruction, accesses };
    return executed
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

  // Unary encodings: 0000 oooo = direct, 010r oooo = A/B, 0111 oooo = extended.
  // r=0 selects A, r=1 selects B. The 0110 indexed group remains unsupported.
  // TST (1101) is read-only and JMP (1110) changes PC; neither is a byte transform.
  readonly #unaryOperations: readonly { bits: string; apply: ByteOperation }[] = [
    { bits: "0000", apply: value => this.#negate(value) }, // NEG
    { bits: "0011", apply: value => this.#complement(value) }, // COM
    { bits: "0100", apply: value => this.#shiftRight(value, 0) }, // LSR
    { bits: "0110", apply: value => this.#shiftRight(value, this.#state.flags.c ? 1 : 0) }, // ROR
    { bits: "0111", apply: value => this.#shiftRight(value, value >= 0x80 ? 1 : 0) }, // ASR
    { bits: "1000", apply: value => this.#shiftLeft(value, 0) }, // ASL (LSL)
    { bits: "1001", apply: value => this.#shiftLeft(value, this.#state.flags.c ? 1 : 0) }, // ROL
    { bits: "1010", apply: value => this.#adjust(value, -1) }, // DEC
    { bits: "1100", apply: value => this.#adjust(value, 1) }, // INC
    { bits: "1111", apply: () => this.#clear() }, // CLR
  ];

  // Accumulator encodings: 1 r mm oooo, r=0 A / r=1 B.
  // mm=00 immediate, 01 direct, 10 indexed (unsupported), 11 extended.
  // The listed oooo values take byte operands; 0111 stores are separate below.
  readonly #accumulatorOperations: readonly { bits: string; apply: AccumulatorOperation }[] = [
    { bits: "0000", apply: (r, value) => { this.#state[r] = this.#subtract(this.#state[r], value); } }, // SUBA/B
    { bits: "0001", apply: (r, value) => { this.#subtract(this.#state[r], value); } }, // CMPA/B
    { bits: "0010", apply: (r, value) => { this.#state[r] = this.#subtract(this.#state[r], value, this.#state.flags.c ? 1 : 0); } }, // SBCA/B
    { bits: "0100", apply: (r, value) => this.#loadAccumulator(r, this.#state[r] & value) }, // ANDA/B
    { bits: "0101", apply: (r, value) => this.#test(this.#state[r] & value) }, // BITA/B
    { bits: "0110", apply: (r, value) => this.#loadAccumulator(r, value) }, // LDA/B
    { bits: "1000", apply: (r, value) => this.#loadAccumulator(r, this.#state[r] ^ value) }, // EORA/B
    { bits: "1001", apply: (r, value) => { this.#state[r] = this.#add(this.#state[r], value, this.#state.flags.c ? 1 : 0); } }, // ADCA/B
    { bits: "1010", apply: (r, value) => this.#loadAccumulator(r, this.#state[r] | value) }, // ORA/B
    { bits: "1011", apply: (r, value) => { this.#state[r] = this.#add(this.#state[r], value); } }, // ADDA/B
  ];

  readonly #directOperandAddress: OperandReader = ({ fetchByte }) => this.#directAddress(fetchByte());
  readonly #extendedOperandAddress: OperandReader = ({ fetchWord }) => fetchWord();

  // Base opcode page only; prefix bytes 10 and 11 remain unsupported.
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // 0000 oooo: direct unary operations; 1110 is JMP instead of a byte operation.
    ...this.#memoryUnaryHandlers("0000", this.#directOperandAddress),
    ...instructionPattern("0000 1110", instruction => { this.#state.pc = this.#directOperandAddress(instruction); }), // JMP direct

    ...instructionPattern("0001 0010", () => {}), // NOP
    ...instructionPattern("0001 0110", ({ fetchWord }) => { this.#state.pc = this.#relativeAddress(fetchWord()); }), // LBRA rel16
    ...instructionPattern("0001 0111", ({ fetchWord, writeByte }) => this.#call(this.#relativeAddress(fetchWord()), writeByte)), // LBSR rel16

    // 0010 ttt p: bits 3..1 select the test above; bit 0 inverts it.
    ...opcodeFamily("0010 ttt p", {
      t: this.#branchConditions,
      p: [false, true],
    }, ({ t: test, p: invert }) => ({ fetchByte }: InstructionContext) =>
      this.#branch(signed8(fetchByte()), test() !== invert)),

    // 001101 s p: s=0 selects S, s=1 selects U; p=0 pushes, p=1 pulls.
    ...instructionPattern("001101 0 0", ({ fetchByte, writeByte }) => this.#pushRegisters("s", fetchByte(), writeByte)), // PSHS
    ...instructionPattern("001101 0 1", ({ fetchByte, readByte }) => this.#pullRegisters("s", fetchByte(), readByte)), // PULS
    ...instructionPattern("001101 1 0", ({ fetchByte, writeByte }) => this.#pushRegisters("u", fetchByte(), writeByte)), // PSHU
    ...instructionPattern("001101 1 1", ({ fetchByte, readByte }) => this.#pullRegisters("u", fetchByte(), readByte)), // PULU
    ...instructionPattern("0011 1001", ({ readByte }) => { this.#state.pc = this.#pullWord("s", readByte); }), // RTS

    // 010 r oooo: A/B unary operations. TST updates flags without writing a result.
    ...this.#unaryOperations.flatMap(({ bits, apply }) => opcodeFamily(`010 r ${bits}`, {
      r: ["a", "b"],
    }, ({ r: register }) => () => { this.#state[register] = apply(this.#state[register]); })),
    ...opcodeFamily("010 r 1101", { r: ["a", "b"] }, ({ r: register }) => () => this.#test(this.#state[register])), // TSTA/B

    // 0110 oooo (indexed) is unsupported; 0111 oooo uses an extended address.
    ...this.#memoryUnaryHandlers("0111", this.#extendedOperandAddress),
    ...instructionPattern("0111 1110", ({ fetchWord }) => { this.#state.pc = fetchWord(); }), // JMP extended

    // 1 r mm oooo: A/B byte operations, grouped by mm. No immediate stores.
    ...this.#accumulatorHandlers("00", ({ fetchByte }) => fetchByte()),
    ...instructionPattern("1 0 00 1101", ({ fetchByte, writeByte }) => this.#call(this.#relativeAddress(signed8(fetchByte())), writeByte)), // BSR rel8

    ...this.#accumulatorHandlers("01", instruction => instruction.readByte(this.#directOperandAddress(instruction))),
    ...this.#storeHandlers("1 r 01 0111", this.#directOperandAddress), // STA/B direct
    ...instructionPattern("1 0 01 1101", instruction => this.#call(this.#directOperandAddress(instruction), instruction.writeByte)), // JSR direct

    // mm=10 indexed forms remain unsupported, including indexed JMP and JSR.
    ...this.#accumulatorHandlers("11", instruction => instruction.readByte(this.#extendedOperandAddress(instruction))),
    ...this.#storeHandlers("1 r 11 0111", this.#extendedOperandAddress), // STA/B extended
    ...instructionPattern("1 0 11 1101", ({ fetchWord, writeByte }) => this.#call(fetchWord(), writeByte)), // JSR extended
  ]);

  #memoryUnaryHandlers(prefix: "0000" | "0111", address: OperandReader): readonly OpcodeEntry<OpcodeHandler>[] {
    return [
      ...this.#unaryOperations.flatMap(({ bits, apply }) => instructionPattern(`${prefix} ${bits}`,
        instruction => this.#modifyMemory(address(instruction), apply, instruction))),
      ...instructionPattern(`${prefix} 1101`, instruction => this.#test(instruction.readByte(address(instruction)))), // TST
    ];
  }

  #accumulatorHandlers(mode: "00" | "01" | "11", readOperand: OperandReader): readonly OpcodeEntry<OpcodeHandler>[] {
    return this.#accumulatorOperations.flatMap(({ bits, apply }) => opcodeFamily(`1 r ${mode} ${bits}`, {
      r: ["a", "b"],
    }, ({ r: register }) => (instruction: InstructionContext) => apply(register, readOperand(instruction))));
  }

  #storeHandlers(pattern: string, address: OperandReader): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { r: ["a", "b"] }, ({ r: register }) =>
      (instruction: InstructionContext) => this.#storeAccumulator(register, address(instruction), instruction.writeByte));
  }

  // Addressing.

  #directAddress(offset: number): number {
    return (this.#state.dp << 8) | offset;
  }

  // Loads and stores.

  #loadAccumulator(register: Accumulator, value: number): void {
    this.#state[register] = value;
    this.#test(value);
  }

  #storeAccumulator(register: Accumulator, address: number, writeByte: InstructionContext["writeByte"]): void {
    const value = this.#state[register];
    writeByte(address, value);
    this.#test(value);
  }

  // Control flow.

  #relativeAddress(offset: number): number {
    // PC is past the operand. Modulo 65536 also interprets a word's two's-complement offset.
    return (this.#state.pc + offset) & 0xffff;
  }

  #branch(offset: number, take: boolean): void {
    if (take) this.#state.pc = this.#relativeAddress(offset);
  }

  #call(address: number, writeByte: InstructionContext["writeByte"]): void {
    // Fetch the complete operand before stacking the return PC on S, low byte first.
    this.#pushWord("s", this.#state.pc, writeByte);
    this.#state.pc = address;
  }

  // Stack operations.
  // Postbyte bits 7..0: PC, other stack pointer, Y, X, DP, B, A, CC.
  // Bit 6 always names the pointer not selected by the opcode's s bit.

  #pushRegisters(stack: StackPointer, mask: number, writeByte: InstructionContext["writeByte"]): void {
    const pushByte = (value: number): void => this.#pushByte(stack, value, writeByte);
    const pushWord = (value: number): void => this.#pushWord(stack, value, writeByte);
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
    const pullByte = (): number => this.#pullByte(stack, readByte);
    const pullWord = (): number => this.#pullWord(stack, readByte);
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

  #pushByte(stack: StackPointer, value: number, writeByte: InstructionContext["writeByte"]): void {
    this.#state[stack] = (this.#state[stack] - 1) & 0xffff;
    writeByte(this.#state[stack], value);
  }

  #pushWord(stack: StackPointer, value: number, writeByte: InstructionContext["writeByte"]): void {
    this.#pushByte(stack, value & 0xff, writeByte);
    this.#pushByte(stack, value >>> 8, writeByte);
  }

  #pullByte(stack: StackPointer, readByte: InstructionContext["readByte"]): number {
    const value = readByte(this.#state[stack]);
    this.#state[stack] = (this.#state[stack] + 1) & 0xffff;
    return value;
  }

  #pullWord(stack: StackPointer, readByte: InstructionContext["readByte"]): number {
    return readWordBE(() => this.#pullByte(stack, readByte));
  }

  // Arithmetic, logic, and flags.

  #add(left: number, right: number, carryIn: 0 | 1 = 0): number {
    const { result, carry, halfCarry, overflow } = add(8, left, right, carryIn);
    this.#setNZ(result);
    this.#state.flags.h = halfCarry;
    this.#state.flags.c = carry;
    this.#state.flags.v = overflow;
    return result;
  }

  #subtract(left: number, right: number, borrowIn: 0 | 1 = 0): number {
    const { result, borrow, overflow } = subtract(8, left, right, borrowIn);
    this.#setNZ(result);
    this.#state.flags.v = overflow;
    this.#state.flags.c = borrow;
    // H is undefined for subtraction; this model preserves it.
    return result;
  }

  #negate(value: number): number {
    return this.#subtract(0, value);
  }

  #complement(value: number): number {
    const result = value ^ 0xff;
    this.#test(result);
    this.#state.flags.c = true;
    return result;
  }

  #shiftRight(value: number, incomingBit: 0 | 1): number {
    const result = (value >>> 1) | (incomingBit << 7);
    this.#setNZ(result);
    this.#state.flags.c = (value & 1) !== 0;
    // Unlike left shifts, LSR, ROR, and ASR preserve V on the 6809.
    return result;
  }

  #shiftLeft(value: number, incomingBit: 0 | 1): number {
    const result = ((value << 1) | incomingBit) & 0xff;
    this.#setNZ(result);
    this.#state.flags.c = (value & 0x80) !== 0;
    this.#state.flags.v = this.#state.flags.n !== this.#state.flags.c;
    return result;
  }

  #adjust(value: number, delta: -1 | 1): number {
    const result = (value + delta) & 0xff;
    this.#setNZ(result);
    this.#state.flags.v = value === (delta === 1 ? 0x7f : 0x80);
    return result;
  }

  #clear(): number {
    this.#test(0);
    this.#state.flags.c = false;
    return 0;
  }

  #test(value: number): void {
    // Loads, stores, logic, and TST share N/Z from the result and V=0.
    this.#setNZ(value);
    this.#state.flags.v = false;
  }

  #setNZ(value: number): void {
    this.#state.flags.n = (value & 0x80) !== 0;
    this.#state.flags.z = value === 0;
  }

  // Memory operations.

  #modifyMemory(address: number, operation: ByteOperation, { readByte, writeByte }: InstructionContext): void {
    // CLR also reads the addressed byte. TST is bound separately because it never writes.
    const value = readByte(address);
    writeByte(address, operation(value));
  }
}
