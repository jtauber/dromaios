import { opcodeEntries } from "./generated/6502.ts";
import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep } from "./execution-records.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { readWordLE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import { cpu6502StateDescription, cpu6502Status as packedFlags } from "./state/6502.ts";
import type { Cpu6502State } from "./state/6502.ts";
import type { ReadonlyState } from "./state.js";
import { opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";

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

// Fix the handler type once so pattern callbacks infer their instruction context.
const instructionPattern = opcodePattern<OpcodeHandler>;

/** Instruction-level NMOS 6502 with explicit boundary IRQ/NMI delivery. */
export class Cpu6502 {
  readonly #ram: Ram;
  readonly #state: Cpu6502State;
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>>;
  readonly #atBoundary = executionBoundary("6502 step, reset, and interrupt calls must not be reentrant.");

  constructor(ram: Ram, initialState: Cpu6502Snapshot) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 6502 model requires exactly 64 KiB of RAM.");
    }
    this.#ram = ram;
    this.#state = readState(cpu6502StateDescription, initialState);
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
    return [
      ...opcodeEntries(this.#state),
      // cc=00, bbb=000: aaa=000/010 select BRK/RTI; 001/011 (JSR/RTS) are generated.
      ...instructionPattern("000 000 00", instruction => this.#break(instruction)), // BRK
      ...instructionPattern("010 000 00", ({ readByte }) => this.#returnFromInterrupt(readByte)), // RTI

      // All ordinary instructions, including decimal arithmetic and status transfers, are generated.
    ];
  }

  // Control flow.

  #jump(address: number): void {
    this.#state.pc = address;
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

  // Stack operations.

  #pushByte(value: number, writeByte: InstructionContext["writeByte"]): void {
    writeByte(0x0100 | this.#state.sp, value);
    this.#state.sp = (this.#state.sp - 1) & 0xff;
  }

  #pullByte(readByte: InstructionContext["readByte"]): number {
    this.#state.sp = (this.#state.sp + 1) & 0xff;
    return readByte(0x0100 | this.#state.sp);
  }
}
