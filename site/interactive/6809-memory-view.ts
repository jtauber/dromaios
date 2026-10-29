import { create6809MemoryObservation, stack6809Rows } from "./6809-memory.js";
import type { MemoryRegister6809 } from "./6809-memory.js";
import { hex6809 as hex } from "./6809-disassembly.js";
import { createInspectorChoices } from "./inspector-controls.js";
import { memoryLink } from "./memory-link.js";

/** Pointer-oriented storage views; the host supplies observations and handles navigation. */
export function create6809MemoryView(panel: HTMLElement, register: MemoryRegister6809, browse: (address: number) => void) {
  const observation = create6809MemoryObservation(), direct = register === "dp", name = register.toUpperCase();
  const status = panel.querySelector<HTMLElement>("[data-register-memory-status]")!;
  const output = panel.querySelector<HTMLElement>("[data-register-memory-output]")!;
  const controls = document.createElement("span"); controls.className = "lab-inspector-controls";
  let page = 0, initialized = false;
  const follow = createInspectorChoices("Direct page follows", [
    { value: "fixed", label: "FIX", title: "Keep the displayed page fixed" },
    { value: "dp", label: "DP", title: "Follow the direct-page register" },
  ], "dp", value => { if (value === "dp") page = observation.pointer("dp"); render(); });
  const widthKey = `dromaios:inspectors:coco:${register}:width`;
  const sizes = direct ? [8, 16] as const : [1, 2] as const;
  let initial: number = direct ? 16 : 2;
  try { const saved = Number(localStorage.getItem(widthKey)); if (sizes.some(size => size === saved)) initial = saved; }
  catch { /* The default works without browser storage. */ }
  const width = createInspectorChoices(direct ? "Direct-page bytes per row" : `${name} stack grouping`, sizes.map(value => ({
    value, label: direct ? String(value) : value === 1 ? "BYTE" : "WORD",
    title: direct ? `${value} bytes per row` : value === 1 ? "Individual bytes" : "Pairs beginning at the pointer, high byte first",
  })), initial, value => {
    render();
    try { localStorage.setItem(widthKey, String(value)); } catch { /* Retain this visit's choice. */ }
  });
  if (direct) controls.append(follow.element);
  controls.append(width.element);

  function byte(address: number): HTMLElement {
    const observed = observation.byte(address), element = document.createElement("span");
    element.className = "lab-memory-byte"; element.dataset.memoryByte = hex(observed.address);
    element.textContent = observed.value === undefined ? "--" : hex(observed.value, 2);
    element.classList.toggle("is-changed", observed.changed);
    element.title = `$${hex(observed.address)}: ` + (observed.value === undefined ? "no observable storage"
      : observed.changed ? `${hex(observed.before!, 2)} → ${hex(observed.value, 2)}` : hex(observed.value, 2));
    return element;
  }
  function render(): void {
    const pointer = observation.pointer(register), contents = document.createDocumentFragment();
    status.textContent = direct ? `DP=$${hex(pointer, 2)} · $${hex(page * 256)}–$${hex(page * 256 + 255)}` : `${name}=$${hex(pointer)}`;
    if (direct) {
      const dump = document.createElement("pre"); dump.className = "coco-direct-page";
      for (let offset = 0; offset < 256; offset += width.value) {
        const address = page * 256 + offset;
        if (offset > 0) dump.append("\n");
        dump.append(memoryLink(address, browse, hex(address)), " ");
        for (let i = 0; i < width.value; i++) dump.append(" ", byte(address + i));
      }
      contents.append(dump);
    } else {
      const table = document.createElement("table"); table.className = "coco-stack";
      const headings = table.createTHead().insertRow();
      for (const title of ["Offset", "Address", "Bytes", ...(width.value === 2 ? ["Word"] : [])]) {
        const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = title; headings.append(cell);
      }
      const rows = table.createTBody();
      for (const { offset, address } of stack6809Rows(pointer, width.value as 1 | 2)) {
        const row = rows.insertRow(); row.classList.toggle("is-pointer", offset === 0);
        row.insertCell().textContent = offset === 0 ? `→ ${name}` : `${offset < 0 ? "−" : "+"}${Math.abs(offset)}`;
        row.insertCell().append(memoryLink(address, browse, hex(address)));
        const bytes = row.insertCell(); bytes.append(byte(address));
        if (width.value === 2) {
          bytes.append(" ", byte(address + 1));
          const word = observation.word(address);
          row.insertCell().textContent = word === undefined ? "----" : hex(word);
        }
      }
      contents.append(table);
    }
    output.replaceChildren(contents);
  }
  return {
    controls,
    reset(): void { observation.reset(); },
    refresh(read: (address: number) => number | undefined, pointers: Readonly<Record<MemoryRegister6809, number>>): void {
      observation.refresh(read, pointers);
      if (!initialized || follow.value === "dp") page = pointers.dp;
      initialized = true; render();
    },
  };
}
