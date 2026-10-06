import type { Apple2Video } from "../../src/components/devices/generated/apple2-video.js";
import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import { apple2MemoryCharacter } from "./apple2-memory-characters.js";

/** Read physical display RAM through the video specification's views, never the guest bus. */
export function apple2ScreenCell(ram: { read(address: number): number }, video: Apple2Video, row: number, column: number) {
  if (!Number.isInteger(row) || row < 0 || row >= 24 || !Number.isInteger(column) || column < 0 || column >= 40
    || !video.visibleRow(row)) return undefined;
  const address = video.textAddress(row, column), byte = ram.read(address), character = apple2MemoryCharacter(byte)!;
  return { row, column, page: video.snapshot().page2 ? 2 : 1, address, byte, character: character.character,
    attribute: character.inverse ? "inverse" : character.flashing ? "flashing" : "normal" };
}

export interface Apple2ScreenWrite {
  readonly sequence: number;
  readonly caller: DebugLocation;
  readonly bytes: readonly number[];
  readonly before: number;
  readonly after: number;
}

/** One last observed store per byte of the two text pages: bounded by 2 KiB, independent of log retention. */
export function createApple2ScreenWrites() {
  const latest = new Map<number, Apple2ScreenWrite>();
  let sequence = 0;
  return {
    at(address: number): Apple2ScreenWrite | undefined { return latest.get(address); },
    observe(record: Cpu6502StepRecord, caller: DebugLocation, writes: readonly Apple2MemoryChange[]): void {
      if (record.outcome !== "executed") return;
      sequence++;
      for (const write of writes) {
        if (write.region !== "ram" || write.address < 0x400 || write.address >= 0xc00) continue;
        // The final store wins, including unchanged stores and the final write of an RMW instruction.
        latest.set(write.address, { sequence, caller: { ...caller }, bytes: [...record.instruction.bytes], before: write.before, after: write.after });
      }
    },
    reset(): void { latest.clear(); sequence = 0; },
  };
}
