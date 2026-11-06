import type { Apple2DiskII } from "../../src/components/devices/apple2-disk-ii.js";
import { dos33LogicalSectors } from "../../src/components/devices/dos33-disk.js";
import { createApple2DiskActivity } from "./apple2-disk-activity.js";
import { dos33HeadWindow, inspectDos33Track } from "./dos33-track.js";
import { disassemble6502, hex } from "./apple2-explorer.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";
import type { DebugLocation } from "./instruction-debugger.js";

export function createApple2DiskActivityView(root: HTMLElement, instructions: InstructionCatalogue,
  browseCode: (location: DebugLocation) => string | undefined, browseSector: (track: number, sector: number) => void) {
  const panel = root.querySelector<HTMLDetailsElement>("[data-disk-activity]");
  if (!panel) return undefined;
  const element = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-disk-${name}]`)!;
  const head = element<HTMLElement>("head"), headStatus = element<HTMLElement>("head-status"), map = element<HTMLElement>("sector-map");
  const history = element<HTMLDetailsElement>("byte-history"), body = element<HTMLTableSectionElement>("byte-rows");
  const status = element<HTMLElement>("byte-status"), latest = element<HTMLElement>("last-data");
  const record = element<HTMLInputElement>("record"), older = element<HTMLButtonElement>("older"), newer = element<HTMLButtonElement>("newer");
  const activity = createApple2DiskActivity();
  let controller: Apple2DiskII | undefined, end: number | undefined;
  function sample() {
    if (!controller) return undefined;
    const state = controller.inspect(), medium = controller.inspectMedium();
    return { state, medium, image: medium?.snapshot(), events: activity.entries(), count: activity.count,
      sectors: activity.sectors(Math.floor(state.halfTrack / 2)), latest: activity.latestData };
  }
  let displayed: ReturnType<typeof sample>;
  let stored: { image: readonly number[]; track: number; bytes: readonly number[]; fields: ReturnType<typeof inspectDos33Track> } | undefined;
  function renderHead(): void {
    head.replaceChildren(); map.replaceChildren(); latest.textContent = "";
    if (!displayed) return;
    const { state, medium, image, sectors } = displayed, track = Math.floor(state.halfTrack / 2);
    if (!state.installed || !medium || !image || state.drive !== 1) {
      headStatus.textContent = state.drive === 2 ? "Drive 2 is absent; no stream is selected." : "No mounted Disk II stream.";
      return;
    }
    if (stored?.image !== image || stored.track !== track) {
      // Do not combine an older held position/image with a newly written track.
      if (medium.snapshot() !== image) { headStatus.textContent = "Enable Live or pause to inspect the changed track."; return; }
      const bytes = medium.inspectTrack(track);
      stored = { image, track, bytes, fields: inspectDos33Track(bytes) };
    }
    headStatus.textContent = `Drive 1 · track ${track} · half-track ${state.halfTrack} · next position $${hex(state.position)}`
      + ` · ${state.motor ? "motor on" : "motor off"} · ${state.q7 ? "write mode" : state.q6 ? "write-protect sense" : "read mode"}`;
    const window = dos33HeadWindow(stored.bytes, stored.fields, state.position);
    for (let i = 0; i < window.length; i += 16) {
      const row = document.createElement("div"); row.append(`${hex(window[i]!.offset)}  `);
      for (const byte of window.slice(i, i + 16)) {
        const cell = document.createElement("span"); cell.className = `disk-byte-${byte.part}`;
        cell.textContent = hex(byte.value, 2); cell.title = `$${hex(byte.offset)} · ${byte.part}${byte.next ? " · next stream byte" : ""}`;
        if (byte.next) { cell.classList.add("disk-byte-next"); cell.setAttribute("aria-label", cell.title); }
        row.append(cell, " ");
      }
      head.append(row);
    }
    for (const sector of sectors) {
      const button = document.createElement("button"), logical = dos33LogicalSectors[sector.physicalSector]!;
      button.type = "button"; button.dataset.diskSector = String(sector.physicalSector);
      button.className = sector.data ? "disk-sector-data" : sector.addresses ? "disk-sector-found" : "";
      button.textContent = `P${sector.physicalSector} → DOS${logical}\nA ${sector.addresses} · D ${sector.data}`;
      button.title = `Track ${track}, physical sector ${sector.physicalSector}, DOS sector ${logical}: ${sector.addresses} verified addresses, ${sector.data} verified data fields. Browse stored sector.`;
      button.onclick = () => browseSector(track, logical); map.append(button);
    }
    const completed = displayed.latest, field = completed?.field;
    latest.textContent = field ? `Last verified data: T${field.track} P${field.physicalSector} → DOS ${field.sector}`
      + ` · bytes #${field.first}–${field.last} · checksum at PC $${hex(completed!.caller.address)}.` : "No complete data field verified yet.";
  }
  function renderHistory(): void {
    if (!displayed) return;
    const entries = displayed.events, first = entries[0]?.number ?? 1, last = entries.at(-1)?.number ?? 0;
    if (end !== undefined) end = Math.min(last, Math.max(end, Math.min(first + 63, last)));
    const until = end ?? last, rows = entries.filter(event => event.number <= until).slice(-64);
    older.disabled = !rows.length || rows[0]!.number <= first;
    newer.disabled = !rows.length || until >= last;
    status.textContent = `${activity.recording ? "Recording" : "Recording off"} · ${displayed.count.toLocaleString()} transfers`
      + ` · showing ${rows.length ? `#${rows[0]!.number}–${rows.at(-1)!.number}` : "none"}`
      + ` · ${Math.max(0, displayed.count - entries.length).toLocaleString()} older bytes discarded.`;
    if (!history.open) return;
    body.replaceChildren();
    for (const event of rows) {
      const row = document.createElement("tr"), pc = document.createElement("button"), caller = document.createElement("td");
      pc.type = "button"; pc.className = "lab-memory-link"; pc.textContent = `$${hex(event.caller.address)}`;
      const assembly = disassemble6502(event.caller.address, event.instruction, instructions);
      pc.title = `Browse current Disassembly at $${hex(event.caller.address)} · captured ${event.caller.space}: ${assembly}`;
      pc.onclick = () => { const notice = browseCode(event.caller); if (notice) status.textContent = notice; };
      caller.append(pc, ` ${assembly}${event.outcome !== "executed" ? ` (${event.outcome})` : ""}`);
      const field = event.field;
      for (const text of [String(event.number), `${event.kind === "read" ? "Read" : "Shift write"} $${hex(event.value, 2)}`,
        `T${event.track} $${hex(event.position)}`]) {
        const cell = document.createElement("td"); cell.textContent = text; row.append(cell);
      }
      row.append(caller);
      const annotation = document.createElement("td");
      annotation.textContent = field ? `${field.kind} ${field.valid ? "✓" : "invalid"} · P${field.physicalSector} → D${field.sector ?? "?"}` : "";
      row.append(annotation); body.append(row);
    }
  }
  const render = (): void => { if (panel.open) { renderHead(); renderHistory(); } };
  panel.ontoggle = render; history.ontoggle = renderHistory;
  record.onchange = () => { activity.record(record.checked); renderHistory(); };
  element<HTMLButtonElement>("activity-clear").onclick = () => { activity.clear(); end = undefined; displayed = sample(); render(); };
  older.onclick = () => { end = (end ?? displayed?.events.at(-1)?.number ?? 0) - 64; renderHistory(); };
  newer.onclick = () => { end = (end ?? 0) + 64; renderHistory(); };
  element<HTMLButtonElement>("latest").onclick = () => { end = undefined; renderHistory(); };
  return {
    capture: activity.capture,
    clear(): void { activity.clear(); end = undefined; displayed = undefined; stored = undefined; },
    refresh(selected: Apple2DiskII, update: boolean): void {
      controller = selected;
      const changed = activity.connect(selected);
      if (changed) { end = undefined; stored = undefined; }
      if (update || changed) displayed = sample();
      if ((update || changed) && panel.getClientRects().length) render();
    },
  };
}
