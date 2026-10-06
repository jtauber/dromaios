import type { MemoryLabel } from "./apple2-explorer.js";
import { hex } from "./apple2-explorer.js";
import { addMemoryWatch, decodeMemoryWatches, memoryWatchModes, sampleMemoryWatches } from "./apple2-watches.js";
import { memoryLink } from "./memory-link.js";

export function createApple2Watches(root: HTMLElement, labels: readonly MemoryLabel[], browse: (address: number) => void) {
  const panel = root.querySelector<HTMLElement>("[data-memory-watches]");
  if (!panel) return undefined;
  const form = panel.querySelector<HTMLFormElement>("form")!, address = form.querySelector<HTMLInputElement>("[name=address]")!;
  const label = form.querySelector<HTMLInputElement>("[name=label]")!, output = panel.querySelector<HTMLElement>("[data-watch-rows]")!;
  const status = panel.querySelector<HTMLElement>("[data-watch-status]")!;
  const key = "dromaios:inspectors:apple2:watches";
  let watches = decodeMemoryWatches(null), previous = new Map<number, number | undefined>();
  let read: ((address: number) => number | undefined) | undefined;
  let identity: object | undefined, firmware = false, mapped = false;
  try { watches = decodeMemoryWatches(window.localStorage.getItem(key)); } catch { /* Empty list if storage is unavailable. */ }
  const rows = new Map<number, { row: HTMLElement; value: HTMLElement; label: HTMLElement }>();
  function save(): void {
    try { window.localStorage.setItem(key, JSON.stringify(watches)); status.textContent = ""; }
    catch { status.textContent = "Watches are available for this visit; browser storage is unavailable."; }
  }
  function layout(): void {
    rows.clear(); output.replaceChildren();
    for (const watch of watches) {
      const row = document.createElement("div"), value = document.createElement("span"), label = document.createElement("span");
      row.className = "lab-watch-row"; value.className = "lab-watch-value";
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove watch at $${hex(watch.address)}`);
      remove.addEventListener("click", () => {
        watches = watches.filter(item => item.address !== watch.address); previous.delete(watch.address);
        save(); layout(); render();
      });
      const stops = document.createElement("span"), choices = document.createElement("span");
      stops.className = "lab-watch-stops"; choices.className = "lab-inspector-choices";
      stops.append("Stop on ", choices);
      for (const mode of memoryWatchModes) {
        const button = document.createElement("button"); button.type = "button";
        button.textContent = { read: "R", write: "W", change: "Δ" }[mode];
        button.title = { read: "Data read (excludes instruction fetches)", write: "Bus write (including unchanged or ignored writes)", change: "Changed RAM byte (any bank)" }[mode];
        button.setAttribute("aria-label", `Stop on ${mode} at $${hex(watch.address)}`);
        button.setAttribute("aria-pressed", String(watch.stop?.includes(mode) ?? false));
        button.addEventListener("click", () => {
          watches = watches.map(item => item.address !== watch.address ? item : { ...item,
            stop: item.stop?.includes(mode) ? item.stop.filter(value => value !== mode) : [...item.stop ?? [], mode] });
          button.setAttribute("aria-pressed", String(watches.find(item => item.address === watch.address)!.stop!.includes(mode)));
          save();
        });
        choices.append(button);
      }
      row.append(memoryLink(watch.address, browse), label, value, remove, stops); output.append(row);
      rows.set(watch.address, { row, value, label });
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
      row.label.textContent = sample.label || symbol?.name || "";
      row.label.title = sample.label || symbol?.description || "";
      row.value.textContent = sample.value === undefined ? "—" : `$${hex(sample.value, 2)} · ${sample.value}`;
      row.value.title = sample.value === undefined ? "Device or unavailable storage; no guest read is performed."
        : sample.changed ? `Changed from $${hex(sample.before!, 2)} since the previous displayed sample` : "Hexadecimal · decimal";
      row.value.classList.toggle("is-changed", sample.changed);
    }
    previous = new Map(samples.map(sample => [sample.address, sample.value]));
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    try { watches = addMemoryWatch(watches, address.value, label.value); }
    catch (error) { address.setCustomValidity((error as Error).message); address.reportValidity(); return; }
    save(); layout(); render(); address.value = ""; label.value = ""; address.focus();
  });
  address.addEventListener("input", () => address.setCustomValidity(""));
  layout();
  return {
    get watches() { return watches; },
    add(value: number): void {
      try {
        if (!watches.some(watch => watch.address === value)) watches = addMemoryWatch(watches, hex(value), "");
        save(); layout(); render();
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
