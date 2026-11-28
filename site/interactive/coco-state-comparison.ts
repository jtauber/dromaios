import { cpu6809StateDescription } from "../../src/components/cpus/generated/6809-cpu.js";
import { readState } from "../../src/components/cpus/state.js";
import { checkUnsigned } from "../../src/components/validation.js";
import { Mc6821 } from "../../src/components/devices/generated/mc6821.js";
import { Mc6847 } from "../../src/components/devices/generated/mc6847.js";
import { Mc6883 } from "../../src/components/devices/generated/mc6883.js";
import { Ram } from "../../src/components/memory/ram.js";
import { restoreRam } from "../../src/machines/snapshot.js";
import { renderCocoFrame, type Coco, type CocoVideoSignal } from "../../src/machines/6809/coco/runtime.js";
import { createProcessorChanges } from "./change-log.js";
import type { CocoSessionState } from "./coco-session.js";

type CpuAndRam = Pick<CocoSessionState["hardware"], "cpu" | "ram">;
const processorChanges = createProcessorChanges(cpu6809StateDescription);

interface RamPageChanges {
  readonly base: number;
  readonly bytes: { address: number; before: number; after: number }[];
}

/** Compare installed bytes by physical address, independently of the CPU's current SAM window. */
export function compareCocoStates(saved: CpuAndRam, current: CpuAndRam) {
  const beforeCpu = readState(cpu6809StateDescription, saved.cpu);
  const cpu = processorChanges(beforeCpu, current.cpu);
  const pages: RamPageChanges[] = [];
  let byteCount = 0;
  for (let base = 0; base < saved.ram.length; base += 256) {
    const bytes: RamPageChanges["bytes"] = [];
    for (let address = base; address < base + 256; address++) {
      const before = saved.ram[address], after = current.ram[address];
      checkUnsigned("Saved RAM byte", before, 255);
      if (after !== undefined && before !== after) bytes.push({ address, before, after });
    }
    if (bytes.length) { pages.push({ base, bytes }); byteCount += bytes.length; }
  }
  return { cpu, pages, byteCount };
}

/** Render both sides with the selected monitor signal. A checkpoint's video requires no ROM or media. */
export function compareCocoScreens(saved: CocoSessionState["hardware"], current: Coco, signal: CocoVideoSignal) {
  if (!saved.sam || !saved.vdg || !saved.pias?.pia1 || ![0x8000, 0x10000].includes(saved.ram.length)) {
    throw new Error("Incomplete saved CoCo display state.");
  }
  const ram = new Ram(saved.ram.length);
  restoreRam(ram, saved.ram);
  const before = renderCocoFrame({ ram, sam: new Mc6883(saved.sam), vdg: new Mc6847(saved.vdg),
    pias: { videoPins: new Mc6821(saved.pias.pia1).pinsB() } }, signal);
  const after = renderCocoFrame(current, signal), changed: number[] = [];
  for (let i = 0; i < after.length; i++) if (before[i] !== after[i]) changed.push(i);
  return { before, after, changed };
}
