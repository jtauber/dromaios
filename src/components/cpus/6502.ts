import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition } from "./execution-records.ts";
import { signed8, readWordLE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { defineState, copyState, readState, unsigned, flag, group } from "./state.ts";
import type { StateDescription } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { add8 } from "./alu.ts";

export interface Cpu6502Flags {
  n: boolean;
  v: boolean;
  d: boolean;
  i: boolean;
  z: boolean;
  c: boolean;
}

export interface Cpu6502State {
  a: number;
  x: number;
  y: number;
  sp: number;
  pc: number;
  flags: Cpu6502Flags;
}

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu6502StateDescription = defineState({
  a: unsigned(8), x: unsigned(8), y: unsigned(8), sp: unsigned(8), pc: unsigned(16),
  flags: group({ n: flag, v: flag, d: flag, i: flag, z: flag, c: flag }),
} satisfies StateDescription<Cpu6502State>);

export type Cpu6502Snapshot = Readonly<Omit<Cpu6502State, "flags">> & {
  readonly flags: Readonly<Cpu6502Flags>;
};

export type Cpu6502MemoryAccess = MemoryAccess;

export type Cpu6502Instruction = FetchedInstruction;

export type Cpu6502StepRecord = StateTransition<Cpu6502Snapshot> & {
  readonly instruction: Cpu6502Instruction;
} & (
  | { readonly outcome: "executed" }
  | { readonly outcome: "unsupported"; readonly reason: "opcode" | "decimal-mode" }
);

export type Cpu6502ResetRecord = StateTransition<Cpu6502Snapshot>;

type OpcodeHandler = (instruction: InstructionContext) => void;
type OperandReader = (instruction: InstructionContext) => number;
type ByteRegister = "a" | "x" | "y";

/** Instruction-level NMOS 6502 subset for the 6502 examples. */
export class Cpu6502 {
  readonly #ram: Ram;
  readonly #state: Cpu6502State;

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
    const before = this.snapshot();
    const { accesses, readByte } = recordMemory(this.#ram);
    const low = readByte(0xfffc);
    const high = readByte(0xfffd);
    this.#state.pc = low | (high << 8);
    this.#state.flags.i = true;
    this.#state.sp = (this.#state.sp - 3) & 0xff;
    return { before, after: this.snapshot(), accesses };
  }

  /** Attempt one instruction; unsupported opcodes or modes leave all state unchanged. */
  step(): Cpu6502StepRecord {
    const before = this.snapshot();
    const { accesses, readByte, writeByte } = recordMemory(this.#ram);
    const address = this.#state.pc;
    const opcode = readByte(address);
    const bytes = [opcode];
    const handler = this.#opcodeHandlers[opcode];
    // Reject decimal ADC before advancing PC or fetching its operand.
    const decimalModeUnsupported = opcode === 0b011_010_01 && this.#state.flags.d;
    if (handler && !decimalModeUnsupported) {
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
        fetchWord: () => readWordLE(fetchByte),
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
    return handler && !decimalModeUnsupported
      ? { ...record, outcome: "executed" }
      : { ...record, outcome: "unsupported", reason: decimalModeUnsupported ? "decimal-mode" : "opcode" };
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

  // Opcode bits: 7 6 5 | 4 3 2 | 1 0 = aaa bbb cc.
  // cc selects a group. In cc=01, aaa selects the operation and bbb its addressing mode.
  // The cc=00 and cc=10 instructions below have their own patterns.
  // Only implemented encodings enter the table; this is not a decoder for every combination.
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // cc=00, bbb=000: aaa=001/011 select JSR absolute/RTS implied; 101 selects LDY immediate.
    ...opcodePattern("001 000 00", (instruction: InstructionContext) => this.#call(instruction)), // JSR addr
    ...opcodePattern("011 000 00", ({ readByte }: InstructionContext) => this.#return(readByte)), // RTS
    ...opcodePattern("101 000 00", ({ fetchByte }: InstructionContext) => this.#loadRegister("y", fetchByte())), // LDY #n

    // cc=00, bbb=001: aaa=100/101 select STY/LDY zero page.
    ...opcodePattern("100 001 00", ({ fetchByte, writeByte }: InstructionContext) => writeByte(fetchByte(), this.#state.y)), // STY zp
    ...opcodePattern("101 001 00", ({ fetchByte, readByte }: InstructionContext) => this.#loadRegister("y", readByte(fetchByte()))), // LDY zp

    // cc=00, bbb=010: 01p 010 00 selects push A (p=0) or pull A (p=1).
    ...opcodePattern("01 0 010 00", ({ writeByte }: InstructionContext) => this.#pushByte(this.#state.a, writeByte)), // PHA
    ...opcodePattern("01 1 010 00", ({ readByte }: InstructionContext) => this.#loadRegister("a", this.#pullByte(readByte))), // PLA
    // aaa=100..111 selects DEY, TAY, INY, INX in this subgroup.
    ...opcodePattern("100 010 00", () => this.#adjustIndex("y", -1)), // DEY
    ...opcodePattern("101 010 00", () => this.#loadRegister("y", this.#state.a)), // TAY
    ...opcodePattern("110 010 00", () => this.#adjustIndex("y", 1)), // INY
    ...opcodePattern("111 010 00", () => this.#adjustIndex("x", 1)), // INX

    // cc=00, bbb=011: aaa=010 selects JMP absolute; 100/101 select STY/LDY absolute.
    // aaa=011 (JMP indirect) remains unsupported.
    ...opcodePattern("010 011 00", ({ fetchWord }: InstructionContext) => this.#jump(fetchWord())), // JMP addr
    ...opcodePattern("100 011 00", ({ fetchWord, writeByte }: InstructionContext) => writeByte(fetchWord(), this.#state.y)), // STY addr
    ...opcodePattern("101 011 00", ({ fetchWord, readByte }: InstructionContext) => this.#loadRegister("y", readByte(fetchWord()))), // LDY addr

    // cc=00, bbb=100: ffv 100 00 selects a flag and the value required to branch.
    // ff (bits 7..6): 00 N, 01 V, 10 C, 11 Z.
    // v (bit 5): 0 clear (BPL/BVC/BCC/BNE), 1 set (BMI/BVS/BCS/BEQ).
    ...opcodeFamily("ff v 100 00", {
      f: ["n", "v", "c", "z"],
      v: [false, true],
    }, ({ f: flag, v: value }) => ({ fetchByte }: InstructionContext) =>
      this.#branch(fetchByte(), this.#state.flags[flag] === value)),

    // cc=00, bbb=101: aaa=100/101 select STY/LDY zero page indexed by X.
    ...opcodePattern("100 101 00", (instruction: InstructionContext) => instruction.writeByte(this.#zeroPageIndexed("x", instruction), this.#state.y)), // STY zp,X
    ...opcodePattern("101 101 00", (instruction: InstructionContext) => this.#loadRegister("y", instruction.readByte(this.#zeroPageIndexed("x", instruction)))), // LDY zp,X

    // cc=00, bbb=110: aaa=000 selects CLC; aaa=100 selects TYA.
    ...opcodePattern("000 110 00", () => this.#clearCarry()), // CLC
    ...opcodePattern("100 110 00", () => this.#loadRegister("a", this.#state.y)), // TYA

    // cc=00, bbb=111: aaa=101 selects LDY absolute indexed by X; no STY counterpart.
    ...opcodePattern("101 111 00", (instruction: InstructionContext) => this.#loadRegister("y", instruction.readByte(this.#absoluteIndexed("x", instruction)))), // LDY addr,X

    // cc=01: aaa selects ORA, AND, EOR, ADC, STA, LDA, CMP, SBC in that order.
    // Complete read families use all eight bbb readers above. ADC remains immediate/binary only;
    // SBC is unsupported. STA has seven memory forms and no bbb=010 immediate encoding.
    ...this.#accumulatorHandlers("000 bbb 01", value => this.#loadRegister("a", this.#state.a | value)), // ORA
    ...this.#accumulatorHandlers("001 bbb 01", value => this.#loadRegister("a", this.#state.a & value)), // AND
    ...this.#accumulatorHandlers("010 bbb 01", value => this.#loadRegister("a", this.#state.a ^ value)), // EOR
    ...opcodePattern("011 010 01", ({ fetchByte }: InstructionContext) => this.#addWithCarry(fetchByte())), // ADC #n (binary)
    ...opcodePattern("100 000 01", (instruction: InstructionContext) => instruction.writeByte(this.#indexedIndirect(instruction), this.#state.a)), // STA (zp,X)
    ...opcodePattern("100 001 01", ({ fetchByte, writeByte }: InstructionContext) => writeByte(fetchByte(), this.#state.a)), // STA zp
    ...opcodePattern("100 011 01", ({ fetchWord, writeByte }: InstructionContext) => writeByte(fetchWord(), this.#state.a)), // STA addr
    ...opcodePattern("100 100 01", (instruction: InstructionContext) => instruction.writeByte(this.#indirectIndexed(instruction), this.#state.a)), // STA (zp),Y
    ...opcodePattern("100 101 01", (instruction: InstructionContext) => instruction.writeByte(this.#zeroPageIndexed("x", instruction), this.#state.a)), // STA zp,X
    ...opcodePattern("100 110 01", (instruction: InstructionContext) => instruction.writeByte(this.#absoluteIndexed("y", instruction), this.#state.a)), // STA addr,Y
    ...opcodePattern("100 111 01", (instruction: InstructionContext) => instruction.writeByte(this.#absoluteIndexed("x", instruction), this.#state.a)), // STA addr,X
    ...this.#accumulatorHandlers("101 bbb 01", value => this.#loadRegister("a", value)), // LDA
    ...this.#accumulatorHandlers("110 bbb 01", value => this.#compare(value)), // CMP

    // cc=10, bbb=000: aaa=101 selects LDX immediate.
    ...opcodePattern("101 000 10", ({ fetchByte }: InstructionContext) => this.#loadRegister("x", fetchByte())), // LDX #n

    // cc=10, bbb=001: aaa=100/101 select STX/LDX zero page.
    ...opcodePattern("100 001 10", ({ fetchByte, writeByte }: InstructionContext) => writeByte(fetchByte(), this.#state.x)), // STX zp
    ...opcodePattern("101 001 10", ({ fetchByte, readByte }: InstructionContext) => this.#loadRegister("x", readByte(fetchByte()))), // LDX zp

    // cc=10, bbb=010: aaa=100..110 selects TXA, TAX, DEX.
    ...opcodePattern("100 010 10", () => this.#loadRegister("a", this.#state.x)), // TXA
    ...opcodePattern("101 010 10", () => this.#loadRegister("x", this.#state.a)), // TAX
    ...opcodePattern("110 010 10", () => this.#adjustIndex("x", -1)), // DEX

    // cc=10, bbb=011: aaa=100/101 select STX/LDX absolute.
    ...opcodePattern("100 011 10", ({ fetchWord, writeByte }: InstructionContext) => writeByte(fetchWord(), this.#state.x)), // STX addr
    ...opcodePattern("101 011 10", ({ fetchWord, readByte }: InstructionContext) => this.#loadRegister("x", readByte(fetchWord()))), // LDX addr

    // cc=10, bbb=101/111: X loads/stores use Y as the index; no STX absolute,Y form.
    ...opcodePattern("100 101 10", (instruction: InstructionContext) => instruction.writeByte(this.#zeroPageIndexed("y", instruction), this.#state.x)), // STX zp,Y
    ...opcodePattern("101 101 10", (instruction: InstructionContext) => this.#loadRegister("x", instruction.readByte(this.#zeroPageIndexed("y", instruction)))), // LDX zp,Y
    ...opcodePattern("101 111 10", (instruction: InstructionContext) => this.#loadRegister("x", instruction.readByte(this.#absoluteIndexed("y", instruction)))), // LDX addr,Y
  ]);

  #accumulatorHandlers(pattern: string, operation: (value: number) => void): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { b: this.#accumulatorOperands }, ({ b: readOperand }) =>
      instruction => operation(readOperand(instruction)));
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
    return this.#readZeroPagePointer(pointer, instruction.readByte);
  }

  #indirectIndexed({ fetchByte, readByte }: InstructionContext): number {
    const address = this.#readZeroPagePointer(fetchByte(), readByte);
    return (address + this.#state.y) & 0xffff;
  }

  #readZeroPagePointer(pointer: number, readByte: InstructionContext["readByte"]): number {
    const low = readByte(pointer);
    const high = readByte((pointer + 1) & 0xff);
    return low | (high << 8);
  }

  // Loads and register operations.

  #loadRegister(register: ByteRegister, value: number): void {
    this.#state[register] = value;
    this.#setNegativeZero(value);
  }

  #adjustIndex(register: "x" | "y", delta: -1 | 1): void {
    this.#loadRegister(register, (this.#state[register] + delta) & 0xff);
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

  // Arithmetic and flags.

  #setNegativeZero(value: number): void {
    this.#state.flags.n = (value & 0x80) !== 0;
    this.#state.flags.z = value === 0;
  }

  #compare(value: number): void {
    // CMP discards A - operand. C means no borrow; V and D are unaffected.
    this.#setNegativeZero((this.#state.a - value) & 0xff);
    this.#state.flags.c = this.#state.a >= value;
  }

  #clearCarry(): void {
    this.#state.flags.c = false;
  }

  #addWithCarry(value: number): void {
    const { result, carry, overflow } = add8(this.#state.a, value, this.#state.flags.c ? 1 : 0);
    this.#loadRegister("a", result);
    this.#state.flags.c = carry;
    this.#state.flags.v = overflow;
  }
}
