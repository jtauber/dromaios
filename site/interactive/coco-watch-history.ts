import type { stepCoco } from "../../src/machines/6809/coco/runtime.js";
import type { RamWrite } from "../../src/components/memory/ram.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { CocoAddressStop } from "./coco-debugger.js";
import { cocoBoundaryEvent } from "./coco-change-log.js";
import { createMemoryWatchHistory } from "./memory-watch-history.js";

/** CoCo watches capture completed physical RAM writes, including interrupt entry and unchanged stores. */
export function createCocoWatchHistory(capacity = 256) {
  const history = createMemoryWatchHistory<RamWrite>(capacity);
  return { ...history,
    observe(record: ReturnType<typeof stepCoco>, caller: DebugLocation, watches: readonly CocoAddressStop[], writes: readonly RamWrite[]): void {
      if (record.outcome !== "executed" && record.outcome !== "accepted") return;
      const event = cocoBoundaryEvent(record);
      history.observe({ caller, bytes: record.instruction?.bytes ?? [], ...(event && { event: `${event} · ${record.outcome}` }) }, watches,
        writes.map(storage => ({ address: storage.address, value: storage.after, kind: "write" as const, storage })));
    },
  };
}
