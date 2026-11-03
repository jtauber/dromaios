import type { Cpu8088Snapshot } from "../../src/components/cpus/generated/8088-cpu.js";
import type { Ram } from "../../src/components/memory/ram.js";
import { physical8088 } from "./8088-disassembly.js";
import type { RomCheckpoint } from "./rom-guide.js";

type UltimaObservation = { readonly missingFile: string }
  | { readonly party: readonly [number, number, number]; readonly partyRead?: true };
export interface XtCheckpoint extends RomCheckpoint { readonly expect?: UltimaObservation }

// DOS loads SAVED.GAM into 1BD3:55A6 in the audited CGA and EGA installations.
const partyBuffer = physical8088(0x1bd3, 0x55a6);
export const ultimaPartyLocation = partyBuffer + 0x2ed;

/** Inspect the DOS result or the party record without reading a device or advancing the XT. */
export function matchesUltimaObservation(expect: UltimaObservation, cpu: Cpu8088Snapshot, ram: Ram): boolean {
  if ("missingFile" in expect) {
    if (!cpu.flags.cf || cpu.ax !== 2) return false;
    const name = expect.missingFile + "\0";
    for (let i = 0; i < name.length; i++) {
      const address = physical8088(cpu.ds, cpu.dx + i);
      if (address >= ram.size || ram.read(address) !== name.charCodeAt(i)) return false;
    }
    return true;
  }
  if (expect.partyRead && (cpu.flags.cf || cpu.ax !== 4192 || physical8088(cpu.ds, cpu.dx) !== partyBuffer)) return false;
  const [location, x, y] = expect.party;
  return ram.read(ultimaPartyLocation) === location && ram.read(partyBuffer + 0x2f0) === x && ram.read(partyBuffer + 0x2f1) === y;
}
