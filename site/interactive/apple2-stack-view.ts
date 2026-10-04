import { createApple2MemoryView } from "./apple2-memory-view.js";
import { createInspectorChoices } from "./inspector-controls.js";
import { hex } from "./apple2-explorer.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";

/** SP identifies the next push slot, so conventional stack entries begin at SP + 1. */
export function createApple2StackView(container: HTMLElement | null, page: HTMLElement | null) {
  if (!container || !page) return undefined;
  const output = container, dump = page, bytes = createApple2MemoryView(page, 256)!;
  const controls = document.createElement("span"); controls.className = "lab-inspector-controls";
  const mode = createInspectorChoices("Stack view", [
    { value: "stack", label: "STACK", title: "Stack entries" }, { value: "page", label: "PAGE", title: "Full stack page" },
  ], "stack", display);
  function display(): void {
    output.hidden = mode.value !== "stack"; dump.hidden = mode.value !== "page";
    bytes.control.hidden = mode.value !== "page";
  }
  controls.append(mode.element, bytes.control); display();
  return {
    control: controls,
    render(read: (address: number) => number | undefined, sp: number, changes: ReadonlyMap<number, Apple2MemoryChange>): void {
      bytes.render(read, 0x100, changes);
      output.replaceChildren();
      if (sp === 0xff) { output.textContent = "(empty above SP)"; return; }
      for (let offset = sp + 1; offset <= 0xff; offset++) {
        const address = 0x100 + offset, value = read(address), change = changes.get(address);
        const field = document.createElement("span"); field.dataset.memoryByte = hex(address);
        field.className = "apple2-memory-byte";
        field.textContent = value === undefined ? "--" : hex(value, 2);
        if (change && value === change.after) {
          field.classList.add("is-changed"); field.title = `Changed ${hex(change.before, 2)} → ${hex(change.after, 2)} in the last instruction`;
        }
        output.append(`$${hex(address)}  `, field, offset === sp + 1 ? " ← SP+1\n" : "\n");
      }
    },
  };
}
