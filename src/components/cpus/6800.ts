import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep, WaitingStep } from "./execution-records.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { readWordBE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import type { ReadonlyState } from "./state.js";
import { opcodeTable } from "./opcodes.ts";
import { instructions as semantics, opcodeEntries } from "./generated/6800.ts";
import { cpu6800StateDescription } from "./state/6800.ts";
import type { Cpu6800State } from "./state/6800.ts";

export { cpu6800StateDescription } from "./state/6800.ts";
export type { Cpu6800State, Cpu6800Flags } from "./state/6800.ts";

export type Cpu6800Snapshot = ReadonlyState<Cpu6800State>;

export type Cpu6800MemoryAccess = MemoryAccess;

export type Cpu6800Instruction = FetchedInstruction;

export type Cpu6800StepRecord = InstructionStep<Cpu6800Snapshot> | WaitingStep<Cpu6800Snapshot>;

export type Cpu6800ResetRecord = StateTransition<Cpu6800Snapshot>;

export type Cpu6800InterruptSource = "irq" | "nmi";

/** External entry performs stack/vector accesses without fetching an instruction. */
export type Cpu6800InterruptRecord = StateTransition<Cpu6800Snapshot> & { readonly instruction: null } & (
  | { readonly source: Cpu6800InterruptSource; readonly outcome: "accepted" }
  | { readonly source: "irq"; readonly outcome: "ignored"; readonly reason: "masked" }
);

type OpcodeHandler = (instruction: InstructionContext) => void;
/** Instruction-level Motorola 6800 with explicit boundary IRQ/NMI delivery. */
export class Cpu6800 {
  readonly #ram: Ram;
  readonly #state: Cpu6800State;
  readonly #atBoundary = executionBoundary("6800 step, reset, and interrupt calls must not be reentrant.");

  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>>;

  constructor(ram: Ram, initialState: Cpu6800Snapshot) {
    if (ram.size !== 0x10000) throw new RangeError("The 6800 model requires exactly 64 KiB of RAM.");
    this.#ram = ram;
    this.#state = readState(cpu6800StateDescription, initialState);
    this.#opcodeHandlers = opcodeTable(opcodeEntries(this.#state));
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
      semantics.enterInterrupt(this.#state, source === "irq" ? 0xfff8 : 0xfffc, memory);
      return { before, after: this.snapshot(), instruction: null, accesses: memory.accesses, source, outcome: "accepted" };
    });
  }

  // Memory operations.

  #readWord(address: number, readByte: InstructionContext["readByte"]): number {
    const high = readByte(address);
    const low = readByte((address + 1) & 0xffff);
    return (high << 8) | low;
  }
}
