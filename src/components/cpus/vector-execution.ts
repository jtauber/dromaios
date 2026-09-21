import type { Ram } from "../memory/ram.ts";
import { readWordBE, readWordLE } from "./binary.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { executionBoundary } from "./execution-boundary.ts";
import type { InstructionStep, StateTransition, WaitingStep } from "./execution-records.ts";
import type { WordInstructionContext } from "./instruction-context.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory } from "./memory-access.ts";

/** A declined entry can leave execution stopped or resume it without taking the interrupt. */
export interface DeclinedVector<Source extends string> {
  readonly source: Source;
  readonly outcome: "ignored" | "resumed";
  readonly reason: string;
}

/** Named entries preserve the chapter's source, outcome, and reason discriminants. */
export type VectorInterrupt<Snapshot, Source extends string, Declined extends DeclinedVector<Source>> = StateTransition<Snapshot> & {
  readonly instruction: null;
} & ({ readonly source: Source; readonly outcome: "accepted" }
  | Declined);

interface VectorExecutionPolicy<Source extends string, Declined extends DeclinedVector<Source>> {
  readonly counter: { pc: number };
  readonly word: "little" | "big";
  readonly opcodeAdvance: "dispatch" | "read";
  readonly waiting?: () => boolean;
  readonly reset: (memory: ByteMemory) => void;
  readonly handlers: Readonly<Partial<Record<number, (context: WordInstructionContext) => void>>>;
  readonly entries: Readonly<Record<Source, (memory: ByteMemory) => void>>;
  readonly decline?: (source: Source) => Declined | undefined;
}

interface VectorExecution<Snapshot, Source extends string, Declined extends DeclinedVector<Source>, Step> {
  reset(): StateTransition<Snapshot>;
  step(): Step;
  interrupt(source: Source): VectorInterrupt<Snapshot, Source, Declined>;
}

/** A waiting policy adds waiting records; models without one always attempt an opcode. */
export function vectorExecution<Snapshot, Source extends string, Declined extends DeclinedVector<Source> = never>(cpu: string, ram: Ram,
  snapshot: () => Snapshot, policy: VectorExecutionPolicy<Source, Declined> & { readonly waiting: () => boolean }):
  VectorExecution<Snapshot, Source, Declined, InstructionStep<Snapshot> | WaitingStep<Snapshot>>;
export function vectorExecution<Snapshot, Source extends string, Declined extends DeclinedVector<Source> = never>(cpu: string, ram: Ram,
  snapshot: () => Snapshot, policy: VectorExecutionPolicy<Source, Declined> & { readonly waiting?: never }):
  VectorExecution<Snapshot, Source, Declined, InstructionStep<Snapshot>>;
/** Shared byte dispatch with memory-only reset and explicit, named external entry. */
export function vectorExecution<Snapshot, Source extends string, Declined extends DeclinedVector<Source> = never>(cpu: string, ram: Ram,
  snapshot: () => Snapshot, policy: VectorExecutionPolicy<Source, Declined>) {
  const atBoundary = executionBoundary(`${cpu} step, reset, and interrupt calls must not be reentrant.`);
  const readWord = policy.word === "little" ? readWordLE : readWordBE;
  return {
    reset: (): StateTransition<Snapshot> => atBoundary(() => {
      const before = snapshot(), memory = recordMemory(ram);
      policy.reset(memory);
      return { before, after: snapshot(), accesses: memory.accesses };
    }),
    step: (): InstructionStep<Snapshot> | WaitingStep<Snapshot> => atBoundary(() => {
      const before = snapshot();
      if (policy.waiting?.()) return { before, after: snapshot(), instruction: null, accesses: [], outcome: "waiting" };
      const { instruction, accesses, executed } = executeByteInstruction(policy.counter, ram, policy.handlers, readWord,
        undefined, { opcodeAdvance: policy.opcodeAdvance });
      const transition = { before, after: snapshot(), instruction, accesses };
      return executed ? { ...transition, outcome: policy.waiting?.() ? "waiting" : "executed" }
        : { ...transition, outcome: "unsupported", reason: "opcode" };
    }),
    interrupt: (source: Source): VectorInterrupt<Snapshot, Source, Declined> => atBoundary(() => {
      if (typeof source !== "string" || !Object.hasOwn(policy.entries, source)) {
        throw new RangeError(`${cpu} interrupt source must be ${Object.keys(policy.entries).join(" or ")}.`);
      }
      const before = snapshot();
      const declined = policy.decline?.(source);
      if (declined) return { before, after: snapshot(), instruction: null, accesses: [], ...declined };
      const memory = recordMemory(ram);
      policy.entries[source](memory);
      return { before, after: snapshot(), instruction: null, accesses: memory.accesses, source, outcome: "accepted" };
    }),
  };
}
