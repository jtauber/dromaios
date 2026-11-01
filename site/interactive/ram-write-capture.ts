import type { Ram, RamWrite } from "../../src/components/memory/ram.js";

/** Capture the first watched store during a completed boundary, including stores of the same value. */
export function createRamWriteCapture(current: () => Ram) {
  let watched = new Set<number>(), ram: Ram | undefined, detach = () => {};
  let active: { write?: RamWrite } | undefined;
  function connect(): void {
    const next = watched.size ? current() : undefined;
    if (next === ram) return;
    detach(); ram = next;
    detach = ram?.observeWrites(write => {
      if (active && !active.write && watched.has(write.address)) active.write = { ...write };
    }) ?? (() => {});
  }
  return {
    watch(addresses: Iterable<number>): void { watched = new Set(addresses); connect(); },
    capture<T>(step: () => T): { readonly record: T; readonly write?: RamWrite } {
      connect(); active = {};
      try { const record = step(); return { record, write: active.write }; }
      finally { active = undefined; }
    },
    reconnect: connect,
    dispose(): void { detach(); ram = undefined; },
  };
}
