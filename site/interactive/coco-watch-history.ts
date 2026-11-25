import { dataReads6809 } from "./6809-encoding.js";
import type { stepCoco } from "../../src/machines/6809/coco/runtime.js";
import type { RamWrite } from "../../src/components/memory/ram.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { CocoAddressStop } from "./coco-debugger.js";
import { cocoBoundaryEvent } from "./coco-change-log.js";
import { createMemoryWatchHistory } from "./memory-watch-history.js";

type Boundary = ReturnType<typeof stepCoco>;
export interface CocoWriteAccess {
  readonly kind: "write";
  readonly address: number;
  readonly value: number;
  readonly storage: RamWrite;
}

/** Logical CPU reads and physical RAM writes have separate histories even when their numeric addresses coincide. */
export function createCocoWatchHistory(capacity = 256) {
  const history = createMemoryWatchHistory<RamWrite>(capacity);
  const reads = createMemoryWatchHistory<RamWrite>(capacity);
  return { ...history, reads,
    reset(): void { history.reset(); reads.reset(); },
    observe(record: Boundary, caller: DebugLocation, watches: readonly CocoAddressStop[], writes: readonly RamWrite[], readWatches: readonly CocoAddressStop[] = []): readonly CocoWriteAccess[] {
      if (record.outcome !== "executed" && record.outcome !== "accepted") return [];
      const event = cocoBoundaryEvent(record);
      const transfers = writes.map(storage => ({ address: storage.address, value: storage.after, kind: "write" as const, storage }));
      const boundary = { caller, bytes: record.instruction?.bytes ?? [], ...(event && { event: `${event} · ${record.outcome}` }) };
      history.observe(boundary, watches, transfers);
      reads.observe(boundary, readWatches, readWatches.length ? dataReads6809(record) : []);
      return transfers;
    },
  };
}
