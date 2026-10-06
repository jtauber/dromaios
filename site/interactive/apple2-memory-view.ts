import { apple2MemoryAddresses } from "./apple2-inspection.js";
import type { Apple2MemoryChange, MemoryRowWidth } from "./apple2-inspection.js";
import { hex } from "./apple2-explorer.js";
import { createInspectorChoices } from "./inspector-controls.js";
import type { UpcomingMemoryAccesses } from "./apple2-memory-accesses.js";
import { markMemoryAccess } from "./memory-access-view.js";
import { apple2MemoryCharacter } from "./apple2-memory-characters.js";
import { memoryWatchButton } from "./memory-link.js";

/** Byte presentation and its header control; receives observations, never the machine or guest bus. */
export function createApple2MemoryView(container: HTMLElement | null, length: number, onWidthChange?: () => void) {
  if (!container) return undefined;
  const output = container;
  const panel = container.closest<HTMLElement>("[data-workspace-panel]")!;
  const key = `dromaios:inspectors:apple2:memory:${panel.dataset.workspacePanel}`;
  const storageKey = `${key}:row-width`;
  let rowWidth: MemoryRowWidth = 8;
  let showCharacters = false;
  try { if (window.localStorage.getItem(storageKey) === "16") rowWidth = 16; }
  catch { /* Eight-byte rows also work without saved preferences. */ }
  try { showCharacters = window.localStorage.getItem(`${key}:characters`) === "true"; }
  catch { /* Start with hexadecimal bytes. */ }
  let start: number | undefined;
  function field(address?: number) {
    const element = address === undefined ? document.createElement("span") : memoryWatchButton(address);
    const value = document.createTextNode(""), description = document.createElement("span");
    element.classList.add("apple2-memory-byte"); description.className = "visually-hidden";
    element.append(value, description); return { element, value, description };
  }
  let cells: { address: number; byte: ReturnType<typeof field>; character: ReturnType<typeof field> }[] = [];
  function layout(): void {
    output.replaceChildren();
    for (let offset = 0; offset < cells.length; offset += rowWidth) {
      const row = cells.slice(offset, offset + rowWidth);
      output.append(`${offset ? "\n" : ""}${hex(row[0]!.address)} `);
      for (const cell of row) output.append(" ", cell.byte.element);
      if (showCharacters) {
        output.append(" ".repeat(3 * (rowWidth - row.length)), "  │");
        for (const cell of row) output.append(cell.character.element);
        output.append(" ".repeat(rowWidth - row.length), "│");
      }
    }
  }
  const choice = createInspectorChoices(`Bytes per row for ${panel.dataset.panelTitle}`,
    ([8, 16] as const).map(value => ({ value, label: String(value), title: `${value} bytes per row` })), rowWidth, width => {
      rowWidth = width;
      // Regroup existing cells: a held inspector must not acquire newer bytes or lose its highlights.
      layout(); onWidthChange?.();
      try { window.localStorage.setItem(storageKey, String(rowWidth)); }
      catch { /* The choice still lasts for this visit. */ }
    });
  const text = document.createElement("button"); text.type = "button"; text.textContent = "TXT";
  text.setAttribute("aria-label", `Apple II characters for ${panel.dataset.panelTitle}`);
  text.title = "Show Apple II characters; inverse and flashing attributes are shown without animation";
  text.setAttribute("aria-pressed", String(showCharacters));
  text.addEventListener("click", () => {
    showCharacters = !showCharacters; text.setAttribute("aria-pressed", String(showCharacters)); layout();
    try { window.localStorage.setItem(`${key}:characters`, String(showCharacters)); }
    catch { /* Keep the choice for this visit. */ }
  });
  const format = document.createElement("span"); format.className = "lab-inspector-choices"; format.append(text);
  const control = document.createElement("span"); control.className = "lab-inspector-controls lab-memory-format";
  control.append(choice.element, format);
  return {
    control,
    get rowWidth() { return rowWidth; },
    render(read: (address: number) => number | undefined, address: number, changes: ReadonlyMap<number, Apple2MemoryChange>, upcoming: UpcomingMemoryAccesses, count = length): void {
      if (start !== address || cells.length !== Math.min(count, 0x10000 - address)) {
        start = address;
        cells = apple2MemoryAddresses(start, count).map(address => {
          const byte = field(address), character = field();
          byte.element.dataset.memoryByte = hex(address); character.element.dataset.memoryCharacter = hex(address);
          character.element.classList.add("lab-memory-character");
          return { address, byte, character };
        });
        layout();
      }
      for (const cell of cells) {
        const { address, byte, character } = cell, value = read(address), change = changes.get(address);
        const current = value === undefined ? "--" : hex(value, 2), glyph = apple2MemoryCharacter(value);
        const changed = change !== undefined && value === change.after;
        const previous = changed ? `$${hex(address)} changed ${hex(change.before, 2)} → ${current} in the last instruction` : "";
        byte.value.textContent = current; character.value.textContent = glyph?.character ?? "·";
        byte.element.setAttribute("aria-label", `Watch $${hex(address)}: ${value === undefined ? "unavailable" : `$${current}`}`);
        character.element.classList.toggle("is-inverse", glyph?.inverse ?? false);
        character.element.classList.toggle("is-flashing", glyph?.flashing ?? false);
        const attribute = glyph ? `${glyph.inverse ? "Inverse" : glyph.flashing ? "Flashing" : "Normal"} Apple II character · $${current}` : "Unavailable storage";
        for (const item of [byte, character]) {
          item.element.classList.toggle("is-changed", changed);
          const description = markMemoryAccess(item.element, upcoming, address, 1,
            [item === character ? attribute : `Watch $${hex(address)}`, previous].filter(Boolean).join("\n"));
          item.description.textContent = description ? ` (${description})` : "";
        }
      }
    },
  };
}
