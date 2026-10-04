import { apple2MemoryHighlights } from "./apple2-inspection.js";
import type { Apple2MemoryChange, Apple2Storage, MemoryRowWidth } from "./apple2-inspection.js";
import { checkUnsigned } from "../../src/components/validation.js";

export type Apple2MemoryMode = "fixed" | "pc" | "changes";
export const apple2MemoryWindowSize = 128;

/** Observe every instruction, but move the window only when its inspector refreshes. */
export function createApple2MemoryPosition() {
  let start = 0x400, mode: Apple2MemoryMode = "fixed", lastChange: Apple2MemoryChange | undefined;
  return {
    get mode() { return mode; },
    set mode(value: Apple2MemoryMode) { mode = value; },
    browse(address: number): void {
      checkUnsigned("Memory address", address, 0xffff);
      start = address; mode = "fixed";
    },
    observe(storage: Apple2Storage, writes: readonly Apple2MemoryChange[]): void {
      if (!writes.length) return;
      const changes = apple2MemoryHighlights(storage, writes);
      // Map insertion order is not write order when an instruction writes a byte twice.
      for (let index = writes.length - 1; index >= 0; index--) {
        const write = writes[index]!;
        if (changes.get(write.address)?.region === write.region) { lastChange = changes.get(write.address); break; }
      }
    },
    reset(): void { lastChange = undefined; },
    refresh(storage: Apple2Storage, pc: number, rowWidth: MemoryRowWidth = 8,
      visibleBytes = apple2MemoryWindowSize, visibleStart = start): { start: number; target: number | undefined } {
      // A later bank switch can hide the last changed byte. Do not follow it into ROM or another bank.
      const changed = lastChange && apple2MemoryHighlights(storage, [lastChange]).has(lastChange.address) ? lastChange.address : undefined;
      const target = mode === "pc" ? pc : mode === "changes" ? changed : undefined;
      if (target !== undefined && (target < visibleStart || target >= visibleStart + visibleBytes)) {
        start = Math.min(target - target % rowWidth, Math.max(0, 0x10000 - visibleBytes));
      }
      return { start, target };
    },
  };
}
