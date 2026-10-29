import type { Catalogue6809 } from "./6809-catalogue.js";
import type { Boundary6809 } from "./6809-instruction-preview.js";
import { code6809Rows } from "./6809-code.js";
import { hex6809 as hex } from "./6809-disassembly.js";
import { captureMemory } from "./memory-window.js";
import { createInspectorChoices } from "./inspector-controls.js";
import { memoryLink } from "./memory-link.js";

/** A held code inspector owns its observations; navigating or changing modes never reads a machine. */
export function create6809CodeView(panel: HTMLElement, catalogue: Catalogue6809,
  memory: { readonly address: () => number; readonly browse: (address: number) => void }) {
  const body = panel.querySelector<HTMLTableSectionElement>("[data-code-rows]")!;
  const status = panel.querySelector<HTMLElement>("[data-code-status]")!;
  let image: Int16Array = new Int16Array(0x10000).fill(-1), pc = 0, recent: readonly Boundary6809[] = [];
  const mode = createInspectorChoices("Disassembly source", [
    { value: "pc", label: "PC", title: "Follow PC, with the last three executed instructions" },
    { value: "mem", label: "MEM", title: "Follow the Memory panel's selected address" },
  ], "pc", render);
  const views = Array.from({ length: 16 }, () => {
    const row = body.insertRow(), pointer = row.insertCell(), address = row.insertCell(), bytes = row.insertCell(), assembly = row.insertCell();
    // Keep address buttons stable while execution changes their destinations.
    const button = document.createElement("button"); button.type = "button"; address.append(button);
    let location = 0; button.addEventListener("click", () => memory.browse(location));
    return { row, pointer, bytes, assembly, show(address: number) {
      location = address; button.textContent = hex(address); button.title = `View $${hex(address)} in Memory`;
    } };
  });
  function render(): void {
    const start = mode.value === "pc" ? pc : memory.address();
    const rows = code6809Rows(address => image[address]! < 0 ? undefined : image[address], start, catalogue, mode.value === "pc" ? recent : []);
    status.textContent = `${mode.value.toUpperCase()} · $${hex(start)}`;
    views.forEach((view, index) => {
      const row = rows[index]; view.row.hidden = row === undefined; if (!row) return;
      const current = !row.executed && row.address === pc, flow = row.shape?.controlFlow;
      view.row.classList.toggle("is-current", current); view.row.classList.toggle("is-executed", row.executed);
      view.row.classList.toggle("flow-unconditional", flow === "unconditional" || row.boundaryAfter);
      view.row.classList.toggle("flow-conditional", flow === "conditional" && !row.boundaryAfter);
      view.row.title = row.boundaryAfter ? "External CPU boundary after this instruction"
        : flow === "conditional" ? "Conditional branch, taken or not taken" : flow === "unconditional" ? "Unconditional control transfer" : "";
      view.pointer.textContent = current ? "→" : row.executed ? "·" : "";
      view.pointer.setAttribute("aria-label", current ? "Next instruction" : row.executed ? "Previously executed" : "");
      view.show(row.address); view.bytes.textContent = row.bytes.map(byte => byte === undefined ? "--" : hex(byte, 2)).join(" ");
      if (row.target !== undefined && row.complete) {
        const target = `$${hex(row.target)}`, offset = row.assembly.lastIndexOf(target);
        view.assembly.replaceChildren(row.assembly.slice(0, offset), memoryLink(row.target, memory.browse), row.assembly.slice(offset + target.length));
      } else view.assembly.textContent = row.assembly;
    });
  }
  return {
    controls: mode.element,
    memoryMoved(): void { if (mode.value === "mem") render(); },
    refresh(read: (address: number) => number | undefined, currentPC: number, records: readonly Boundary6809[]): void {
      image = captureMemory(read); pc = currentPC; recent = [...records]; render();
    },
  };
}
