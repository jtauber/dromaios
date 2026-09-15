import type { Ram } from "../memory/ram.js";
import { flagRegister, negativeZero } from "./flags.ts";
import type { FetchedInstruction, StateTransition, InstructionStep } from "./execution-records.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { signed8, readWordLE } from "./binary.ts";
import { modifyByte } from "./memory-operations.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { defineState, copyState, readState, unsigned, flag, group } from "./state.ts";
import type { StateValues, ReadonlyState } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { add, subtract, shiftLeft, shiftRight } from "./alu.ts";
import type { ShiftResult } from "./alu.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu6502StateDescription = defineState({
  a: unsigned(8), x: unsigned(8), y: unsigned(8), sp: unsigned(8), pc: unsigned(16),
  flags: group({ n: flag, v: flag, d: flag, i: flag, z: flag, c: flag }),
});

export type Cpu6502State = StateValues<typeof cpu6502StateDescription>;
export type Cpu6502Flags = Cpu6502State["flags"];

export type Cpu6502Snapshot = ReadonlyState<Cpu6502State>;

export type Cpu6502MemoryAccess = MemoryAccess;

export type Cpu6502Instruction = FetchedInstruction;

export type Cpu6502StepRecord = InstructionStep<Cpu6502Snapshot>;

export type Cpu6502ResetRecord = StateTransition<Cpu6502Snapshot>;

export type Cpu6502InterruptSource = "irq" | "nmi";

/** External entry performs stack/vector accesses without fetching an instruction. */
export type Cpu6502InterruptRecord = StateTransition<Cpu6502Snapshot> & { readonly instruction: null } & (
  | { readonly source: Cpu6502InterruptSource; readonly outcome: "accepted" }
  | { readonly source: "irq"; readonly outcome: "ignored"; readonly reason: "masked" }
);

type OpcodeHandler = (instruction: InstructionContext) => void;
type OperandReader = (instruction: InstructionContext) => number;
type AddressResolver = (instruction: InstructionContext) => number;
type ByteOperation = (value: number) => number;
type ByteRegister = "a" | "x" | "y";

// Fix the handler type once so pattern callbacks infer their instruction context.
const instructionPattern = opcodePattern<OpcodeHandler>;

// Status bit 5 is fixed; PHP/BRK add the stacked B marker in bit 4. Neither is stored.
const packedFlags = flagRegister({ n: 7, v: 6, d: 3, i: 2, z: 1, c: 0 }, 0x20);

/** Instruction-level NMOS 6502 with explicit boundary IRQ/NMI delivery. */
export class Cpu6502 {
  readonly #ram: Ram;
  readonly #state: Cpu6502State;
  readonly #atBoundary = executionBoundary("6502 step, reset, and interrupt calls must not be reentrant.");

  constructor(ram: Ram, initialState: Cpu6502Snapshot) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 6502 model requires exactly 64 KiB of RAM.");
    }
    this.#ram = ram;
    this.#state = readState(cpu6502StateDescription, initialState);
  }

  /** Inspect a detached copy, readonly to TypeScript, without accessing RAM. */
  snapshot(): Cpu6502Snapshot {
    return copyState(cpu6502StateDescription, this.#state);
  }

  /** Reset PC, I, and SP with only the vector reads; preserve other state and RAM. */
  reset(): Cpu6502ResetRecord {
    return this.#atBoundary(() => {
      const before = this.snapshot();
      const { accesses, readByte } = recordMemory(this.#ram);
      const low = readByte(0xfffc);
      const high = readByte(0xfffd);
      this.#state.pc = low | (high << 8);
      this.#state.flags.i = true;
      this.#state.sp = (this.#state.sp - 3) & 0xff;
      return { before, after: this.snapshot(), accesses };
    });
  }

  /** Attempt one instruction; unsupported opcodes leave all state unchanged. */
  step(): Cpu6502StepRecord {
    return this.#atBoundary<Cpu6502StepRecord>(() => {
      const before = this.snapshot();
      const { instruction, accesses, executed } = executeByteInstruction(this.#state, this.#ram, this.#opcodeHandlers, readWordLE);
      const record = { before, after: this.snapshot(), instruction, accesses };
      return executed
        ? { ...record, outcome: "executed" }
        : { ...record, outcome: "unsupported", reason: "opcode" };
    });
  }

  /** Offer a selected request at this boundary; the caller owns pending signals and NMI edges. */
  interrupt(source: Cpu6502InterruptSource): Cpu6502InterruptRecord {
    return this.#atBoundary<Cpu6502InterruptRecord>(() => {
      if (source !== "irq" && source !== "nmi") throw new RangeError("6502 interrupt source must be irq or nmi.");
      const before = this.snapshot();
      // Boundary offers consult current I; cycle-level IRQ polling delays are unmodeled.
      if (source === "irq" && this.#state.flags.i) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], source, outcome: "ignored", reason: "masked" };
      }
      const memory = recordMemory(this.#ram);
      this.#enterInterrupt(source, memory);
      return { before, after: this.snapshot(), instruction: null, accesses: memory.accesses, source, outcome: "accepted" };
    });
  }

  // Opcode selectors and construction.

  // bbb (bits 4..2) in the accumulator group aaa bbb 01.
  // Each reader captures one operand; stores use the address helpers without a data read.
  readonly #accumulatorOperands: readonly OperandReader[] = [
    instruction => instruction.readByte(this.#indexedIndirect(instruction)), // 000 (zp,X)
    ({ fetchByte, readByte }) => readByte(fetchByte()),                      // 001 zp
    ({ fetchByte }) => fetchByte(),                                         // 010 #n
    ({ fetchWord, readByte }) => readByte(fetchWord()),                      // 011 addr
    instruction => instruction.readByte(this.#indirectIndexed(instruction)), // 100 (zp),Y
    instruction => instruction.readByte(this.#zeroPageIndexed("x", instruction)), // 101 zp,X
    instruction => instruction.readByte(this.#absoluteIndexed("y", instruction)), // 110 addr,Y
    instruction => instruction.readByte(this.#absoluteIndexed("x", instruction)), // 111 addr,X
  ];

  // ss (bits 6..5) in 0ss bbb 10. Rotates insert the live incoming carry; shifts insert zero.
  readonly #shifts: readonly ByteOperation[] = [
    value => this.#shiftResult(shiftLeft(8, value, 0)),                          // 00 ASL
    value => this.#shiftResult(shiftLeft(8, value, this.#state.flags.c ? 1 : 0)), // 01 ROL
    value => this.#shiftResult(shiftRight(8, value, 0)),                         // 10 LSR
    value => this.#shiftResult(shiftRight(8, value, this.#state.flags.c ? 1 : 0)), // 11 ROR
  ];

  // Opcode bits: 7 6 5 | 4 3 2 | 1 0 = aaa bbb cc.
  // cc selects a group. In cc=01, aaa selects the operation and bbb its addressing mode.
  // The cc=00 and cc=10 instructions below have their own patterns.
  // Only implemented encodings enter the table; this is not a decoder for every combination.
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // cc=00, bbb=000: aaa=000/010 select BRK/RTI; 001/011 select JSR/RTS; 101 selects LDY immediate.
    // In 11r bbb 00, r (bit 5) selects CPY (0)/CPX (1); bbb=000/001/011 select #n/zp/absolute.
    ...instructionPattern("000 000 00", instruction => this.#break(instruction)), // BRK
    ...instructionPattern("001 000 00", instruction => this.#call(instruction)), // JSR addr
    ...instructionPattern("010 000 00", ({ readByte }) => this.#returnFromInterrupt(readByte)), // RTI
    ...instructionPattern("011 000 00", ({ readByte }) => this.#return(readByte)), // RTS
    ...instructionPattern("101 000 00", ({ fetchByte }) => this.#loadRegister("y", fetchByte())), // LDY #n
    ...opcodeFamily("11r 000 00", { r: ["y", "x"] }, ({ r }) => ({ fetchByte }: InstructionContext) => this.#compare(r, fetchByte())), // CPY/CPX #n

    // cc=00, bbb=001: zero page. aaa=001 selects BIT, 100/101 select STY/LDY, 11r selects CPY/CPX.
    ...instructionPattern("001 001 00", ({ fetchByte, readByte }) => this.#testBits(readByte(fetchByte()))), // BIT zp
    ...instructionPattern("100 001 00", ({ fetchByte, writeByte }) => writeByte(fetchByte(), this.#state.y)), // STY zp
    ...instructionPattern("101 001 00", ({ fetchByte, readByte }) => this.#loadRegister("y", readByte(fetchByte()))), // LDY zp
    ...opcodeFamily("11r 001 00", { r: ["y", "x"] }, ({ r }) => ({ fetchByte, readByte }: InstructionContext) => this.#compare(r, readByte(fetchByte()))), // CPY/CPX zp

    // cc=00, bbb=010: 0rp 010 00. r (bit 6) selects status (0)/A (1); p (bit 5) selects push (0)/pull (1).
    ...instructionPattern("00 0 010 00", ({ writeByte }) => this.#pushByte(packedFlags.encode(this.#state.flags) | 0x10, writeByte)), // PHP
    ...instructionPattern("00 1 010 00", ({ readByte }) => { this.#state.flags = packedFlags.decode(this.#pullByte(readByte)); }), // PLP
    ...instructionPattern("01 0 010 00", ({ writeByte }) => this.#pushByte(this.#state.a, writeByte)), // PHA
    ...instructionPattern("01 1 010 00", ({ readByte }) => this.#loadRegister("a", this.#pullByte(readByte))), // PLA
    // aaa=100..111 selects DEY, TAY, INY, INX in this subgroup.
    ...instructionPattern("100 010 00", () => this.#adjustIndex("y", -1)), // DEY
    ...instructionPattern("101 010 00", () => this.#loadRegister("y", this.#state.a)), // TAY
    ...instructionPattern("110 010 00", () => this.#adjustIndex("y", 1)), // INY
    ...instructionPattern("111 010 00", () => this.#adjustIndex("x", 1)), // INX

    // cc=00, bbb=011: absolute operands. aaa=001 selects BIT, 010/011 JMP absolute/indirect, 100/101 STY/LDY, 11r CPY/CPX.
    ...instructionPattern("001 011 00", ({ fetchWord, readByte }) => this.#testBits(readByte(fetchWord()))), // BIT addr
    ...instructionPattern("010 011 00", ({ fetchWord }) => this.#jump(fetchWord())), // JMP addr
    ...instructionPattern("011 011 00", ({ fetchWord, readByte }) => this.#jump(this.#readPageWrappedPointer(fetchWord(), readByte))), // JMP (addr)
    ...instructionPattern("100 011 00", ({ fetchWord, writeByte }) => writeByte(fetchWord(), this.#state.y)), // STY addr
    ...instructionPattern("101 011 00", ({ fetchWord, readByte }) => this.#loadRegister("y", readByte(fetchWord()))), // LDY addr
    ...opcodeFamily("11r 011 00", { r: ["y", "x"] }, ({ r }) => ({ fetchWord, readByte }: InstructionContext) => this.#compare(r, readByte(fetchWord()))), // CPY/CPX addr

    // cc=00, bbb=100: ffv 100 00 selects a flag and the value required to branch.
    // ff (bits 7..6): 00 N, 01 V, 10 C, 11 Z.
    // v (bit 5): 0 clear (BPL/BVC/BCC/BNE), 1 set (BMI/BVS/BCS/BEQ).
    ...opcodeFamily("ff v 100 00", {
      f: ["n", "v", "c", "z"],
      v: [false, true],
    }, ({ f: flag, v: value }) => ({ fetchByte }: InstructionContext) =>
      this.#branch(fetchByte(), this.#state.flags[flag] === value)),

    // cc=00, bbb=101: aaa=100/101 select STY/LDY zero page indexed by X.
    ...instructionPattern("100 101 00", instruction => instruction.writeByte(this.#zeroPageIndexed("x", instruction), this.#state.y)), // STY zp,X
    ...instructionPattern("101 101 00", instruction => this.#loadRegister("y", instruction.readByte(this.#zeroPageIndexed("x", instruction)))), // LDY zp,X

    // cc=00, bbb=110: 00v/01v/11v select CLC/SEC, CLI/SEI, CLD/SED; v (bit 5) is the new flag value.
    // aaa=100/101 select TYA/CLV.
    ...opcodeFamily("00v 110 00", { v: [false, true] }, ({ v }) => () => { this.#state.flags.c = v; }), // CLC/SEC
    ...opcodeFamily("01v 110 00", { v: [false, true] }, ({ v }) => () => { this.#state.flags.i = v; }), // CLI/SEI
    ...instructionPattern("100 110 00", () => this.#loadRegister("a", this.#state.y)), // TYA
    ...instructionPattern("101 110 00", () => { this.#state.flags.v = false; }), // CLV
    ...opcodeFamily("11v 110 00", { v: [false, true] }, ({ v }) => () => { this.#state.flags.d = v; }), // CLD/SED

    // cc=00, bbb=111: aaa=101 selects LDY absolute indexed by X; no STY counterpart.
    ...instructionPattern("101 111 00", instruction => this.#loadRegister("y", instruction.readByte(this.#absoluteIndexed("x", instruction)))), // LDY addr,X

    // cc=01: aaa selects ORA, AND, EOR, ADC, STA, LDA, CMP, SBC in that order.
    // Read families use all eight bbb readers above. STA has seven memory forms
    // and no bbb=010 immediate encoding.
    ...this.#accumulatorHandlers("000 bbb 01", value => this.#loadRegister("a", this.#state.a | value)), // ORA
    ...this.#accumulatorHandlers("001 bbb 01", value => this.#loadRegister("a", this.#state.a & value)), // AND
    ...this.#accumulatorHandlers("010 bbb 01", value => this.#loadRegister("a", this.#state.a ^ value)), // EOR
    ...this.#accumulatorHandlers("011 bbb 01", value => this.#addWithCarry(value)), // ADC
    ...instructionPattern("100 000 01", instruction => instruction.writeByte(this.#indexedIndirect(instruction), this.#state.a)), // STA (zp,X)
    ...instructionPattern("100 001 01", ({ fetchByte, writeByte }) => writeByte(fetchByte(), this.#state.a)), // STA zp
    ...instructionPattern("100 011 01", ({ fetchWord, writeByte }) => writeByte(fetchWord(), this.#state.a)), // STA addr
    ...instructionPattern("100 100 01", instruction => instruction.writeByte(this.#indirectIndexed(instruction), this.#state.a)), // STA (zp),Y
    ...instructionPattern("100 101 01", instruction => instruction.writeByte(this.#zeroPageIndexed("x", instruction), this.#state.a)), // STA zp,X
    ...instructionPattern("100 110 01", instruction => instruction.writeByte(this.#absoluteIndexed("y", instruction), this.#state.a)), // STA addr,Y
    ...instructionPattern("100 111 01", instruction => instruction.writeByte(this.#absoluteIndexed("x", instruction), this.#state.a)), // STA addr,X
    ...this.#accumulatorHandlers("101 bbb 01", value => this.#loadRegister("a", value)), // LDA
    ...this.#accumulatorHandlers("110 bbb 01", value => this.#compare("a", value)), // CMP
    ...this.#accumulatorHandlers("111 bbb 01", value => this.#subtractWithCarry(value)), // SBC

    // cc=10, bbb=000: aaa=101 selects LDX immediate.
    ...instructionPattern("101 000 10", ({ fetchByte }) => this.#loadRegister("x", fetchByte())), // LDX #n

    // cc=10 memory subgroups: 0ss selects ASL/ROL/LSR/ROR; 11i selects DEC (i=0)/INC (i=1).
    // bbb=001/011/101/111 select zp/absolute/zp,X/absolute,X for these modifying operations.
    // STX/LDX occupy aaa=100/101 between those families and have their own indexing rules.
    // bbb=001: zero page.
    ...this.#memoryShiftHandlers("0ss 001 10", ({ fetchByte }) => fetchByte()), // ASL/ROL/LSR/ROR zp
    ...instructionPattern("100 001 10", ({ fetchByte, writeByte }) => writeByte(fetchByte(), this.#state.x)), // STX zp
    ...instructionPattern("101 001 10", ({ fetchByte, readByte }) => this.#loadRegister("x", readByte(fetchByte()))), // LDX zp
    ...this.#memoryAdjustHandlers("11i 001 10", ({ fetchByte }) => fetchByte()), // DEC/INC zp

    // bbb=010: 0ss shifts/rotates A; aaa=100..111 select TXA, TAX, DEX, NOP, not accumulator INC/DEC.
    ...opcodeFamily("0ss 010 10", { s: this.#shifts }, ({ s: modify }) => () => this.#loadRegister("a", modify(this.#state.a))), // ASL/ROL/LSR/ROR A
    ...instructionPattern("100 010 10", () => this.#loadRegister("a", this.#state.x)), // TXA
    ...instructionPattern("101 010 10", () => this.#loadRegister("x", this.#state.a)), // TAX
    ...instructionPattern("110 010 10", () => this.#adjustIndex("x", -1)), // DEX
    ...instructionPattern("111 010 10", () => {}), // NOP: step() advances PC; no further effects.

    // bbb=011: absolute.
    ...this.#memoryShiftHandlers("0ss 011 10", ({ fetchWord }) => fetchWord()), // ASL/ROL/LSR/ROR addr
    ...instructionPattern("100 011 10", ({ fetchWord, writeByte }) => writeByte(fetchWord(), this.#state.x)), // STX addr
    ...instructionPattern("101 011 10", ({ fetchWord, readByte }) => this.#loadRegister("x", readByte(fetchWord()))), // LDX addr
    ...this.#memoryAdjustHandlers("11i 011 10", ({ fetchWord }) => fetchWord()), // DEC/INC addr

    // bbb=101: zero page indexed by X, except STX/LDX use Y.
    ...this.#memoryShiftHandlers("0ss 101 10", instruction => this.#zeroPageIndexed("x", instruction)), // ASL/ROL/LSR/ROR zp,X
    ...instructionPattern("100 101 10", instruction => instruction.writeByte(this.#zeroPageIndexed("y", instruction), this.#state.x)), // STX zp,Y
    ...instructionPattern("101 101 10", instruction => this.#loadRegister("x", instruction.readByte(this.#zeroPageIndexed("y", instruction)))), // LDX zp,Y
    ...this.#memoryAdjustHandlers("11i 101 10", instruction => this.#zeroPageIndexed("x", instruction)), // DEC/INC zp,X

    // bbb=110: aaa=100/101 select TXS/TSX. Only TSX updates N/Z; TXS preserves every flag.
    ...instructionPattern("100 110 10", () => { this.#state.sp = this.#state.x; }), // TXS
    ...instructionPattern("101 110 10", () => this.#loadRegister("x", this.#state.sp)), // TSX

    // bbb=111: absolute indexed by X, except LDX uses Y; no STX counterpart.
    ...this.#memoryShiftHandlers("0ss 111 10", instruction => this.#absoluteIndexed("x", instruction)), // ASL/ROL/LSR/ROR addr,X
    ...instructionPattern("101 111 10", instruction => this.#loadRegister("x", instruction.readByte(this.#absoluteIndexed("y", instruction)))), // LDX addr,Y
    ...this.#memoryAdjustHandlers("11i 111 10", instruction => this.#absoluteIndexed("x", instruction)), // DEC/INC addr,X
  ]);

  #accumulatorHandlers(pattern: string, operation: (value: number) => void): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { b: this.#accumulatorOperands }, ({ b: readOperand }) =>
      instruction => operation(readOperand(instruction)));
  }

  #memoryShiftHandlers(pattern: string, resolveAddress: AddressResolver): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { s: this.#shifts }, ({ s: modify }) =>
      instruction => this.#modifyMemory(resolveAddress(instruction), modify, instruction));
  }

  #memoryAdjustHandlers(pattern: string, resolveAddress: AddressResolver): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { i: [-1, 1] }, ({ i: delta }) =>
      instruction => this.#modifyMemory(resolveAddress(instruction), value => (value + delta) & 0xff, instruction));
  }

  // Addressing. These helpers consume instruction operands and return data addresses.

  #zeroPageIndexed(index: "x" | "y", { fetchByte }: InstructionContext): number {
    return (fetchByte() + this.#state[index]) & 0xff;
  }

  #absoluteIndexed(index: "x" | "y", { fetchWord }: InstructionContext): number {
    return (fetchWord() + this.#state[index]) & 0xffff;
  }

  #indexedIndirect(instruction: InstructionContext): number {
    const pointer = this.#zeroPageIndexed("x", instruction);
    return this.#readPageWrappedPointer(pointer, instruction.readByte);
  }

  #indirectIndexed({ fetchByte, readByte }: InstructionContext): number {
    const address = this.#readPageWrappedPointer(fetchByte(), readByte);
    return (address + this.#state.y) & 0xffff;
  }

  #readPageWrappedPointer(pointer: number, readByte: InstructionContext["readByte"]): number {
    // Increment only the low byte: zero-page indirection and NMOS JMP both keep the pointer's page.
    const low = readByte(pointer);
    const high = readByte((pointer & 0xff00) | ((pointer + 1) & 0xff));
    return low | (high << 8);
  }

  // Loads and byte updates.

  #loadRegister(register: ByteRegister, value: number): void {
    this.#state[register] = value;
    this.#setNegativeZero(value);
  }

  #adjustIndex(register: "x" | "y", delta: -1 | 1): void {
    this.#loadRegister(register, (this.#state[register] + delta) & 0xff);
  }

  #modifyMemory(address: number, modify: ByteOperation, instruction: InstructionContext): void {
    // A shift updates C during modify; N/Z change only after the final write succeeds.
    this.#setNegativeZero(modifyByte(address, modify, instruction, "original-and-result"));
  }

  // Control flow.

  #jump(address: number): void {
    this.#state.pc = address;
  }

  #call({ fetchByte, writeByte }: InstructionContext): void {
    const low = fetchByte();
    // PC points at JSR's last byte. Push that address high first, before fetching the target high byte.
    // A stack write can replace that operand; the target low byte has already been captured.
    this.#pushByte(this.#state.pc >>> 8, writeByte);
    this.#pushByte(this.#state.pc & 0xff, writeByte);
    const high = fetchByte();
    this.#jump(low | (high << 8));
  }

  #return(readByte: InstructionContext["readByte"]): void {
    const low = this.#pullByte(readByte);
    const high = this.#pullByte(readByte);
    this.#jump(((low | (high << 8)) + 1) & 0xffff);
  }

  #break(instruction: InstructionContext): void {
    instruction.fetchByte(); // Consume the padding byte: BRK saves the address after both bytes.
    this.#enterInterrupt("brk", instruction);
  }

  #enterInterrupt(source: Cpu6502InterruptSource | "brk", { readByte, writeByte }: ByteMemory): void {
    this.#pushByte(this.#state.pc >>> 8, writeByte);
    this.#pushByte(this.#state.pc & 0xff, writeByte);
    this.#pushByte(packedFlags.encode(this.#state.flags) | (source === "brk" ? 0x10 : 0), writeByte);
    this.#state.flags.i = true; // Stack the old I first. NMOS entry preserves D and all other flags.
    const vector = source === "nmi" ? 0xfffa : 0xfffe;
    const low = readByte(vector);
    const high = readByte(vector + 1);
    this.#jump(low | (high << 8));
  }

  #returnFromInterrupt(readByte: InstructionContext["readByte"]): void {
    this.#state.flags = packedFlags.decode(this.#pullByte(readByte));
    const low = this.#pullByte(readByte);
    const high = this.#pullByte(readByte);
    this.#jump(low | (high << 8)); // Unlike RTS, RTI restores the saved PC without incrementing it.
  }

  #branch(displacement: number, take: boolean): void {
    // The operand is fetched on either path; PC now points past both instruction bytes.
    if (take) {
      const offset = signed8(displacement);
      this.#state.pc = (this.#state.pc + offset) & 0xffff;
    }
  }

  // Stack operations.

  #pushByte(value: number, writeByte: InstructionContext["writeByte"]): void {
    writeByte(0x0100 | this.#state.sp, value);
    this.#state.sp = (this.#state.sp - 1) & 0xff;
  }

  #pullByte(readByte: InstructionContext["readByte"]): number {
    this.#state.sp = (this.#state.sp + 1) & 0xff;
    return readByte(0x0100 | this.#state.sp);
  }

  // Shifts, arithmetic, and flags.

  #shiftResult({ result, carry }: ShiftResult): number {
    this.#state.flags.c = carry;
    return result; // The accumulator or memory writeback supplies N/Z.
  }

  #setNegativeZero(value: number): void {
    Object.assign(this.#state.flags, negativeZero(8, value));
  }

  #compare(register: ByteRegister, value: number): void {
    // CMP/CPX/CPY discard register - operand. C means no borrow; V and D are unaffected.
    const { result, borrow } = subtract(8, this.#state[register], value);
    this.#setNegativeZero(result);
    this.#state.flags.c = !borrow;
  }

  #testBits(value: number): void {
    // BIT copies N/V from memory, independently of the masked value used for Z.
    this.#state.flags.n = (value & 0x80) !== 0;
    this.#state.flags.v = (value & 0x40) !== 0;
    this.#state.flags.z = (this.#state.a & value) === 0;
  }

  #addWithCarry(value: number): void {
    const { a, flags } = this.#state;
    const carryIn = flags.c ? 1 : 0;
    const { result, carry, overflow } = add(8, a, value, carryIn);
    if (!flags.d) {
      this.#loadRegister("a", result);
      flags.c = carry;
      flags.v = overflow;
      return;
    }

    // Decimal digits pass at most one carry, even for invalid BCD nibbles.
    let low = (a & 0x0f) + (value & 0x0f) + carryIn;
    if (low > 9) low = ((low + 6) & 0x0f) + 0x10;
    const intermediate = (a & 0xf0) + (value & 0xf0) + low;
    // NMOS Z uses the binary result; N/V follow the low-digit correction only.
    flags.z = result === 0;
    flags.n = (intermediate & 0x80) !== 0;
    flags.v = (~(a ^ value) & (a ^ intermediate) & 0x80) !== 0;
    flags.c = intermediate >= 0xa0;
    this.#state.a = (intermediate + (flags.c ? 0x60 : 0)) & 0xff;
  }

  #subtractWithCarry(value: number): void {
    const { a, flags } = this.#state;
    const borrowIn = flags.c ? 0 : 1;
    const { result, borrow, overflow } = subtract(8, a, value, borrowIn);
    // NMOS SBC derives all four flags from binary subtraction, even with D set.
    this.#loadRegister("a", result);
    flags.c = !borrow; // Set means no borrow, allowing multi-byte subtraction.
    flags.v = overflow;
    if (flags.d) {
      let low = (a & 0x0f) - (value & 0x0f) - borrowIn;
      if (low < 0) low = ((low - 6) & 0x0f) - 0x10;
      let decimal = (a & 0xf0) - (value & 0xf0) + low;
      if (decimal < 0) decimal -= 0x60;
      this.#state.a = decimal & 0xff;
    }
  }
}
