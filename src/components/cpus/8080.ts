import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep } from "./execution-records.ts";
import type { InterruptInstruction, InterruptAcknowledge } from "./interrupt-instruction.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";
import { copyState, readState } from "./state.ts";
import { cpu8080StateDescription } from "./state/8080.ts";
import type { Cpu8080State } from "./state/8080.ts";
import type { ReadonlyState } from "./state.js";
import { checkMemory, createExecution } from "./generated/8080-execution.ts";
import { sourceReaders } from "./generated/8080-state.ts";

export { cpu8080StateDescription } from "./state/8080.ts";
export type { Cpu8080State, Cpu8080Flags } from "./state/8080.ts";

export type Cpu8080Snapshot = ReadonlyState<Cpu8080State> & {
  readonly bc: number;
  readonly de: number;
  readonly hl: number;
};

export type Cpu8080MemoryAccess = MemoryAccess;
export type Cpu8080Access = MemoryAccess | PortAccess;

export type Cpu8080Instruction = FetchedInstruction;

export type Cpu8080StepRecord = InstructionStep<Cpu8080Snapshot, Cpu8080Access> | HaltedStep<Cpu8080Snapshot, Cpu8080Access>;

export type Cpu8080ResetRecord = StateTransition<Cpu8080Snapshot>;

export type Cpu8080InterruptAccess = Cpu8080Access | InterruptAcknowledge;

/** Interrupt instruction bytes have an external source, with no RAM fetch address. */
export type Cpu8080InterruptInstruction = InterruptInstruction;

export type Cpu8080InterruptRecord = StateTransition<Cpu8080Snapshot, Cpu8080InterruptAccess> & (
  | { readonly outcome: "ignored"; readonly reason: "disabled" | "deferred"; readonly instruction: null }
  | { readonly outcome: "executed" | "halted"; readonly instruction: Cpu8080InterruptInstruction }
  | { readonly outcome: "unsupported"; readonly reason: "opcode"; readonly instruction: Cpu8080InterruptInstruction }
);

/** Instruction-level Intel 8080 with chapter-defined state and execution boundaries. */
export class Cpu8080 {
  readonly #state: Cpu8080State;
  readonly #execution;
  readonly #views;

  constructor(ram: Ram, initialState: Omit<Cpu8080Snapshot, "bc" | "de" | "hl">, ports?: BytePorts) {
    checkMemory(ram);
    this.#state = readState(cpu8080StateDescription, initialState);
    this.#views = sourceReaders(this.#state).views;
    this.#execution = createExecution(this.#state, ram, () => this.snapshot(), ports);
  }

  /** Inspect a detached copy, readonly to TypeScript, without accessing RAM. */
  snapshot(): Cpu8080Snapshot {
    return { ...copyState(cpu8080StateDescription, this.#state),
      bc: this.#views.BC(), de: this.#views.DE(), hl: this.#views.HL() };
  }

  /** Reset PC and control latches, preserving data registers, SP, flags, and RAM. */
  reset(): Cpu8080ResetRecord {
    return this.#execution.reset();
  }

  /** Attempt one instruction; halted CPUs do not fetch and unsupported opcodes preserve state. */
  step(): Cpu8080StepRecord {
    return this.#execution.step();
  }

  /** Offer an interrupt at this boundary. Ignored requests are not queued and do not acknowledge. */
  interrupt(acknowledge: () => number): Cpu8080InterruptRecord {
    return this.#execution.interrupt(acknowledge);
  }
}
