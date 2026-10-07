import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";
import { hex } from "./apple2-explorer.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import { apple2RamRegions } from "./apple2-inspection.js";
import type { MemoryWatch, MemoryWatchMode } from "./apple2-watches.js";
import { memoryWatchIncludes } from "./apple2-watches.js";

export interface MemoryWatchHit {
  readonly address: number;
  readonly mode: MemoryWatchMode;
  readonly value: number;
  readonly change?: Apple2MemoryChange;
}

/** Match completed observations only. Fetches are chapter-defined, not inferred from address or order. */
export function apple2Watchpoint(watches: readonly MemoryWatch[], record: Cpu6502StepRecord,
  catalogue: InstructionCatalogue, changes: readonly Apple2MemoryChange[]): MemoryWatchHit | undefined {
  if (record.outcome !== "executed" || !watches.some(watch => watch.stop?.length)) return undefined;
  const roles = catalogue[record.instruction.bytes[0]!]?.accesses;
  for (const [index, access] of record.accesses.entries()) {
    // Overlapping byte/word watches contribute independently; list order must not mask a stop.
    const stops = (mode: MemoryWatchMode) => watches.some(watch => memoryWatchIncludes(watch, access.address) && watch.stop?.includes(mode));
    if (access.kind === "read" && roles?.[index] === "read" && stops("read")) {
      return { address: access.address, mode: "read", value: access.value };
    }
    if (access.kind !== "write") continue;
    const change = changes.find(change => change.address === access.address && change.after === access.value);
    if (stops("write")) return { address: access.address, mode: "write", value: access.value, ...(change && { change }) };
    if (change && stops("change")) return { address: access.address, mode: "change", value: access.value, change };
  }
  return undefined;
}

export function describeApple2Watchpoint(hit: MemoryWatchHit, instruction: number): string {
  const action = { read: "read", write: "issued a write to", change: "changed" }[hit.mode];
  const value = hit.change ? `$${hex(hit.change.before, 2)} → $${hex(hit.change.after, 2)}` : `$${hex(hit.value, 2)}`;
  const region = hit.change ? ` (${apple2RamRegions.find(region => region.part === hit.change!.region)!.label})` : "";
  return `Instruction $${hex(instruction)} ${action} $${hex(hit.address)}${region}: ${value}. Stopped after the instruction.`;
}
