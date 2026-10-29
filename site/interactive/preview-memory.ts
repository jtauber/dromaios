import type { MemoryAccess } from "../../src/components/cpus/memory-access.js";

/** A private overlay for copied CPUs. Its owner decides which writes are RAM, ignored, or unsafe to predict. */
export function previewMemory(read: (address: number) => number | undefined,
  writeKind: (address: number) => "ram" | "ignored" | "device") {
  const accesses: MemoryAccess[] = [], writes = new Map<number, number>();
  const unavailable = Symbol("unavailable observation");
  let blocked: { readonly kind: "read" | "write"; readonly address: number } | undefined;
  function stop(kind: "read" | "write", address: number): never { blocked = { kind, address }; throw unavailable; }
  return {
    accesses,
    get blocked() { return blocked; },
    memory: { size: 0x10000,
      read(address: number): number {
        const value = writes.get(address) ?? read(address);
        if (value === undefined) return stop("read", address);
        accesses.push({ kind: "read", address, value }); return value;
      },
      write(address: number, value: number): void {
        const kind = writeKind(address);
        if (kind === "device") stop("write", address);
        accesses.push({ kind: "write", address, value });
        if (kind === "ram") writes.set(address, value);
      },
    },
    attempt<T>(work: () => T): T | undefined {
      try { return work(); } catch (error) { if (error !== unavailable) throw error; return undefined; }
    },
  };
}
