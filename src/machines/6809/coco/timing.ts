import type { Coco } from "./runtime.ts";

// The normal-speed SAM supplies four VDG clocks per CPU E period. Half-VDG
// units retain the 16.5-clock HS pulse exactly, without rounding each line.
const halfVdgClocksPerCpuClock = 8;

function syncPeriods({ vdg }: Coco) {
  const line = vdg.lineHalfClocks() / halfVdgClocksPerCpuClock;
  const low = vdg.horizontalSyncHalfClocks() / halfVdgClocksPerCpuClock;
  const field = line * vdg.fieldLines();
  // Phase zero is an HS rising edge, just after FS rose on the previous HS
  // falling edge. Both pins start high; no artificial power-on edge is emitted.
  return { line, low, field, fieldFall: field - line * vdg.fieldSyncLines() - low, fieldRise: field - low };
}

/** Deliver every crossed edge, even when both ends of a pulse fall in one instruction. */
export function advanceCocoSync(machine: Coco, start: number): void {
  const elapsed = machine.clock.ticks - start;
  const { line, low, field, fieldFall, fieldRise } = syncPeriods(machine);
  pulseEdges(start % line, elapsed, line, line - low, line, high => machine.pias.setHorizontalSync(high));
  pulseEdges(start % field, elapsed, field, fieldFall, fieldRise, high => machine.pias.setFieldSync(high));
}

function pulseEdges(phase: number, elapsed: number, period: number, fall: number, rise: number, set: (high: boolean) => void): void {
  for (let offset = 0; offset + fall <= phase + elapsed; offset += period) {
    if (offset + fall > phase) set(false);
    if (offset + rise > phase && offset + rise <= phase + elapsed) set(true);
  }
}

/** The CPU observes fractional sync edges at the next complete E-clock boundary. */
export function clocksUntilCocoSync(machine: Coco): number {
  const { line, low, field, fieldFall, fieldRise } = syncPeriods(machine), ticks = machine.clock.ticks;
  const next = (period: number, edge: number): number => {
    const remaining = edge - ticks % period;
    return remaining > 0 ? remaining : remaining + period;
  };
  return Math.ceil(Math.min(next(line, line - low), next(line, line), next(field, fieldFall), next(field, fieldRise)));
}
