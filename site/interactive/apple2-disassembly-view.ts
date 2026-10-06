import type { createApple2Breakpoints } from "./apple2-breakpoint-view.js";
import type { createApple2Session } from "./apple2-session.js";
import { apple2CodeReferences, apple2CodeRows } from "./apple2-disassembly.js";
import type { Apple2CodeRow } from "./apple2-disassembly.js";
import { apple2StorageReader } from "./apple2-inspection.js";
import { memoryLink } from "./memory-link.js";
import { address6502Operand, hex, parseApple2Address } from "./apple2-explorer.js";
import type { Apple2TraceEntry, InstructionCatalogue, AddressLabel, MemoryLabel } from "./apple2-explorer.js";
import { createInspectorChoices } from "./inspector-controls.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

/** A laboratory instrument: navigation changes the view; address buttons request normal execution. */
export function createApple2Disassembly(root: HTMLElement, catalogue: {
  readonly instructions: InstructionCatalogue; readonly routines: readonly AddressLabel[]; readonly labels: readonly MemoryLabel[];
}, runTo: (address: number) => void, showReference: (address: number) => void, memory: {
  readonly address: () => number; readonly browse: (address: number) => void; readonly show: () => void;
}, breakpoints?: ReturnType<typeof createApple2Breakpoints>) {
  const panel = root.querySelector<HTMLElement>("[data-disassembly]");
  if (panel === null) return undefined;
  const element = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-disassembly-${name}]`)!;
  const form = element<HTMLFormElement>("form"), address = element<HTMLInputElement>("address");
  const run = element<HTMLButtonElement>("run");
  const back = element<HTMLButtonElement>("back");
  const next = element<HTMLButtonElement>("next"), status = element("status"), body = element<HTMLTableSectionElement>("rows");
  let start = 0, machine: Machine | undefined, canRun = false, running = false;
  const history: number[] = [];
  let rows: readonly Apple2CodeRow[] = [];
  let recent: readonly Apple2TraceEntry[] = [];
  const mode = createInspectorChoices("Disassembly source", [
    { value: "pc", label: "PC", title: "Disassemble from PC" }, { value: "mem", label: "MEM", title: "Disassemble from Memory" },
  ], "pc", () => { history.length = 0; address.setCustomValidity(""); render(); });
  function referenceLink(kind: "entry" | "operand") {
    const button = document.createElement("button");
    button.type = "button"; button.className = "lab-code-label";
    let label: AddressLabel | undefined;
    button.addEventListener("click", () => { if (label) showReference(parseInt(label.address, 16)); });
    return {
      button,
      show(value: AddressLabel | undefined, text = value?.name): void {
        label = value;
        button.hidden = label === undefined;
        button.textContent = text ?? "";
        button.title = label === undefined ? "" : `$${label.address} · ${label.description}`;
        button.setAttribute("aria-label", `Read ${kind === "entry" ? "ROM" : "address"} reference for ${label?.name ?? kind}`);
      },
    };
  }
  // Stable rows preserve keyboard focus as execution updates the view.
  const views = Array.from({ length: 16 }, (_, index) => {
    const row = body.insertRow(), stop = row.insertCell(), pointer = row.insertCell(), routine = row.insertCell(), location = row.insertCell();
    const bytes = row.insertCell(), instruction = row.insertCell(), reference = row.insertCell();
    const button = document.createElement("button"), assembly = document.createElement("span");
    const label = referenceLink("entry"), operand = referenceLink("operand");
    button.type = "button";
    const breakpoint = document.createElement("button"); breakpoint.type = "button"; breakpoint.className = "lab-breakpoint-marker";
    breakpoint.addEventListener("click", () => { const row = rows[index]; if (row) breakpoints?.toggle(row.address, row.romMapped); });
    stop.append(breakpoint);
    routine.append(label.button); location.append(button); instruction.append(assembly); reference.append(operand.button);
    button.addEventListener("click", () => { if (canRun && rows[index]?.complete) runTo(rows[index]!.address); });
    return { row, pointer, button, breakpoint, bytes, assembly, label, operand };
  });
  function go(value: number): void {
    if (value !== start) history.push(start);
    address.setCustomValidity("");
    mode.select("mem"); memory.browse(value); start = value; address.value = hex(start); render();
  }
  function nextAddress(): number | undefined {
    const last = rows.at(-1), value = last === undefined ? 0x10000 : last.address + last.bytes.length;
    return value <= 0xffff ? value : undefined;
  }
  function useAddress(action: (value: number) => void): void {
    try { address.setCustomValidity(""); action(parseApple2Address(address.value)); }
    catch (error) { address.setCustomValidity((error as Error).message); address.reportValidity(); }
  }
  form.addEventListener("submit", event => {
    event.preventDefault(); useAddress(go);
  });
  run.addEventListener("click", () => { if (canRun) useAddress(runTo); });
  address.addEventListener("input", () => address.setCustomValidity(""));
  back.addEventListener("click", () => {
    const previous = history.pop();
    if (previous !== undefined) {
      mode.select("mem"); memory.browse(previous); start = previous; address.value = hex(start); address.setCustomValidity(""); render();
    }
  });
  next.addEventListener("click", () => { const address = nextAddress(); if (address !== undefined) go(address); });

  function render(): void {
    if (machine === undefined) return;
    const pc = machine.cpu.snapshot().pc;
    start = mode.value === "pc" ? pc : memory.address();
    const read = apple2StorageReader(machine);
    const romMapped = machine.firmware.loaded && !machine.language.ramRead();
    rows = apple2CodeRows(read, start, catalogue.instructions, romMapped, mode.value === "pc" ? recent : []);
    if (document.activeElement !== address) address.value = hex(start);
    views.forEach((view, index) => {
      const row = rows[index]; view.row.hidden = row === undefined;
      if (row === undefined) return;
      const current = !row.executed && row.address === pc;
      const references = apple2CodeReferences(row, catalogue.instructions, catalogue.routines, catalogue.labels);
      view.row.classList.toggle("is-current", current);
      view.row.classList.toggle("is-executed", row.executed);
      view.row.classList.toggle("flow-unconditional", row.controlFlow === "unconditional");
      view.row.classList.toggle("flow-conditional", row.controlFlow === "conditional");
      view.pointer.textContent = current ? "→" : row.executed ? "·" : "";
      view.pointer.setAttribute("aria-label", current ? "Next instruction" : row.executed ? "Previously executed" : "");
      view.row.title = row.controlFlow === "unconditional" ? "Unconditional control transfer" :
        row.controlFlow === "conditional" ? "Conditional branch (taken or not taken)" : "";
      view.button.textContent = hex(row.address);
      view.button.setAttribute("aria-label", `Run to $${hex(row.address)}: ${row.assembly}`);
      view.button.disabled = !canRun || !row.complete;
      view.bytes.textContent = row.bytes.map(byte => byte === undefined ? "--" : hex(byte, 2)).join(" ");
      const operand = row.complete ? address6502Operand(row.address, row.bytes, catalogue.instructions) : undefined;
      const encoded = row.assembly.match(/\$[0-9A-F]{2,4}/);
      if (operand && encoded) {
        const offset = encoded.index!;
        view.assembly.replaceChildren(row.assembly.slice(0, offset),
          memoryLink(operand.address, address => { memory.browse(address); memory.show(); }, encoded[0]),
          row.assembly.slice(offset + encoded[0].length));
      } else view.assembly.textContent = row.assembly;
      view.label.show(references.entry);
      view.operand.show(references.operand?.label, references.operand?.text);
    });
    refreshBreakpoints();
    back.disabled = history.length === 0; next.disabled = nextAddress() === undefined; run.disabled = !canRun;
    status.setAttribute("aria-live", running ? "off" : "polite");
    status.textContent = `${mode.value === "pc" ? "PC" : "MEM"} · $${hex(start)}`;
  }
  function refreshBreakpoints(): void {
    views.forEach((view, index) => {
      const row = rows[index]; if (!row) return;
      const point = breakpoints?.at(row.address, row.romMapped);
      view.breakpoint.textContent = point?.enabled ? "●" : "○";
      view.breakpoint.setAttribute("aria-pressed", String(point?.enabled ?? false));
      view.breakpoint.setAttribute("aria-label", `${point?.enabled ? "Disable" : "Enable"} breakpoint at $${hex(row.address)}${row.romMapped && row.address >= 0xd000 ? " in ROM" : ""}`);
      view.breakpoint.title = view.breakpoint.getAttribute("aria-label")!;
    });
  }
  return {
    refreshBreakpoints,
    controls: mode.element,
    browse: go,
    refresh(selected: Machine | undefined, records: readonly Apple2TraceEntry[], available: boolean, active: boolean, update: boolean): void {
      machine = selected; recent = records; canRun = available && !active; running = active;
      // Execution controls must stay safe even while the displayed code is frozen.
      run.disabled = !canRun;
      views.forEach((view, index) => { view.button.disabled = !canRun || !rows[index]?.complete; });
      if (update) render();
    },
  };
}
