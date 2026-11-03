import { physical8088 } from "./8088-disassembly.js";
import type { Row8088 } from "./8088-disassembly.js";
import { createRomNotes } from "./rom-guide.js";
import type { RomCheckpoint, RomGuide } from "./rom-guide.js";
import { createRomReference } from "./rom-reference.js";
import type { DebugLocation } from "./instruction-debugger.js";
import { formatXtDebugAddress, parseXtDebugAddress } from "./xt-debugger.js";

/** Labels describe physical BIOS bytes; walkthrough stops retain the exact CS:IP pair. */
export function createXtRomAnnotations(guide: RomGuide) {
  const reference = createRomReference(guide.regions, guide.routines, guide.labels), notes = createRomNotes(guide.notes);
  const inRom = (address: number) => guide.regions.some(region => address >= parseInt(region.start, 16) && address <= parseInt(region.end, 16));
  return {
    reference,
    annotate(row: Row8088, loaded: boolean) {
      const address = physical8088(row.cs, row.ip), target = row.target && physical8088(row.target.cs, row.target.ip);
      return {
        entry: loaded && inRom(address) ? reference.at(address) : undefined,
        target: loaded && target !== undefined && inRom(target) ? reference.at(target) : undefined,
        note: notes({ ...row, address, romMapped: loaded && inRom(address) }),
      };
    },
  };
}

export function xtCheckpointPosition(checkpoint: RomCheckpoint, location: DebugLocation | undefined, available: boolean, running: boolean,
  matchesState?: () => boolean): string {
  if (!available || !location) return "Execution unavailable. See the Firmware and Execution panels.";
  const target = parseXtDebugAddress(checkpoint.execution ?? checkpoint.address), description = formatXtDebugAddress(target);
  if (running) return `Running · selected checkpoint ${description}.`;
  if (location.address === target.address && location.space === target.space) {
    if (matchesState && !matchesState()) return `Paused at ${description}, but the guest state does not yet match this checkpoint.`;
    return `At checkpoint ${description}. Compare the observations below.`;
  }
  return `Paused at ${formatXtDebugAddress(location)} · checkpoint ${description}.`;
}
