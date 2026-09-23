import { executionBoundary } from "./execution-boundary.ts";
import type { MemoryAccess, RecordedMemory } from "./memory-access.ts";
import type { DeviceResetContext, WordMemory, WordStep } from "./word-execution.ts";

export type WordAccess = MemoryAccess | { readonly kind: "reset" };
export type WordInterruptVector = number | "autovector" | "spurious";
export type WordInterruptAccess<Level extends number> = MemoryAccess | {
  readonly kind: "acknowledge"; readonly level: Level; readonly value: WordInterruptVector;
};

/** Guard public boundaries and record completed effects; chapter bindings supply all execution policy. */
export function wordRuntime<Snapshot, Exception, Fault, Level extends number, Interrupt>(cpu: string, snapshot: () => Snapshot,
  memory: (onAccess?: (access: MemoryAccess) => void) => RecordedMemory & WordMemory,
  hooks: {
    readonly reset: (memory: WordMemory) => Fault | void;
    readonly step: (memory: WordMemory, resetDevices: () => void) => WordStep<Exception, Fault>;
    readonly interrupt: (level: Level, acknowledge: () => WordInterruptVector, memory: WordMemory, record: (value: WordInterruptVector) => void) => Interrupt;
  }, connections?: DeviceResetContext,
) {
  const atBoundary = executionBoundary(`${cpu} step, reset, and interrupt calls must not be reentrant.`);
  return {
    reset: () => atBoundary(() => {
      const before = snapshot(), recorded = memory(), fault = hooks.reset(recorded);
      return { before, after: snapshot(), accesses: recorded.accesses, ...(fault ? { fault } : {}) };
    }),
    step: () => atBoundary(() => {
      const before = snapshot(), accesses: WordAccess[] = [];
      const recorded = memory(access => { accesses.push(access); });
      const result = hooks.step(recorded, () => {
        if (!connections) throw new Error("RESET requires a connected device reset callback.");
        connections.resetDevices();
        accesses.push({ kind: "reset" });
      });
      return { before, after: snapshot(), accesses, ...result };
    }),
    interrupt: (level: Level, acknowledge: () => WordInterruptVector) => atBoundary(() => {
      const before = snapshot(), accesses: WordInterruptAccess<Level>[] = [];
      const recorded = memory(access => { accesses.push(access); });
      const result = hooks.interrupt(level, acknowledge, recorded, value => { accesses.push({ kind: "acknowledge", level, value }); });
      return { before, after: snapshot(), instruction: null, accesses, level, ...result };
    }),
  };
}
