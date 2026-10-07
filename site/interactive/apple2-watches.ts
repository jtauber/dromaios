import { parseApple2Address } from "./apple2-explorer.js";
import { memoryValue } from "./apple2-workspace-values.js";

export const memoryWatchModes = ["read", "write", "change"] as const;
export type MemoryWatchMode = typeof memoryWatchModes[number];
export type MemoryWatchBytes = 1 | 2;
export interface MemoryWatch {
  readonly address: number;
  readonly label: string;
  /** Absent on older preferences, which remain byte watches. */
  readonly bytes?: MemoryWatchBytes;
  readonly stop?: readonly MemoryWatchMode[];
}

/** Saved addresses, labels and stop choices; never captured machine values. */
export function decodeMemoryWatches(saved: string | null): readonly MemoryWatch[] {
  try {
    const rows: unknown = JSON.parse(saved ?? "[]");
    if (!Array.isArray(rows) || rows.length > 64) return [];
    const addresses = new Set<number>();
    return rows.filter((row): row is MemoryWatch => {
      if (!row || typeof row !== "object" || !Number.isInteger(row.address) || row.address < 0 || row.address > 0xffff
        || typeof row.label !== "string" || row.label.length > 64 || addresses.has(row.address)
        || row.bytes !== undefined && row.bytes !== 1 && row.bytes !== 2
        || row.bytes === 2 && row.address === 0xffff
        || row.stop !== undefined && (!Array.isArray(row.stop) || row.stop.some((mode: unknown) => !memoryWatchModes.includes(mode as MemoryWatchMode)))) return false;
      addresses.add(row.address); return true;
    }).map(({ address, label, bytes, stop }) => ({ address, label, ...(bytes !== undefined && { bytes }), ...(stop && { stop: [...new Set(stop)] }) }));
  } catch { return []; }
}

export function addMemoryWatch(watches: readonly MemoryWatch[], address: string, label: string, stop?: MemoryWatchMode, bytes?: MemoryWatchBytes): readonly MemoryWatch[] {
  const value = parseApple2Address(address), existing = watches.find(watch => watch.address === value);
  const width = bytes ?? existing?.bytes ?? 1;
  if (value + width > 0x10000) throw new RangeError("A word watch needs two consecutive bytes; its address must be 0000–FFFE.");
  if (!existing && watches.length >= 64) throw new RangeError("Keep at most 64 watched addresses.");
  const watch = { ...existing, address: value, label: label.trim().slice(0, 64),
    ...(bytes !== undefined && { bytes }),
    ...(stop && { stop: [...new Set([...existing?.stop ?? [], stop])] }) };
  return existing ? watches.map(item => item.address === value ? watch : item) : [...watches, watch];
}

export function sampleMemoryWatches(watches: readonly MemoryWatch[], read: (address: number) => number | undefined,
  previous: ReadonlyMap<number, number | undefined> = new Map()) {
  return watches.map(watch => {
    const value = memoryValue(watch.address, watch.bytes ?? 1, read), before = previous.get(watch.address);
    return { ...watch, value, before, changed: value !== undefined && before !== undefined && value !== before };
  });
}
