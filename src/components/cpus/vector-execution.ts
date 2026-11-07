import type { ByteMemoryConnection } from "../memory/connection.ts";
import { readWordBE, readWordLE } from "./binary.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { executionBoundary } from "./execution-boundary.ts";
import type { InstructionStep, StateTransition, WaitingStep } from "./execution-records.ts";
import type { InstructionTimingContext, WordInstructionContext } from "./instruction-context.ts";
import { InstructionTimingUnavailable } from "./instruction-timing.ts";
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
  readonly handlers: Readonly<Partial<Record<number, (context: WordInstructionContext & InstructionTimingContext) => void>>>;
  readonly timing?: Readonly<Record<Source, number>>;
  readonly entries: Readonly<Record<Source, (memory: ByteMemory) => void>>;
  readonly decline?: (source: Source) => Declined | undefined;
}

interface VectorExecution<Snapshot, Source extends string, Declined extends DeclinedVector<Source>, Step> {
  reset(): StateTransition<Snapshot>;
  step(): Step;
  stepTimed(): Step & { readonly clocks: number };
  interrupt(source: Source): VectorInterrupt<Snapshot, Source, Declined>;
  interruptTimed(source: Source): VectorInterrupt<Snapshot, Source, Declined> & { readonly clocks: number };
}

/** A waiting policy adds waiting records; models without one always attempt an opcode. */
export function vectorExecution<Snapshot, Source extends string, Declined extends DeclinedVector<Source> = never>(cpu: string, ram: ByteMemoryConnection,
  snapshot: () => Snapshot, policy: VectorExecutionPolicy<Source, Declined> & { readonly waiting: () => boolean }):
  VectorExecution<Snapshot, Source, Declined, InstructionStep<Snapshot> | WaitingStep<Snapshot>>;
export function vectorExecution<Snapshot, Source extends string, Declined extends DeclinedVector<Source> = never>(cpu: string, ram: ByteMemoryConnection,
  snapshot: () => Snapshot, policy: VectorExecutionPolicy<Source, Declined> & { readonly waiting?: never }):
  VectorExecution<Snapshot, Source, Declined, InstructionStep<Snapshot>>;
/** Shared byte dispatch with memory-only reset and explicit, named external entry. */
export function vectorExecution<Snapshot, Source extends string, Declined extends DeclinedVector<Source> = never>(cpu: string, ram: ByteMemoryConnection,
  snapshot: () => Snapshot, policy: VectorExecutionPolicy<Source, Declined>) {
  const atBoundary = executionBoundary(`${cpu} step, reset, and interrupt calls must not be reentrant.`);
  const readWord = policy.word === "little" ? readWordLE : readWordBE;
  const runStep = (timing?: { clocks: number }): InstructionStep<Snapshot> | WaitingStep<Snapshot> => {
    const before = snapshot();
    if (policy.waiting?.()) return { before, after: snapshot(), instruction: null, accesses: [], outcome: "waiting" };
    const initialPc = policy.counter.pc;
    const { instruction, accesses, executed } = executeByteInstruction(policy.counter, ram, opcode => {
      const handler = policy.handlers[opcode];
      if (!timing) return handler;
      if (!handler) {
        policy.counter.pc = initialPc;
        throw new InstructionTimingUnavailable(cpu, initialPc, [opcode]);
      }
      return context => handler({ ...context, reportClocks: (clocks, additional = false) => {
        if (clocks === undefined || !Number.isInteger(clocks) || clocks < (additional ? 0 : 1) || clocks > 65535) {
          throw new RangeError("Instruction clocks must be a positive 16-bit integer; additions may be zero.");
        }
        if (additional && timing.clocks === 0) throw new Error("Additional clocks require an initial instruction cost.");
        timing.clocks = (additional ? timing.clocks : 0) + clocks;
      } });
    }, readWord,
      undefined, { opcodeAdvance: policy.opcodeAdvance });
    if (timing && !executed) throw new InstructionTimingUnavailable(cpu, initialPc, instruction.bytes);
    const transition = { before, after: snapshot(), instruction, accesses };
    return executed ? { ...transition, outcome: policy.waiting?.() ? "waiting" : "executed" }
      : { ...transition, outcome: "unsupported", reason: "opcode" };
  };
  const runInterrupt = (source: Source): VectorInterrupt<Snapshot, Source, Declined> => {
    if (typeof source !== "string" || !Object.hasOwn(policy.entries, source)) {
      throw new RangeError(`${cpu} interrupt source must be ${Object.keys(policy.entries).join(" or ")}.`);
    }
    const before = snapshot();
    const declined = policy.decline?.(source);
    if (declined) return { before, after: snapshot(), instruction: null, accesses: [], ...declined };
    const memory = recordMemory(ram);
    policy.entries[source](memory);
    return { before, after: snapshot(), instruction: null, accesses: memory.accesses, source, outcome: "accepted" };
  };
  const requireTiming = (): Readonly<Record<Source, number>> => {
    if (!policy.timing) throw new Error(`${cpu} has no instruction timing contract.`);
    return policy.timing;
  };
  return {
    reset: (): StateTransition<Snapshot> => atBoundary(() => {
      const before = snapshot(), memory = recordMemory(ram);
      policy.reset(memory);
      return { before, after: snapshot(), accesses: memory.accesses };
    }),
    step: () => atBoundary(() => runStep()),
    stepTimed: () => atBoundary(() => {
      requireTiming();
      const timing = { clocks: 0 }, record = runStep(timing);
      return { ...record, clocks: timing.clocks };
    }),
    interrupt: (source: Source) => atBoundary(() => runInterrupt(source)),
    interruptTimed: (source: Source) => atBoundary(() => {
      const costs = requireTiming(), record = runInterrupt(source);
      return { ...record, clocks: record.outcome === "accepted" ? costs[source] : 0 };
    }),
  };
}
