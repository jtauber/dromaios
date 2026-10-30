import type { Catalogue6809 } from "./6809-catalogue.js";
import type { Boundary6809 } from "./6809-instruction-preview.js";
import { code6809Rows } from "./6809-code.js";
import type { AddressLabel } from "./rom-reference.js";
import type { Decoded6809 } from "./6809-disassembly.js";
import { hex6809 as hex } from "./6809-disassembly.js";
import { captureMemory } from "./memory-window.js";
import { createInspectorChoices } from "./inspector-controls.js";
import { memoryLink } from "./memory-link.js";

export interface Code6809Annotations {
  readonly entry?: AddressLabel;
  readonly operand?: { readonly address: number; readonly label?: AddressLabel; readonly text?: string };
  readonly note?: string;
}

/** A held code inspector owns its observations; navigating or changing modes never reads a machine. */
export function create6809CodeView(panel: HTMLElement, catalogue: Catalogue6809,
  memory: { readonly address: () => number; readonly browse: (address: number) => void }) {
  const body = panel.querySelector<HTMLTableSectionElement>("[data-code-rows]")!;
  const status = panel.querySelector<HTMLElement>("[data-code-status]")!;
  let image: Int16Array = new Int16Array(0x10000).fill(-1), pc = 0, dp = 0, recent: readonly Boundary6809[] = [];
  let annotate: (row: Decoded6809, dp?: number) => Code6809Annotations = () => ({});
  const mode = createInspectorChoices("Disassembly source", [
    { value: "pc", label: "PC", title: "Follow PC, with the last three executed instructions" },
    { value: "mem", label: "MEM", title: "Follow the Memory panel's selected address" },
  ], "pc", render);
  const notes = document.createElement("button"); notes.type = "button"; notes.textContent = "Notes";
  notes.setAttribute("aria-label", "Show ROM comments"); notes.setAttribute("aria-pressed", "true");
  let showNotes = true;
  notes.addEventListener("click", () => {
    showNotes = !showNotes; notes.setAttribute("aria-pressed", String(showNotes));
    panel.querySelector<HTMLElement>("[data-code-notes-heading]")!.hidden = !showNotes;
    views.forEach(view => { view.note.hidden = !showNotes; });
  });
  const controls = document.createElement("span"); controls.className = "lab-inspector-controls";
  controls.append(mode.element, notes);
  const views = Array.from({ length: 16 }, () => {
    const row = body.insertRow(), pointer = row.insertCell(), entry = row.insertCell(), address = row.insertCell(), bytes = row.insertCell(), assembly = row.insertCell();
    const operand = row.insertCell(), note = row.insertCell(); note.className = "lab-rom-note";
    // Keep address buttons stable while execution changes their destinations.
    const button = document.createElement("button"); button.type = "button"; address.append(button);
    let location = 0; button.addEventListener("click", () => memory.browse(location));
    return { row, pointer, bytes, assembly, entry, operand, note, show(address: number) {
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
      const references = annotate(row, row.executed ? row.dp : current ? dp : undefined);
      const operand = references.operand;
      const encoded = row.assembly.match(/\$[0-9A-F]{2,4}/);
      if (operand && encoded) {
        const offset = encoded.index!;
        view.assembly.replaceChildren(row.assembly.slice(0, offset), memoryLink(operand.address, memory.browse, encoded[0]),
          row.assembly.slice(offset + encoded[0].length));
      } else if (row.target !== undefined && row.complete) {
        const text = `$${hex(row.target)}`, offset = row.assembly.lastIndexOf(text);
        view.assembly.replaceChildren(row.assembly.slice(0, offset), memoryLink(row.target, memory.browse), row.assembly.slice(offset + text.length));
      } else view.assembly.textContent = row.assembly;
      for (const [cell, label, text, address] of [
        [view.entry, references.entry, references.entry?.name, row.address],
        [view.operand, operand?.label, operand?.text, operand?.address],
      ] as const) {
        cell.replaceChildren();
        if (label && address !== undefined) {
          const link = memoryLink(address, memory.browse, text); link.className = "lab-code-label";
          link.title = `$${label.address} · ${label.description}`; cell.append(link);
        }
      }
      view.note.textContent = references.note ?? "";
    });
  }
  return {
    controls,
    browse(address: number): void { mode.select("mem"); memory.browse(address); render(); },
    memoryMoved(): void { if (mode.value === "mem") render(); },
    refresh(read: (address: number) => number | undefined, state: { readonly pc: number; readonly dp: number }, records: readonly Boundary6809[],
      annotations: typeof annotate): void {
      image = captureMemory(read); pc = state.pc; dp = state.dp; recent = [...records]; annotate = annotations; render();
    },
  };
}
