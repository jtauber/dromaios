import type { MemoryLabel } from "./apple2-explorer.js";
import { hex } from "./apple2-explorer.js";
import { addMemoryWatch, decodeMemoryWatches, memoryWatchModes, sampleMemoryWatches } from "./apple2-watches.js";
import type { MemoryWatch, MemoryWatchBytes, MemoryWatchMode } from "./apple2-watches.js";
import { memoryLink, memoryPointerButton } from "./memory-link.js";
import { monitorWorkspace } from "./apple2-workspace-values.js";
import { createInspectorChoices } from "./inspector-controls.js";

const sizes = [
  { value: 1, label: "BYTE", title: "One byte" },
  { value: 2, label: "WORD", title: "Two bytes, low byte first" },
] as const;

export function createApple2Watches(root: HTMLElement, labels: readonly MemoryLabel[], browse: (address: number) => void,
  showHistory: (watch: MemoryWatch) => void, changed: (watches: readonly MemoryWatch[]) => void) {
  const panel = root.querySelector<HTMLElement>("[data-memory-watches]");
  if (!panel) return undefined;
  const form = panel.querySelector<HTMLFormElement>("form")!, address = form.querySelector<HTMLInputElement>("[name=address]")!;
  const label = form.querySelector<HTMLInputElement>("[name=label]")!, output = panel.querySelector<HTMLElement>("[data-watch-rows]")!;
  const status = panel.querySelector<HTMLElement>("[data-watch-status]")!;
  const size = createInspectorChoices<MemoryWatchBytes>("New watch size", sizes, 1, () => address.setCustomValidity(""));
  form.querySelector("[data-watch-size]")!.append(size.element);
  const workspace = monitorWorkspace(labels);
  const key = "dromaios:inspectors:apple2:watches";
  let watches = decodeMemoryWatches(null), previous = new Map<number, number | undefined>();
  let read: ((address: number) => number | undefined) | undefined;
  let identity: object | undefined, firmware = false, mapped = false;
  try { watches = decodeMemoryWatches(window.localStorage.getItem(key)); } catch { /* Empty list if storage is unavailable. */ }
  const rows = new Map<number, { row: HTMLElement; value: HTMLElement; label: HTMLElement;
    text: Text; pointer: ReturnType<typeof memoryPointerButton> | undefined }>();
  function save(): void {
    changed(watches);
    try { window.localStorage.setItem(key, JSON.stringify(watches)); status.textContent = ""; }
    catch { status.textContent = "Watches are available for this visit; browser storage is unavailable."; }
  }
  function add(address: string, label: string, stop?: MemoryWatchMode, bytes?: MemoryWatchBytes): void {
    const next = addMemoryWatch(watches, address, label, stop, bytes);
    for (const watch of next) {
      if ((watch.bytes ?? 1) !== (watches.find(old => old.address === watch.address)?.bytes ?? 1)) previous.delete(watch.address);
    }
    watches = next; save(); layout(); render();
  }
  function layout(): void {
    rows.clear(); output.replaceChildren();
    for (const watch of watches) {
      const row = document.createElement("div"), value = document.createElement("span"), label = document.createElement("span");
      row.className = "lab-watch-row"; value.className = "lab-watch-value";
      const pointer = watch.bytes === 2 ? memoryPointerButton(browse) : undefined, text = document.createTextNode("");
      if (pointer) value.append(pointer.button);
      value.append(text);
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove watch at $${hex(watch.address)}`);
      remove.addEventListener("click", () => {
        watches = watches.filter(item => item.address !== watch.address); previous.delete(watch.address);
        save(); layout(); render();
      });
      const stops = document.createElement("span"), choices = document.createElement("span");
      stops.className = "lab-watch-stops"; choices.className = "lab-inspector-choices";
      const width = createInspectorChoices<MemoryWatchBytes>(`Watch size at $${hex(watch.address)}`, sizes, watch.bytes ?? 1, bytes => {
        try { add(hex(watch.address), watch.label, undefined, bytes); }
        catch (error) { width.select(watch.bytes ?? 1); status.textContent = (error as Error).message; }
      });
      stops.append(width.element, "Stop on ", choices);
      const range = `$${hex(watch.address)}${watch.bytes === 2 ? `–${hex(watch.address + 1)}` : ""}`;
      for (const mode of memoryWatchModes) {
        const button = document.createElement("button"); button.type = "button";
        button.textContent = { read: "R", write: "W", change: "Δ" }[mode];
        button.title = { read: "Data read (excludes instruction fetches)", write: "Bus write (including unchanged or ignored writes)", change: "Changed RAM byte (any bank)" }[mode];
        button.setAttribute("aria-label", `Stop on ${mode} at ${range}`);
        if (watch.bytes === 2) button.title += "; either byte of the word";
        button.setAttribute("aria-pressed", String(watch.stop?.includes(mode) ?? false));
        button.addEventListener("click", () => {
          watches = watches.map(item => item.address !== watch.address ? item : { ...item,
            stop: item.stop?.includes(mode) ? item.stop.filter(value => value !== mode) : [...item.stop ?? [], mode] });
          button.setAttribute("aria-pressed", String(watches.find(item => item.address === watch.address)!.stop!.includes(mode)));
          save();
        });
        choices.append(button);
      }
      const history = document.createElement("button"); history.type = "button"; history.textContent = "History";
      history.setAttribute("aria-label", `History for watch at ${range}`);
      history.addEventListener("click", () => showHistory(watch)); stops.append(history);
      row.append(memoryLink(watch.address, browse), label, value, remove, stops); output.append(row);
      rows.set(watch.address, { row, value, label, text, pointer });
    }
    if (!watches.length) output.textContent = "No watched addresses.";
  }
  function render(): void {
    if (!read) return;
    const samples = sampleMemoryWatches(watches, read, previous);
    for (const sample of samples) {
      const row = rows.get(sample.address)!;
      const symbol = labels.find(label => parseInt(label.address, 16) === sample.address
        && (label.scope === "hardware" || firmware && (label.scope === "workspace" || mapped)));
      const word = sample.bytes === 2 && firmware ? workspace.find(entry => entry.address === sample.address && entry.bytes === 2) : undefined;
      row.label.textContent = sample.label || word?.name || symbol?.name || "";
      row.label.title = sample.label || symbol?.description || "";
      row.pointer?.refresh(sample.value);
      row.text.textContent = sample.value === undefined ? row.pointer ? "" : "—"
        : row.pointer ? ` · ${sample.value}` : `$${hex(sample.value, 2)} · ${sample.value}`;
      row.value.title = sample.value === undefined ? "Device or unavailable storage; no guest read is performed."
        : sample.changed ? `Changed from $${hex(sample.before!, (sample.bytes ?? 1) * 2)} since the previous displayed sample` : "Hexadecimal · decimal";
      row.value.classList.toggle("is-changed", sample.changed);
    }
    previous = new Map(samples.map(sample => [sample.address, sample.value]));
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    try { add(address.value, label.value, undefined, size.value); }
    catch (error) { address.setCustomValidity((error as Error).message); address.reportValidity(); return; }
    address.value = ""; label.value = ""; address.focus();
  });
  address.addEventListener("input", () => address.setCustomValidity(""));
  layout();
  return {
    get watches() { return watches; },
    add(value: number, stop?: MemoryWatchMode, bytes?: MemoryWatchBytes): void {
      try {
        add(hex(value), watches.find(watch => watch.address === value)?.label ?? "", stop, bytes);
        rows.get(value)!.row.scrollIntoView({ block: "nearest" });
        rows.get(value)!.row.querySelector<HTMLButtonElement>(".lab-watch-stops button")!.focus({ preventScroll: true });
      } catch (error) { status.textContent = (error as Error).message; }
    },
    refresh(source: object, reader: (address: number) => number | undefined, installed: boolean, romMapped: boolean): void {
      if (identity !== source) { identity = source; previous.clear(); }
      read = reader; firmware = installed; mapped = romMapped; render();
    },
  };
}
