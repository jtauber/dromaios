import type { Ram } from "../memory/ram.ts";
import { readWordBE, readWordLE } from "./binary.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { executionBoundary } from "./execution-boundary.ts";
import type { InstructionStep, StateTransition } from "./execution-records.ts";
import type { WordInstructionContext } from "./instruction-context.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory } from "./memory-access.ts";

/** Named boundary entries carry no opcode; only declared masked sources can be ignored. */
export type VectorInterrupt<Snapshot, Source extends string, Masked extends Source> = StateTransition<Snapshot> & {
  readonly instruction: null;
} & ({ readonly source: Source; readonly outcome: "accepted" }
  | { readonly source: Masked; readonly outcome: "ignored"; readonly reason: "masked" });

interface VectorExecutionPolicy<Source extends string, Masked extends Source> {
  readonly counter: { pc: number };
  readonly word: "little" | "big";
  readonly opcodeAdvance: "dispatch" | "read";
  readonly reset: (memory: ByteMemory) => void;
  readonly handlers: Readonly<Partial<Record<number, (context: WordInstructionContext) => void>>>;
  readonly entries: Readonly<Record<Source, (memory: ByteMemory) => void>>;
  readonly masks: Readonly<Record<Masked, () => boolean>>;
}

/** Shared byte dispatch with memory-only reset and explicit, named external entry. */
export function vectorExecution<Snapshot, Source extends string, Masked extends Source>(cpu: string, ram: Ram,
  snapshot: () => Snapshot, policy: VectorExecutionPolicy<Source, Masked>) {
  const atBoundary = executionBoundary(`${cpu} step, reset, and interrupt calls must not be reentrant.`);
  const readWord = policy.word === "little" ? readWordLE : readWordBE;
  return {
    reset: (): StateTransition<Snapshot> => atBoundary(() => {
      const before = snapshot(), memory = recordMemory(ram);
      policy.reset(memory);
      return { before, after: snapshot(), accesses: memory.accesses };
    }),
    step: (): InstructionStep<Snapshot> => atBoundary(() => {
      const before = snapshot();
      const { instruction, accesses, executed } = executeByteInstruction(policy.counter, ram, policy.handlers, readWord,
        undefined, { opcodeAdvance: policy.opcodeAdvance });
      const transition = { before, after: snapshot(), instruction, accesses };
      return executed ? { ...transition, outcome: "executed" }
        : { ...transition, outcome: "unsupported", reason: "opcode" };
    }),
    interrupt: (source: Source): VectorInterrupt<Snapshot, Source, Masked> => atBoundary(() => {
      if (typeof source !== "string" || !Object.hasOwn(policy.entries, source)) {
        throw new RangeError(`${cpu} interrupt source must be ${Object.keys(policy.entries).join(" or ")}.`);
      }
      const before = snapshot();
      // Membership narrows the source to the explicitly declared mask keys.
      if (Object.hasOwn(policy.masks, source) && policy.masks[source as Masked]()) {
        return { before, after: snapshot(), instruction: null, accesses: [], source: source as Masked, outcome: "ignored", reason: "masked" };
      }
      const memory = recordMemory(ram);
      policy.entries[source](memory);
      return { before, after: snapshot(), instruction: null, accesses: memory.accesses, source, outcome: "accepted" };
    }),
  };
}
