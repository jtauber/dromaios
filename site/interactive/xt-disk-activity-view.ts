import type { createXtDiskActivity } from "./xt-disk-activity.js";
import { xtDisketteCommand, xtDisketteParameters, xtDisketteResult } from "./xt-diskette-decode.js";
import { xtHex as hex } from "./8088-disassembly.js";
import { memoryLink } from "./memory-link.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { Fat12Region } from "./fat12.js";
import { xtDiskActivityMatches } from "./xt-disk-file-transfers.js";

export function createXtDiskActivityView(root: HTMLElement, activity: ReturnType<typeof createXtDiskActivity>,
  browseMemory: (address: number) => void, browseCode: (location: DebugLocation) => void, changed: () => void) {
  const at = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const output = at("disk-operations"), recording = at<HTMLInputElement>("disk-recording");
  let revision = -1;
  let filter: { regions: readonly Fat12Region[]; label: string; operations?: readonly number[] } | undefined;
  recording.onchange = () => { activity.record(recording.checked); changed(); };
  at("disk-clear").onclick = () => { activity.reset(); filter = undefined; revision = -1; changed(); };
  at("disk-filter-clear").onclick = () => { filter = undefined; revision = -1; changed(); };
  return {
    filter(regions: readonly Fat12Region[], label: string, operations?: number | readonly number[]): void {
      filter = { regions, label, operations: typeof operations === "number" ? [operations] : operations }; revision = -1;
    },
    resetFilter(): void { filter = undefined; revision = -1; },
    refresh(): void {
      if (at("disk-activity").hidden) return;
      if (activity.revision === revision) return;
      revision = activity.revision;
      const opened = new Map([...output.querySelectorAll<HTMLDetailsElement>("details[data-operation]")].map(el => [Number(el.dataset.operation), el.open]));
      output.replaceChildren();
      const retained = activity.entries(), entries = filter ? retained.filter(op => (filter!.operations === undefined || filter!.operations.includes(op.id))
        && xtDiskActivityMatches(op, filter!.regions)) : retained;
      at("disk-filter").textContent = filter ? `${filter.label} · matching snapshot ranges` : "";
      at("disk-filter-clear").hidden = !filter;
      at("disk-activity-status").textContent = `${activity.recording ? "Recording" : "Recording paused"} · ${entries.length} shown · ${retained.length}/${activity.capacity} retained commands`
        + (activity.discarded ? ` · ${activity.discarded} older discarded` : "");
      for (const op of [...entries].reverse()) {
        const row = document.createElement("details"), summary = document.createElement("summary"), parameters = document.createElement("p"), state = document.createElement("p");
        row.dataset.operation = String(op.id); row.open = opened.get(op.id) ?? op === entries.at(-1);
        row.className = "lab-device-event";
        const result = op.result.length ? xtDisketteResult(op.command, op.result) : op.state;
        summary.textContent = `#${op.id} ${xtDisketteCommand(op.command)} · ${op.bytes} bytes · ${result}${op.continued ? " · continued" : ""}`;
        parameters.className = state.className = "lab-hint";
        parameters.textContent = xtDisketteParameters(op.command, op.parameters);
        state.append(`${op.started.toLocaleString()}–${op.updated.toLocaleString()} ticks · ${op.state}`
          + `${op.irq6 ? " · IRQ6 entry observed" : ""}${op.continued ? " · earlier activity not recorded" : ""}`);
        if (op.caller) {
          state.append(" · ");
          const caller = op.caller;
          const link = document.createElement("button"); link.type = "button"; link.className = "lab-memory-link";
          link.textContent = caller.space.replace("CS:IP ", ""); link.title = "Browse command writer in Disassembly";
          link.onclick = () => browseCode(caller); state.append(link);
        }
        row.append(summary, parameters, state);
        for (const sector of op.sectors) {
          const line = document.createElement("p"), index = sector.offset / 512;
          line.className = "lab-hint";
          line.append(`C${Math.floor(index / 18)} H${Math.floor(index / 9) % 2} R${index % 9 + 1} · image +$${hex(sector.offset, 5)} · `,
            `${sector.bytes}/512 bytes (${sector.firstByte}–${sector.lastByte}) · ${sector.direction === "disk-to-memory" ? "→" : "←"} RAM `,
            memoryLink(sector.firstAddress, browseMemory, `$${hex(sector.firstAddress, 5)}`), "–",
            memoryLink(sector.lastAddress, browseMemory, `$${hex(sector.lastAddress, 5)}`), sector.terminal ? " · TC" : "");
          row.append(line);
        }
        if (op.omittedSectors) row.append(`${op.omittedSectors} older sector spans omitted. `);
        if (op.result.length) {
          const raw = document.createElement("p"); raw.className = "lab-hint";
          raw.textContent = `Result ${op.result.map(byte => hex(byte, 2)).join(" ")} · ${op.consumed}/${op.result.length} bytes consumed by software`;
          row.append(raw);
        }
        if (op.note) row.append(op.note);
        output.append(row);
      }
      if (!entries.length) output.textContent = filter ? "No retained commands match these disk ranges." : "No disk commands observed. Run the XT or restore a transfer checkpoint.";
    },
  };
}
