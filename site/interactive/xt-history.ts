import { cpu8088StateDescription } from "../../src/components/cpus/generated/8088-cpu.js";
import type { RamWrite } from "../../src/components/memory/ram.js";
import type { XtMachine, stepXtSessionCpu } from "./xt-session.js";
import { createChangeLog } from "./change-log.js";
import type { DebugLocation } from "./instruction-debugger.js";
import { createMemoryWatchHistory } from "./memory-watch-history.js";
import type { MemoryRange, WatchTransfer } from "./memory-watch-history.js";
import { decode8088, xtHex as hex } from "./8088-disassembly.js";
import type { Catalogue8088 } from "./8088-disassembly.js";
import { xtDebugLocation, xtLogicalLocation } from "./xt-debugger.js";
import type { XtStorageRegion } from "./xt-inspection.js";
import { xtInstructionFetchCount } from "./xt-inspection.js";

type Boundary = ReturnType<typeof stepXtSessionCpu>;
export interface XtStorageWrite extends RamWrite { readonly storage: "ram" | "video" }

export function xtBoundaryEvent(record: Boundary): string | undefined {
  return record.instruction ? undefined : "source" in record ? record.source.toUpperCase()
    : record.interrupt?.source.toUpperCase() ?? record.outcome.toUpperCase();
}

/** Decode retained bytes with their original segment pair, even after the CPU or memory changes. */
export function xtHistoryAssembly(cpu: Catalogue8088, location: DebugLocation, bytes: readonly number[]): string {
  const logical = xtLogicalLocation(location);
  return logical ? decode8088(cpu, logical.cs, logical.ip, index => bytes[index]).assembly : "Unknown CS:IP";
}

export function xtStorageLabel(write: XtStorageWrite): string {
  return `${write.storage === "ram" ? "RAM" : "CGA RAM"} $${hex(write.address, 5)}`;
}

/** Observe storage once. Video aliases are reported at the chapter's first physical window. */
export function createXtChangeLog(machine: XtMachine, regions: readonly XtStorageRegion[], capacity = 500) {
  return createChangeLog({
    state: cpu8088StateDescription, counters: ["cs", "ip"], snapshot: () => machine.cpu.snapshot(),
    location: xtDebugLocation, event: xtBoundaryEvent,
    memoryLabel(write, record: Boundary | undefined, firstWrite) {
      const dma = record?.dma;
      if (firstWrite && dma?.direction === "disk-to-memory") {
        const window = regions.find(region => region.component === write.storage && dma.address >= region.start && dma.address < region.start + region.size);
        const base = regions.find(region => region.component === write.storage && region.offset === 0);
        if (window && base && write.address === base.start + window.offset + dma.address - window.start) return `DMA2 · ${xtStorageLabel(write)}`;
      }
      return xtStorageLabel(write);
    },
    observeWrites(listener: (write: XtStorageWrite) => void) {
      const storageConnections = [["ram", machine.ram], ...("video" in machine ? [["video", machine.video] as const] : [])] as const;
      const detach = storageConnections.map(([storage, connection]) => {
        const region = regions.find(region => region.component === storage && region.offset === 0)!;
        return connection.observeWrites(write => listener({ ...write, address: region.start + write.address, storage }));
      });
      return () => { for (const stop of detach) stop(); };
    },
  }, capacity);
}

/** A physical byte has one history even when both its read and write stops are configured. */
export function createXtWatchHistory(capacity = 256) {
  const history = createMemoryWatchHistory<XtStorageWrite>(capacity);
  let addresses = new Set<number>(), watches: MemoryRange[] = [];
  return { ...history,
    configure(writeWatches: readonly MemoryRange[], readWatches: readonly MemoryRange[]): void {
      addresses = new Set([...writeWatches, ...readWatches].map(watch => watch.address));
      watches = Array.from(addresses, address => ({ address }));
      history.configure(watches);
    },
    observe(record: Boundary, writes: readonly XtStorageWrite[]): void {
      if (!addresses.size || record.outcome === "unsupported") return;
      // The RAM observer includes DMA before the CPU; the CPU access record contains only its own transfers.
      const ram = writes.filter(write => write.storage === "ram" && addresses.has(write.address));
      const dma = record.dma;
      let nextWrite = 0;
      if (dma?.direction === "disk-to-memory" && ram[0]?.address === dma.address) {
        const storage = ram[nextWrite++]!;
        history.observe(() => ({ caller: xtDebugLocation(record.before), bytes: [], event: "DMA2 before CPU boundary" }), watches,
          [{ kind: "write", address: storage.address, value: storage.after, storage }]);
      }
      const transfers: WatchTransfer<XtStorageWrite>[] = [];
      for (let i = xtInstructionFetchCount(record); i < record.accesses.length; i++) {
        const access = record.accesses[i]!;
        if (access.kind === "read" && addresses.has(access.address)) transfers.push(access);
        if (access.kind === "write" && ram[nextWrite]?.address === access.address) {
          transfers.push({ ...access, storage: ram[nextWrite++]! });
        }
      }
      history.observe(() => {
        const event = xtBoundaryEvent(record);
        return { caller: xtDebugLocation(record.before), bytes: record.instruction?.bytes ?? [], ...(event && { event: `${event} · ${record.outcome}` }) };
      }, watches, transfers);
    },
  };
}
