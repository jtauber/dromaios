import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { createApple2Session } from "./apple2-session.js";
import { createApple2ChangeLog } from "./apple2-change-log.js";
import { disassemble6502, hex } from "./apple2-explorer.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";

/** A laboratory instrument; capture runs for every step, independently of display refreshes. */
export function createApple2ChangeLogView(root: HTMLElement, machine: () => ReturnType<typeof createApple2Session>["machine"]) {
  const panel = root.querySelector<HTMLElement>("[data-change-log]");
  if (!panel) return undefined;
  const recording = panel.querySelector<HTMLInputElement>("[data-log-recording]")!;
  const filters = [...panel.querySelectorAll<HTMLInputElement>("[data-log-filter]")];
  const status = panel.querySelector<HTMLElement>("[data-log-status]")!, output = panel.querySelector<HTMLElement>("[data-log-output]")!;
  const { instructions } = JSON.parse(root.querySelector<HTMLElement>("[data-rom-catalogue]")!.textContent!) as { instructions: InstructionCatalogue };
  let selected = machine(), log = createApple2ChangeLog(selected);
  function current() {
    if (machine() !== selected) { log.dispose(); selected = machine(); log = createApple2ChangeLog(selected); }
    log.recording = recording.checked;
    return log;
  }
  function refresh(): void {
    current();
    if (panel!.hidden) return;
    const entries = log.entries(), kinds = new Set(filters.filter(filter => filter.checked).map(filter => filter.dataset.logFilter));
    const lines: string[] = [];
    for (const entry of entries) {
      const changes = entry.changes.filter(change => kinds.has(change.kind));
      if (!changes.length && entry.outcome === "executed") continue;
      const { address, bytes } = entry.instruction;
      const assembly = bytes.length ? disassemble6502(address, bytes, instructions) : "Incomplete instruction";
      lines.push(`#${entry.sequence}  $${hex(address)}  ${assembly}${entry.outcome === "executed" ? "" : ` [${entry.outcome}]`}`,
        ...changes.map(change => `  ${change.target}  ${hex(change.before, change.width)} → ${hex(change.after, change.width)}`), "");
    }
    status.textContent = `${log.recording ? "Recording" : "Recording paused"} · ${entries.length} / ${log.capacity} instructions retained`
      + (log.discarded ? ` · ${log.discarded.toLocaleString()} older discarded` : "");
    output.textContent = lines.join("\n") || (entries.length ? "No changes match these filters." : "No instructions recorded yet. Step or Run to begin.");
  }
  recording.addEventListener("change", refresh);
  for (const filter of filters) filter.addEventListener("change", refresh);
  panel.querySelector<HTMLButtonElement>("[data-log-clear]")!.addEventListener("click", () => { current().clear(); refresh(); });
  return {
    capture(step: () => Cpu6502StepRecord): Cpu6502StepRecord { return current().capture(step); },
    memoryChanges(record: Cpu6502StepRecord | undefined) { return current().memoryChanges(record); },
    reset(): void { current().clear(); },
    refresh,
  };
}
