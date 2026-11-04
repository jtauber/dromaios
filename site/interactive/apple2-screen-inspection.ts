import type { Apple2Video } from "../../src/components/devices/generated/apple2-video.js";
import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import { apple2MemoryCharacter } from "./apple2-memory-characters.js";
import type { IntegerPlot } from "./apple2-integer-plot.js";

/** Read physical display RAM through the video specification's views, never the guest bus. */
export function apple2ScreenCell(ram: { read(address: number): number }, video: Apple2Video, row: number, column: number) {
  if (!Number.isInteger(row) || row < 0 || row >= 24 || !Number.isInteger(column) || column < 0 || column >= 40
    || !video.visibleRow(row)) return undefined;
  const address = video.textAddress(row, column), byte = ram.read(address), character = apple2MemoryCharacter(byte)!;
  return { row, column, page: video.snapshot().page2 ? 2 : 1, address, byte, character: character.character,
    attribute: character.inverse ? "inverse" : character.flashing ? "flashing" : "normal" };
}

/** Low-resolution coordinates use (x, y), with two vertical pixels in each display byte. */
export function apple2LoresPixel(ram: { read(address: number): number }, video: Apple2Video, x: number, y: number) {
  if (!Number.isInteger(x) || x < 0 || x >= 40 || !Number.isInteger(y) || y < 0 || y >= 48 || !video.visibleLoresRow(y)) return undefined;
  const address = video.loresAddress(y, x), byte = ram.read(address);
  return { x, y, page: video.snapshot().page2 ? 2 : 1, address, byte, colour: video.loresColour(byte, y) };
}

export interface Apple2ScreenWrite {
  readonly sequence: number;
  readonly caller: DebugLocation;
  readonly bytes: readonly number[];
  readonly before: number;
  readonly after: number;
  readonly plot?: IntegerPlot;
}

/** Text follows the last byte store. Each low-resolution pixel follows the last change to its four bits. */
export function createApple2ScreenWrites() {
  const latest = new Map<number, Apple2ScreenWrite>();
  const low = new Map<number, Apple2ScreenWrite>(), high = new Map<number, Apple2ScreenWrite>();
  let sequence = 0;
  return {
    at(address: number): Apple2ScreenWrite | undefined { return latest.get(address); },
    colourChange(address: number, y: number): Apple2ScreenWrite | undefined { return (y & 1 ? high : low).get(address); },
    observe(record: Cpu6502StepRecord, caller: DebugLocation, writes: readonly Apple2MemoryChange[], plot?: IntegerPlot): void {
      if (record.outcome !== "executed") return;
      sequence++;
      for (const write of writes) {
        if (write.region !== "ram" || write.address < 0x400 || write.address >= 0xc00) continue;
        // The final store wins, including unchanged stores and the final write of an RMW instruction.
        const entry = { sequence, caller: { ...caller }, bytes: [...record.instruction.bytes], before: write.before, after: write.after, ...(plot && { plot }) };
        latest.set(write.address, entry);
        const changed = write.before ^ write.after;
        if (changed & 0x0f) low.set(write.address, entry);
        if (changed & 0xf0) high.set(write.address, entry);
      }
    },
    reset(): void { latest.clear(); low.clear(); high.clear(); sequence = 0; },
  };
}
