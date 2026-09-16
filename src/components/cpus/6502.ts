import { opcodeEntries, sourceReaders } from "./generated/6502.ts";
import type { Ram } from "../memory/ram.js";
import { flagRegister, negativeZero } from "./flags.ts";
import type { FetchedInstruction, StateTransition, InstructionStep } from "./execution-records.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { signed8, readWordLE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import { cpu6502StateDescription } from "./state/6502.ts";
import type { Cpu6502State } from "./state/6502.ts";
import type { ReadonlyState } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { add, subtract } from "./alu.ts";

export { cpu6502StateDescription } from "./state/6502.ts";
export type { Cpu6502State, Cpu6502Flags } from "./state/6502.ts";

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
type ByteRegister = "a" | "x" | "y";

// Fix the handler type once so pattern callbacks infer their instruction context.
const instructionPattern = opcodePattern<OpcodeHandler>;

// Status bit 5 is fixed; PHP/BRK add the stacked B marker in bit 4. Neither is stored.
const packedFlags = flagRegister({ n: 7, v: 6, d: 3, i: 2, z: 1, c: 0 }, 0x20);

/** Instruction-level NMOS 6502 with explicit boundary IRQ/NMI delivery. */
export class Cpu6502 {
  readonly #ram: Ram;
  readonly #state: Cpu6502State;
  readonly #readers: ReturnType<typeof sourceReaders>;
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>>;
  readonly #atBoundary = executionBoundary("6502 step, reset, and interrupt calls must not be reentrant.");

  constructor(ram: Ram, initialState: Cpu6502Snapshot) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 6502 model requires exactly 64 KiB of RAM.");
    }
    this.#ram = ram;
    this.#state = readState(cpu6502StateDescription, initialState);
    this.#readers = sourceReaders(this.#state);
    this.#opcodeHandlers = opcodeTable(this.#instructionEntries());
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

  // Opcode bits: 7 6 5 | 4 3 2 | 1 0 = aaa bbb cc.
  // cc selects a group. In cc=01, aaa selects the operation and bbb its addressing mode.
  // Migrated patterns and bodies live together in semantics/definitions/6502.ts.
  // Only implemented encodings enter the table; this is not a decoder for every combination.
  #instructionEntries(): readonly OpcodeEntry<OpcodeHandler>[] {
    const { addresses } = this.#readers;
    return [
      ...opcodeEntries(this.#state),
      // cc=00, bbb=000: aaa=000/010 select BRK/RTI; 001/011 select JSR/RTS.
      ...instructionPattern("000 000 00", instruction => this.#break(instruction)), // BRK
      ...instructionPattern("001 000 00", instruction => this.#call(instruction)), // JSR addr
      ...instructionPattern("010 000 00", ({ readByte }) => this.#returnFromInterrupt(readByte)), // RTI
      ...instructionPattern("011 000 00", ({ readByte }) => this.#return(readByte)), // RTS

      // cc=00, bbb=001: aaa=001 selects BIT zero page.
      ...instructionPattern("001 001 00", instruction => this.#testBits(instruction.readByte(addresses.zeroPage(instruction)))), // BIT zp

      // cc=00, bbb=010: 0rp 010 00. r (bit 6) selects status (0)/A (1); p (bit 5) selects push (0)/pull (1).
      ...instructionPattern("00 0 010 00", ({ writeByte }) => this.#pushByte(packedFlags.encode(this.#state.flags) | 0x10, writeByte)), // PHP
      ...instructionPattern("00 1 010 00", ({ readByte }) => { this.#state.flags = packedFlags.decode(this.#pullByte(readByte)); }), // PLP
      ...instructionPattern("01 0 010 00", ({ writeByte }) => this.#pushByte(this.#state.a, writeByte)), // PHA
      ...instructionPattern("01 1 010 00", ({ readByte }) => this.#loadRegister("a", this.#pullByte(readByte))), // PLA
      // TAY and DEY/INY/INX are generated.

      // cc=00, bbb=011: aaa=001 selects BIT, 010/011 JMP absolute/indirect.
      ...instructionPattern("001 011 00", instruction => this.#testBits(instruction.readByte(addresses.absolute(instruction)))), // BIT addr
      ...instructionPattern("010 011 00", instruction => this.#jump(addresses.absolute(instruction))), // JMP addr
      ...instructionPattern("011 011 00", instruction => this.#jump(this.#readPageWrappedPointer(addresses.absolute(instruction), instruction.readByte))), // JMP (addr)

      // cc=00, bbb=100: ffv 100 00 selects a flag and the value required to branch.
      // ff (bits 7..6): 00 N, 01 V, 10 C, 11 Z.
      // v (bit 5): 0 clear (BPL/BVC/BCC/BNE), 1 set (BMI/BVS/BCS/BEQ).
      ...opcodeFamily("ff v 100 00", {
        f: ["n", "v", "c", "z"],
        v: [false, true],
      }, ({ f: flag, v: value }) => ({ fetchByte }: InstructionContext) =>
        this.#branch(fetchByte(), this.#state.flags[flag] === value)),

      // cc=00, bbb=110: 00v/01v/11v select CLC/SEC, CLI/SEI, CLD/SED; v (bit 5) is the new flag value.
      // aaa=101 selects CLV; TYA is generated.
      ...opcodeFamily("00v 110 00", { v: [false, true] }, ({ v }) => () => { this.#state.flags.c = v; }), // CLC/SEC
      ...opcodeFamily("01v 110 00", { v: [false, true] }, ({ v }) => () => { this.#state.flags.i = v; }), // CLI/SEI
      ...instructionPattern("101 110 00", () => { this.#state.flags.v = false; }), // CLV
      ...opcodeFamily("11v 110 00", { v: [false, true] }, ({ v }) => () => { this.#state.flags.d = v; }), // CLD/SED

      // cc=01: aaa selects ORA, AND, EOR, ADC, STA, LDA, CMP, SBC in that order.
      // Remaining read families use the generated bbb operand readers; STA/LDA/CMP are generated.
      ...this.#accumulatorHandlers("000 bbb 01", value => this.#loadRegister("a", this.#state.a | value)), // ORA
      ...this.#accumulatorHandlers("001 bbb 01", value => this.#loadRegister("a", this.#state.a & value)), // AND
      ...this.#accumulatorHandlers("010 bbb 01", value => this.#loadRegister("a", this.#state.a ^ value)), // EOR
      ...this.#accumulatorHandlers("011 bbb 01", value => this.#addWithCarry(value)), // ADC
      ...this.#accumulatorHandlers("111 bbb 01", value => this.#subtractWithCarry(value)), // SBC

      // cc=10: shifts/rotates, DEC/INC, DEX, LDX/STX, and transfers are generated.
      // aaa=111, bbb=010 is NOP, not accumulator INC.
      ...instructionPattern("111 010 10", () => {}), // NOP: step() advances PC; no further effects.
    ];
  }

  #accumulatorHandlers(pattern: string, operation: (value: number) => void): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { b: Object.values(this.#readers.operands) }, ({ b: readOperand }) =>
      instruction => operation(readOperand(instruction)));
  }

  // Indirect JMP retains the NMOS page-wrap behavior.

  #readPageWrappedPointer(pointer: number, readByte: InstructionContext["readByte"]): number {
    // Increment only the low byte: JMP (xxFF) reads the high target byte from xx00.
    const low = readByte(pointer);
    const high = readByte((pointer & 0xff00) | ((pointer + 1) & 0xff));
    return low | (high << 8);
  }

  // Loads.

  #loadRegister(register: ByteRegister, value: number): void {
    this.#state[register] = value;
    this.#setNegativeZero(value);
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

  // Arithmetic and flags.

  #setNegativeZero(value: number): void {
    Object.assign(this.#state.flags, negativeZero(8, value));
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
