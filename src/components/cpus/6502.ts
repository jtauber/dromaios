import { instructions as interrupts } from "./generated/6502-interrupts.ts";
import { opcodeEntries } from "./generated/6502.ts";
import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep } from "./execution-records.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { readWordLE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import { cpu6502StateDescription } from "./state/6502.ts";
import type { Cpu6502State } from "./state/6502.ts";
import type { ReadonlyState } from "./state.js";
import { opcodeTable } from "./opcodes.ts";

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
    this.#opcodeHandlers = opcodeTable(opcodeEntries(this.#state));
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
      interrupts.enter(this.#state, source === "nmi" ? 0xfffa : 0xfffe, memory);
      return { before, after: this.snapshot(), instruction: null, accesses: memory.accesses, source, outcome: "accepted" };
    });
  }
}
