import { apple2MemoryAddresses } from "./apple2-inspection.js";
import type { Apple2MemoryChange, MemoryRowWidth } from "./apple2-inspection.js";
import { hex } from "./apple2-explorer.js";
import { createInspectorChoices } from "./inspector-controls.js";

/** Byte presentation and its header control; receives observations, never the machine or guest bus. */
export function createApple2MemoryView(container: HTMLElement | null, length: number, onWidthChange?: () => void) {
  if (!container) return undefined;
  const output = container;
  const panel = container.closest<HTMLElement>("[data-workspace-panel]")!;
  const storageKey = `dromaios:inspectors:apple2:memory:${panel.dataset.workspacePanel}:row-width`;
  let rowWidth: MemoryRowWidth = 8;
  try { if (window.localStorage.getItem(storageKey) === "16") rowWidth = 16; }
  catch { /* Eight-byte rows also work without saved preferences. */ }
  let start: number | undefined;
  let cells: { address: number; field: HTMLSpanElement; value: Text; description: HTMLSpanElement }[] = [];
  function layout(): void {
    output.replaceChildren();
    cells.forEach(({ address, field }, offset) => {
      if (offset % rowWidth === 0) output.append(`${offset ? "\n" : ""}${hex(address)} `);
      output.append(" ", field);
    });
  }
  const choice = createInspectorChoices(`Bytes per row for ${panel.dataset.panelTitle}`,
    ([8, 16] as const).map(value => ({ value, label: String(value), title: `${value} bytes per row` })), rowWidth, width => {
      rowWidth = width;
      // Regroup existing cells: a held inspector must not acquire newer bytes or lose its highlights.
      layout(); onWidthChange?.();
      try { window.localStorage.setItem(storageKey, String(rowWidth)); }
      catch { /* The choice still lasts for this visit. */ }
    });
  const control = choice.element; control.classList.add("lab-memory-format");
  return {
    control,
    get rowWidth() { return rowWidth; },
    render(read: (address: number) => number | undefined, address: number, changes: ReadonlyMap<number, Apple2MemoryChange>, count = length): void {
      if (start !== address || cells.length !== Math.min(count, 0x10000 - address)) {
        start = address;
        cells = apple2MemoryAddresses(start, count).map(address => {
          const field = document.createElement("span"), value = document.createTextNode("");
          const description = document.createElement("span");
          field.className = "apple2-memory-byte"; field.dataset.memoryByte = hex(address);
          description.className = "visually-hidden";
          field.append(value, description);
          return { address, field, value, description };
        });
        layout();
      }
      for (const { address, field, value, description } of cells) {
        const byte = read(address), change = changes.get(address);
        const current = byte === undefined ? "--" : hex(byte, 2);
        const changed = change !== undefined && byte === change.after;
        value.textContent = current;
        field.classList.toggle("is-changed", changed);
        field.title = changed ? `$${hex(address)} changed ${hex(change.before, 2)} → ${current} in the last instruction` : "";
        description.textContent = changed ? ` (changed from ${hex(change.before, 2)})` : "";
      }
    },
  };
}
