import type { CapturedInstruction, ChangeEntry } from "./change-log.js";

const hex = (value: number, width = 4) => value.toString(16).toUpperCase().padStart(width, "0");
interface ChangeLog {
  recording: boolean;
  readonly capacity: number;
  readonly discarded: number;
  entries(): readonly ChangeEntry[];
  clear(): void;
  reset(): void;
  dispose(): void;
}

/** The same recording controls and presentation for any machine's boundary log. */
export function createChangeLogView<Machine, Log extends ChangeLog>(root: HTMLElement, machine: () => Machine,
  createLog: (machine: Machine) => Log, assembly: (instruction: CapturedInstruction) => string) {
  const panel = root.querySelector<HTMLElement>("[data-change-log]");
  if (!panel) return undefined;
  const recording = panel.querySelector<HTMLInputElement>("[data-log-recording]")!;
  const filters = [...panel.querySelectorAll<HTMLInputElement>("[data-log-filter]")];
  const status = panel.querySelector<HTMLElement>("[data-log-status]")!, output = panel.querySelector<HTMLElement>("[data-log-output]")!;
  let selected = machine(), log = createLog(selected);
  function current(): Log {
    if (machine() !== selected) { log.dispose(); selected = machine(); log = createLog(selected); }
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
      if (!changes.length && (entry.outcome === "executed" || entry.source === "user")) continue;
      let title = "User RAM edit";
      if (entry.source === "cpu") {
        const instruction = entry.instruction;
        title = instruction ? `$${hex(instruction.address)}  ${instruction.bytes.length ? assembly(instruction) : "Incomplete instruction"}`
          : `${entry.event ?? "CPU boundary"} at PC $${hex(entry.caller!.address)}`;
        if (entry.outcome !== "executed") title += ` [${entry.outcome}]`;
      }
      lines.push(`#${entry.sequence}  ${title}`,
        ...changes.map(change => `  ${change.target}  ${hex(change.before, change.width)} → ${hex(change.after, change.width)}`), "");
    }
    status.textContent = `${log.recording ? "Recording" : "Recording paused"} · ${entries.length} / ${log.capacity} events retained`
      + (log.discarded ? ` · ${log.discarded.toLocaleString()} older discarded` : "");
    output.textContent = lines.join("\n") || (entries.length ? "No changes match these filters." : "No events recorded yet. Step or Run to begin.");
  }
  recording.addEventListener("change", refresh);
  for (const filter of filters) filter.addEventListener("change", refresh);
  panel.querySelector<HTMLButtonElement>("[data-log-clear]")!.addEventListener("click", () => { current().clear(); refresh(); });
  return { current, reset(): void { current().reset(); }, refresh };
}
