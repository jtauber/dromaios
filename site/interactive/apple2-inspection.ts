import type { createApple2Session } from "./apple2-session.js";
import { checkUnsigned } from "../../src/components/validation.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
export const apple2RamRegions = [
  { part: "ram", base: 0, label: "RAM" }, { part: "bank1", base: 0xd000, label: "LC bank 1" },
  { part: "bank2", base: 0xd000, label: "LC bank 2" }, { part: "upper", base: 0xe000, label: "LC upper" },
] as const;

export interface Apple2MemoryChange {
  readonly region: typeof apple2RamRegions[number]["part"];
  readonly address: number;
  readonly before: number;
  readonly after: number;
}

/** Storage and pure device observations only; deliberately excludes the guest bus. */
export type Apple2Storage = {
  readonly [K in "ram" | "firmware" | "bank1" | "bank2" | "upper"]: Pick<Machine[K], "read">;
} & { readonly language: Pick<Machine["language"], "snapshot">; readonly disk: Pick<Machine["disk"], "snapshot"> };

/** Only highlight changed bytes in the bank currently visible through the memory reader. */
export function apple2MemoryHighlights(storage: Apple2Storage, writes: readonly Apple2MemoryChange[]): ReadonlyMap<number, Apple2MemoryChange> {
  const language = storage.language.snapshot(), changes = new Map<number, Apple2MemoryChange>();
  const visible = new Set<Apple2MemoryChange["region"]>(["ram"]);
  if (language.ram_read) { visible.add(language.bank2 ? "bank2" : "bank1"); visible.add("upper"); }
  for (const write of writes) {
    if (!visible.has(write.region)) continue;
    const previous = changes.get(write.address);
    changes.set(write.address, { ...write, before: previous?.before ?? write.before });
  }
  // Several stores to one byte may restore its instruction-boundary value.
  for (const [address, change] of changes) if (change.before === change.after) changes.delete(address);
  return changes;
}

/** Capture the bank selection once for a view, without operating any soft switches. */
export function apple2StorageReader(storage: Apple2Storage): (address: number) => number | undefined {
  const language = storage.language.snapshot(), bootstrap = storage.disk.snapshot().bootstrap;
  return address => {
    checkUnsigned("Memory address", address, 0xffff);
    if (address < 0xc000) return storage.ram.read(address);
    if (address >= 0xc600 && address < 0xc700) return bootstrap?.[address - 0xc600];
    if (address < 0xd000) return undefined;
    if (!language.ram_read) {
      const byte = storage.firmware.read(address - 0xd000);
      return byte === "bus-error" ? undefined : byte;
    }
    if (address >= 0xe000) return storage.upper.read(address - 0xe000);
    return (language.bank2 ? storage.bank2 : storage.bank1).read(address - 0xd000);
  };
}

/** The memory window stops at FFFF instead of wrapping into zero page. */
export function apple2MemoryAddresses(start: number, length: number): readonly number[] {
  checkUnsigned("Memory address", start, 0xffff);
  checkUnsigned("Memory view length", length, 0x10000);
  return Array.from({ length: Math.min(length, 0x10000 - start) }, (_, offset) => start + offset);
}
