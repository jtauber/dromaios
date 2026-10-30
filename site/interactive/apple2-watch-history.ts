import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import type { MemoryWatch } from "./apple2-watches.js";
import { createMemoryWatchHistory } from "./memory-watch-history.js";

/** The 6502 catalogue excludes instruction fetches; Apple II observations identify physical banks. */
export function createApple2WatchHistory(instructions: InstructionCatalogue, capacity = 256) {
  const history = createMemoryWatchHistory<Apple2MemoryChange>(capacity);
  return { ...history,
    observe(record: Cpu6502StepRecord, caller: DebugLocation, watches: readonly MemoryWatch[], writes: readonly Apple2MemoryChange[]): void {
      if (record.outcome !== "executed") return;
      const roles = instructions[record.instruction.bytes[0]!]?.accesses;
      let writeIndex = 0;
      const transfers = record.accesses.flatMap((access, index) => {
        let storage: Apple2MemoryChange | undefined;
        if (access.kind === "write" && writes[writeIndex]?.address === access.address && writes[writeIndex]?.after === access.value) storage = writes[writeIndex++];
        return access.kind === "read" && roles?.[index] !== "read" ? [] : [{ ...access, ...(storage && { storage }) }];
      });
      history.observe({ caller, bytes: record.instruction.bytes }, watches, transfers);
    },
  };
}
