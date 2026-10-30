import type { DebugLocation } from "./instruction-debugger.js";
import type { StorageWrite } from "./change-log.js";

export interface MemoryRange { readonly address: number; readonly bytes?: number }
export const memoryRangeIncludes = (range: MemoryRange, address: number): boolean => address >= range.address && address < range.address + (range.bytes ?? 1);
export interface WatchBoundary {
  readonly caller: DebugLocation;
  readonly bytes: readonly number[];
  /** Interrupt/wait identity when no instruction was fetched. */
  readonly event?: string;
}
export interface WatchTransfer<Write extends StorageWrite> {
  readonly address: number;
  readonly kind: "read" | "write";
  readonly value: number;
  readonly storage?: Write;
}
export type WatchAccess<Write extends StorageWrite> = WatchBoundary & WatchTransfer<Write> & { readonly sequence: number };

/** Per-watch rings consume already observed transfers. Fetch classification and physical storage belong to the adapter. */
export function createMemoryWatchHistory<Write extends StorageWrite>(capacity = 256) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Watch history capacity must be positive.");
  type Capture = { entries: WatchAccess<Write>[]; cursor: number; captured: number };
  const captures = new Map<number, Capture>();
  let sequence = 0, configured: readonly MemoryRange[] | undefined;
  function configure(watches: readonly MemoryRange[]): void {
    if (configured === watches) return;
    configured = watches;
    const addresses = new Set(watches.map(watch => watch.address));
    for (const address of captures.keys()) if (!addresses.has(address)) captures.delete(address);
    for (const address of addresses) if (!captures.has(address)) captures.set(address, { entries: [], cursor: 0, captured: 0 });
  }
  function clear(): void { captures.clear(); configured = undefined; }
  return {
    get capacity() { return capacity; },
    configure,
    counts(watch: MemoryRange) {
      const captured = captures.get(watch.address)?.captured ?? 0;
      return { captured, discarded: Math.max(0, captured - capacity) };
    },
    /** Oldest first, preserving transfer order within each boundary. */
    entries(watch: MemoryRange): readonly WatchAccess<Write>[] {
      const capture = captures.get(watch.address);
      if (!capture) return [];
      const { entries, cursor } = capture;
      return Array.from({ length: entries.length }, (_, index) => entries[(cursor + index) % entries.length]!)
        .filter(entry => memoryRangeIncludes(watch, entry.address));
    },
    observe(boundary: WatchBoundary, watches: readonly MemoryRange[], transfers: readonly WatchTransfer<Write>[]): void {
      sequence++; configure(watches);
      for (const transfer of transfers) {
        const matching = watches.filter(watch => memoryRangeIncludes(watch, transfer.address));
        if (!matching.length) continue;
        const entry: WatchAccess<Write> = { ...boundary, caller: { ...boundary.caller }, bytes: [...boundary.bytes], sequence, ...transfer,
          ...(transfer.storage && { storage: { ...transfer.storage } }) };
        for (const watch of matching) {
          const capture = captures.get(watch.address)!;
          capture.entries[capture.cursor] = entry; capture.cursor = (capture.cursor + 1) % capacity; capture.captured++;
        }
      }
    },
    clear,
    reset(): void { clear(); sequence = 0; },
  };
}
