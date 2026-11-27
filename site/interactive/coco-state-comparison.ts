import { cpu6809StateDescription } from "../../src/components/cpus/generated/6809-cpu.js";
import { readState } from "../../src/components/cpus/state.js";
import { checkUnsigned } from "../../src/components/validation.js";
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
  // Restoring checks the complete machine. Comparing needs only the saved CPU and RAM.
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
