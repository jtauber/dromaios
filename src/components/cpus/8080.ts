import type { Ram } from "../memory/ram.js";
import { callStack16LE } from "./call-stack.ts";
import { pairViews, readRegisterPair, writeRegisterPair } from "./register-pairs.ts";
import type { RegisterPair as ByteRegisterPair } from "./register-pairs.ts";
import { flagRegister } from "./flags.ts";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep } from "./execution-records.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { readWordLE } from "./binary.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { defineState, copyState, readState, unsigned, flag, boolean, group } from "./state.ts";
import type { StateValues, ReadonlyState } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import { add, subtract, shiftLeft, shiftRight, evenParity8 } from "./alu.ts";
import type { ShiftResult } from "./alu.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu8080StateDescription = defineState({
  a: unsigned(8), b: unsigned(8), c: unsigned(8), d: unsigned(8), e: unsigned(8), h: unsigned(8), l: unsigned(8),
  pc: unsigned(16), sp: unsigned(16),
  flags: group({ s: flag, z: flag, ac: flag, p: flag, cy: flag }),
  interruptEnabled: boolean, halted: boolean,
});

export type Cpu8080State = StateValues<typeof cpu8080StateDescription>;
export type Cpu8080Flags = Cpu8080State["flags"];

export type Cpu8080Snapshot = ReadonlyState<Cpu8080State> & {
  readonly bc: number;
  readonly de: number;
  readonly hl: number;
};

export type Cpu8080MemoryAccess = MemoryAccess;

export type Cpu8080Instruction = FetchedInstruction;

export type Cpu8080StepRecord = InstructionStep<Cpu8080Snapshot> | HaltedStep<Cpu8080Snapshot>;

export type Cpu8080ResetRecord = StateTransition<Cpu8080Snapshot>;

type OpcodeHandler = (instruction: InstructionContext) => void;
const instructionPattern = opcodePattern<OpcodeHandler>;

// PSW low byte: S Z 0 AC 0 P 1 CY.
const packedFlags = flagRegister({ s: 7, z: 6, ac: 4, p: 2, cy: 0 }, 0x02);

type ByteRegister = "b" | "c" | "d" | "e" | "h" | "l" | "a";

type ByteOperand = ByteRegister | "(hl)";
type WordOperand = ByteRegisterPair | "sp" | "psw";

/** Instruction-level Intel 8080 subset for the 8080 examples. */
export class Cpu8080 {
  readonly #ram: Ram;
  readonly #state: Cpu8080State;
  readonly #stack: ReturnType<typeof callStack16LE>;

  constructor(ram: Ram, initialState: Omit<Cpu8080Snapshot, "bc" | "de" | "hl">) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 8080 model requires exactly 64 KiB of RAM.");
    }
    this.#ram = ram;
    this.#state = readState(cpu8080StateDescription, initialState);
    this.#stack = callStack16LE(this.#state);
  }

  /** Inspect a detached copy, readonly to TypeScript, without accessing RAM. */
  snapshot(): Cpu8080Snapshot {
    const state = copyState(cpu8080StateDescription, this.#state);
    return { ...state, ...pairViews(state) };
  }

  /** Reset PC and control latches, preserving data registers, SP, flags, and RAM. */
  reset(): Cpu8080ResetRecord {
    const before = this.snapshot();
    this.#state.pc = 0;
    this.#state.interruptEnabled = false;
    this.#state.halted = false;
    return { before, after: this.snapshot(), accesses: [] };
  }

  /** Attempt one instruction; halted CPUs do not fetch and unsupported opcodes preserve state. */
  step(): Cpu8080StepRecord {
    const before = this.snapshot();
    if (this.#state.halted) {
      return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "halted" };
    }
    const { instruction, accesses, executed } = executeByteInstruction(this.#state, this.#ram, this.#opcodeHandlers, readWordLE);
    const record = { before, after: this.snapshot(), instruction, accesses };
    return executed
      ? { ...record, outcome: this.#state.halted ? "halted" : "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
  }

  // Register and flag views.

  get #hl(): number {
    return (this.#state.h << 8) | this.#state.l;
  }

  set #hl(value: number) {
    this.#state.h = value >>> 8;
    this.#state.l = value & 0xff;
  }

  get #psw(): number {
    return (this.#state.a << 8) | packedFlags.encode(this.#state.flags);
  }

  set #psw(value: number) {
    this.#state.a = value >>> 8;
    this.#state.flags = packedFlags.decode(value);
  }

  // Opcode selectors and construction.

  // rrr/ddd/sss select B/C/D/E/H/L/M/A; M addresses memory through HL.
  readonly #byteOperands = ["b", "c", "d", "e", "h", "l", "(hl)", "a"] as const;
  // pp selects BC/DE/HL/SP for word operations; PSW replaces SP for stack operations.
  readonly #wordOperands = ["bc", "de", "hl", "sp"] as const;
  readonly #stackOperands = ["bc", "de", "hl", "psw"] as const;

  // Three-bit ALU selector, shared by register/memory and immediate forms.
  // These closures read state at execution; CMP updates flags but retains A.
  readonly #aluOperations: readonly ((value: number) => number)[] = [
    value => this.#add(value), // 000 ADD / ADI
    value => this.#add(value, this.#state.flags.cy ? 1 : 0), // 001 ADC / ACI
    value => this.#subtract(value), // 010 SUB / SUI
    value => this.#subtract(value, this.#state.flags.cy ? 1 : 0), // 011 SBB / SBI
    value => this.#and(value), // 100 ANA / ANI
    value => this.#aluResult(this.#state.a ^ value, false, false), // 101 XRA / XRI
    value => this.#aluResult(this.#state.a | value, false, false), // 110 ORA / ORI
    value => this.#compare(value), // 111 CMP / CPI
  ];

  // ccc = ff v: ff selects Z, CY, P, S; v is the required flag value (0 or 1).
  // Predicates read flags at execution.
  readonly #conditions = (["z", "cy", "p", "s"] as const).flatMap(flag =>
    [false, true].map(value => () => this.#state.flags[flag] === value));

  // Opcode bits: 7 6 | 5 4 3 | 2 1 0 = xx yyy zzz.
  // xx selects a block below; the roles of yyy and zzz depend on that block.
  // yyy can select a byte register, ALU operation, condition, or restart vector.
  // For pair families, split yyy into pp q: pp selects a pair, q an operation.
  // Pattern separators follow these fields; repeated letters below mark selectors.
  // Only documented, implemented encodings enter the table.
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // xx = 00: zzz selects the family; yyy selects its register or operation.
    ...instructionPattern("00 000 000", () => {}), // NOP; other 00 yyy 000 encodings are undocumented.

    // 00 pp q 001: q=0 LXI, q=1 DAD.
    ...opcodeFamily("00 pp 0 001", { p: this.#wordOperands }, ({ p: operand }) => ({ fetchWord }: InstructionContext) => this.#writePair(operand, fetchWord())), // LXI
    ...opcodeFamily("00 pp 1 001", { p: this.#wordOperands }, ({ p: operand }) => () => this.#addToHl(this.#readPair(operand))), // DAD

    // 00 pp q 010: q=0 store, q=1 load.
    // pp=00/01: A through BC/DE; pp=10/11: HL/A at a direct address operand.
    ...instructionPattern("00 00 0 010", ({ writeByte }) => writeByte(this.#readPair("bc"), this.#state.a)), // STAX B
    ...instructionPattern("00 00 1 010", ({ readByte }) => { this.#state.a = readByte(this.#readPair("bc")); }), // LDAX B
    ...instructionPattern("00 01 0 010", ({ writeByte }) => writeByte(this.#readPair("de"), this.#state.a)), // STAX D
    ...instructionPattern("00 01 1 010", ({ readByte }) => { this.#state.a = readByte(this.#readPair("de")); }), // LDAX D
    ...instructionPattern("00 10 0 010", ({ fetchWord, writeByte }) => this.#storeHl(fetchWord(), writeByte)), // SHLD addr
    ...instructionPattern("00 10 1 010", ({ fetchWord, readByte }) => this.#loadHl(fetchWord(), readByte)), // LHLD addr
    ...instructionPattern("00 11 0 010", ({ fetchWord, writeByte }) => writeByte(fetchWord(), this.#state.a)), // STA addr
    ...instructionPattern("00 11 1 010", ({ fetchWord, readByte }) => { this.#state.a = readByte(fetchWord()); }), // LDA addr

    // 00 pp q 011: q=0 INX, q=1 DCX.
    ...opcodeFamily("00 pp 0 011", { p: this.#wordOperands }, ({ p: operand }) => () => this.#writePair(operand, (this.#readPair(operand) + 1) & 0xffff)), // INX
    ...opcodeFamily("00 pp 1 011", { p: this.#wordOperands }, ({ p: operand }) => () => this.#writePair(operand, (this.#readPair(operand) - 1) & 0xffff)), // DCX

    // 00 ddd 100: INR; ddd selects the destination byte operand.
    ...opcodeFamily("00 ddd 100", { d: this.#byteOperands }, ({ d: operand }) => (instruction: InstructionContext) => this.#writeOperand(operand, this.#increment(this.#readOperand(operand, instruction)), instruction)), // INR

    // 00 ddd 101: DCR.
    ...opcodeFamily("00 ddd 101", { d: this.#byteOperands }, ({ d: operand }) => (instruction: InstructionContext) => this.#writeOperand(operand, this.#decrement(this.#readOperand(operand, instruction)), instruction)), // DCR

    // 00 ddd 110: MVI.
    ...opcodeFamily("00 ddd 110", { d: this.#byteOperands }, ({ d: operand }) => (instruction: InstructionContext) => this.#writeOperand(operand, instruction.fetchByte(), instruction)), // MVI

    // 00 ooo 111: ooo selects an accumulator/carry operation (a separate selector from ALU ooo).
    ...instructionPattern("00 000 111", () => this.#rotateAccumulator(shiftLeft(8, this.#state.a, (this.#state.a & 0x80) !== 0 ? 1 : 0))), // RLC
    ...instructionPattern("00 001 111", () => this.#rotateAccumulator(shiftRight(8, this.#state.a, (this.#state.a & 1) !== 0 ? 1 : 0))), // RRC
    ...instructionPattern("00 010 111", () => this.#rotateAccumulator(shiftLeft(8, this.#state.a, this.#state.flags.cy ? 1 : 0))), // RAL
    ...instructionPattern("00 011 111", () => this.#rotateAccumulator(shiftRight(8, this.#state.a, this.#state.flags.cy ? 1 : 0))), // RAR
    ...instructionPattern("00 100 111", () => this.#decimalAdjust()), // DAA
    ...instructionPattern("00 101 111", () => { this.#state.a ^= 0xff; }), // CMA
    ...instructionPattern("00 110 111", () => { this.#state.flags.cy = true; }), // STC
    ...instructionPattern("00 111 111", () => { this.#state.flags.cy = !this.#state.flags.cy; }), // CMC

    // xx = 01: 01 ddd sss moves source sss to destination ddd.
    // HLT replaces MOV M,M at ddd=sss=110.
    ...opcodeFamily("01 ddd sss", { d: this.#byteOperands, s: this.#byteOperands }, ({ d: destination, s: source }) => this.#transferHandler(destination, source)), // MOV / HLT

    // xx = 10: 10 ooo sss applies ALU operation ooo to source sss and A.
    ...opcodeFamily("10 ooo sss", { o: this.#aluOperations, s: this.#byteOperands }, ({ o: operation, s: source }) => (instruction: InstructionContext) => { this.#state.a = operation(this.#readOperand(source, instruction)); }), // ALU r/M

    // xx = 11: zzz selects control flow, stack operations, or immediate ALU.
    // 11 ccc 000: conditional RET; ccc selects the condition.
    ...opcodeFamily("11 ccc 000", { c: this.#conditions }, ({ c: condition }) => ({ readByte }: InstructionContext) => this.#stack.return(readByte, condition())), // RET cc

    // 11 pp q 001: q=0 POP; pp selects BC, DE, HL, PSW.
    ...opcodeFamily("11 pp 0 001", { p: this.#stackOperands }, ({ p: operand }) => ({ readByte }: InstructionContext) => this.#writePair(operand, this.#stack.pop(readByte))), // POP
    // q=1 selects these operations instead; pp=01 is undocumented.
    ...instructionPattern("11 00 1 001", ({ readByte }) => this.#stack.return(readByte)), // RET
    ...instructionPattern("11 10 1 001", () => this.#jump(this.#hl)), // PCHL
    ...instructionPattern("11 11 1 001", () => { this.#state.sp = this.#hl; }), // SPHL

    // 11 ccc 010: conditional JMP.
    ...opcodeFamily("11 ccc 010", { c: this.#conditions }, ({ c: condition }) => ({ fetchWord }: InstructionContext) => this.#jump(fetchWord(), condition())), // JMP cc

    // 11 yyy 011: miscellaneous operations selected by yyy.
    // 001 is undocumented; 010/011 (OUT/IN) and 110/111 (DI/EI) are deferred.
    ...instructionPattern("11 000 011", ({ fetchWord }) => this.#jump(fetchWord())), // JMP addr
    ...instructionPattern("11 100 011", (instruction) => this.#exchangeStack(instruction)), // XTHL
    ...instructionPattern("11 101 011", () => this.#exchangeDeHl()), // XCHG

    // 11 ccc 100: conditional CALL.
    ...opcodeFamily("11 ccc 100", { c: this.#conditions }, ({ c: condition }) => ({ fetchWord, writeByte }: InstructionContext) => this.#stack.call(fetchWord(), writeByte, condition())), // CALL cc

    // 11 pp q 101: q=0 PUSH; pp selects BC, DE, HL, PSW.
    ...opcodeFamily("11 pp 0 101", { p: this.#stackOperands }, ({ p: operand }) => ({ writeByte }: InstructionContext) => this.#stack.push(this.#readPair(operand), writeByte)), // PUSH
    // q=1 selects CALL instead; only pp=00 is documented.
    ...instructionPattern("11 00 1 101", ({ fetchWord, writeByte }) => this.#stack.call(fetchWord(), writeByte)), // CALL addr

    // 11 ooo 110: same ALU selector as 10 ooo sss, with an immediate byte.
    ...opcodeFamily("11 ooo 110", { o: this.#aluOperations }, ({ o: operation }) => ({ fetchByte }: InstructionContext) => { this.#state.a = operation(fetchByte()); }), // ALU n

    // 11 nnn 111: call the vector at nnn * 8.
    ...opcodeFamily("11 nnn 111", { n: [0, 8, 16, 24, 32, 40, 48, 56] }, ({ n: vector }) => ({ writeByte }: InstructionContext) => this.#stack.call(vector, writeByte)), // RST
  ]);

  #transferHandler(destination: ByteOperand, source: ByteOperand): OpcodeHandler {
    // HLT replaces MOV M,M (ddd=sss=110); it performs no data-memory access.
    if (destination === "(hl)" && source === "(hl)") return () => this.#halt();
    return instruction => this.#writeOperand(destination, this.#readOperand(source, instruction), instruction);
  }

  // Register operands, loads, stores, and exchanges.

  #readOperand(operand: ByteOperand, { readByte }: InstructionContext): number {
    return operand === "(hl)" ? readByte(this.#hl) : this.#state[operand];
  }

  #writeOperand(operand: ByteOperand, value: number, { writeByte }: InstructionContext): void {
    if (operand === "(hl)") writeByte(this.#hl, value);
    else this.#state[operand] = value;
  }

  #readPair(pair: WordOperand): number {
    if (pair === "sp") return this.#state.sp;
    if (pair === "psw") return this.#psw;
    return readRegisterPair(this.#state, pair);
  }

  #writePair(pair: WordOperand, value: number): void {
    if (pair === "sp") this.#state.sp = value;
    else if (pair === "psw") this.#psw = value;
    else writeRegisterPair(this.#state, pair, value);
  }

  #loadHl(address: number, readByte: InstructionContext["readByte"]): void {
    const low = readByte(address);
    const high = readByte((address + 1) & 0xffff);
    this.#hl = low | (high << 8);
  }

  #storeHl(address: number, writeByte: InstructionContext["writeByte"]): void {
    writeByte(address, this.#state.l);
    writeByte((address + 1) & 0xffff, this.#state.h);
  }

  #exchangeDeHl(): void {
    const de = this.#readPair("de");
    this.#writePair("de", this.#hl);
    this.#hl = de;
  }

  #exchangeStack({ readByte, writeByte }: InstructionContext): void {
    const address = this.#state.sp;
    const highAddress = (address + 1) & 0xffff;
    const low = readByte(address);
    const high = readByte(highAddress);
    writeByte(highAddress, this.#state.h);
    writeByte(address, this.#state.l);
    this.#hl = low | (high << 8);
  }

  // Control flow and stack operations.

  #halt(): void {
    this.#state.halted = true;
  }

  #jump(address: number, take = true): void {
    if (take) this.#state.pc = address;
  }

  // Arithmetic, logic, and flags.

  #add(value: number, carryIn: 0 | 1 = 0): number {
    const { result, halfCarry, carry } = add(8, this.#state.a, value, carryIn);
    return this.#aluResult(result, halfCarry, carry);
  }

  #subtract(value: number, borrowIn: 0 | 1 = 0): number {
    const { result, borrow, halfBorrow } = subtract(8, this.#state.a, value, borrowIn);
    // CY reports a borrow; AC is the inverse of the low-nibble borrow.
    return this.#aluResult(result, !halfBorrow, borrow);
  }

  #and(value: number): number {
    const accumulator = this.#state.a;
    // ANA clears CY; AC is bit 3 of A OR the operand.
    return this.#aluResult(accumulator & value, ((accumulator | value) & 0x08) !== 0, false);
  }

  #compare(value: number): number {
    this.#subtract(value);
    // Use subtraction's flags, but retain A as the ALU result.
    return this.#state.a;
  }

  #increment(value: number): number {
    return this.#aluResult(value + 1, (value & 0x0f) === 0x0f, this.#state.flags.cy);
  }

  #decrement(value: number): number {
    // As with SUB, AC is the inverse of the low-nibble borrow; CY is preserved.
    return this.#aluResult(value - 1, (value & 0x0f) !== 0, this.#state.flags.cy);
  }

  #addToHl(value: number): void {
    const { result, carry } = add(16, this.#hl, value);
    this.#hl = result;
    this.#state.flags.cy = carry;
  }

  #decimalAdjust(): void {
    const accumulator = this.#state.a;
    const low = accumulator & 0x0f;
    const lowCorrection = low > 9 || this.#state.flags.ac ? 0x06 : 0;
    // Select both corrections from the original state; preserve incoming CY.
    const cy = accumulator > 0x99 || this.#state.flags.cy;
    const correction = lowCorrection + (cy ? 0x60 : 0);
    this.#state.a = this.#aluResult(accumulator + correction, low + lowCorrection > 0x0f, cy);
  }

  #rotateAccumulator({ result, carry }: ShiftResult): void {
    this.#state.a = result;
    this.#state.flags.cy = carry; // Rotates preserve every other flag.
  }

  #aluResult(value: number, ac: boolean, cy: boolean): number {
    const result = value & 0xff;
    this.#state.flags = {
      s: (result & 0x80) !== 0,
      z: result === 0,
      ac,
      p: evenParity8(result),
      cy,
    };
    return result;
  }
}
