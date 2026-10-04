import type { createApple2Session } from "./apple2-session.js";
import { apple2CodeRows } from "./apple2-disassembly.js";
import type { Apple2CodeRow } from "./apple2-disassembly.js";
import { apple2StorageReader } from "./apple2-inspection.js";
import { hex, parseApple2Address, romRoutine } from "./apple2-explorer.js";
import type { Apple2TraceEntry, InstructionCatalogue, RomRoutine } from "./apple2-explorer.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

/** A laboratory instrument: navigation changes the view; address buttons request normal execution. */
export function createApple2Disassembly(root: HTMLElement, catalogue: {
  readonly instructions: InstructionCatalogue; readonly routines: readonly RomRoutine[];
}, runTo: (address: number) => void) {
  const panel = root.querySelector<HTMLElement>("[data-disassembly]");
  if (panel === null) return undefined;
  const element = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-disassembly-${name}]`)!;
  const form = element<HTMLFormElement>("form"), address = element<HTMLInputElement>("address");
  const run = element<HTMLButtonElement>("run");
  const follow = element<HTMLInputElement>("follow"), back = element<HTMLButtonElement>("back");
  const next = element<HTMLButtonElement>("next"), status = element("status"), body = element<HTMLTableSectionElement>("rows");
  let start = 0, machine: Machine | undefined, canRun = false, running = false;
  const history: number[] = [];
  let rows: readonly Apple2CodeRow[] = [];
  let recent: readonly Apple2TraceEntry[] = [];
  // Stable rows preserve keyboard focus as execution updates the view.
  const views = Array.from({ length: 16 }, (_, index) => {
    const row = body.insertRow(), pointer = row.insertCell(), location = row.insertCell();
    const bytes = row.insertCell(), instruction = row.insertCell();
    const button = document.createElement("button"), assembly = document.createElement("span"), label = document.createElement("small");
    button.type = "button"; label.className = "lab-code-label";
    location.append(button); instruction.append(assembly, label);
    button.addEventListener("click", () => { if (canRun && rows[index]?.complete) runTo(rows[index]!.address); });
    return { row, pointer, button, bytes, assembly, label };
  });
  function go(value: number): void {
    if (value !== start) history.push(start);
    address.setCustomValidity("");
    follow.checked = false; start = value; address.value = hex(start); render();
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
  follow.addEventListener("change", () => { history.length = 0; address.setCustomValidity(""); render(); });
  back.addEventListener("click", () => {
    const previous = history.pop();
    if (previous !== undefined) {
      follow.checked = false; start = previous; address.value = hex(start); address.setCustomValidity(""); render();
    }
  });
  next.addEventListener("click", () => { const address = nextAddress(); if (address !== undefined) go(address); });

  function render(): void {
    if (machine === undefined) return;
    const pc = machine.cpu.snapshot().pc;
    if (follow.checked) start = pc;
    const read = apple2StorageReader(machine);
    const romMapped = machine.firmware.loaded && !machine.language.ramRead();
    rows = apple2CodeRows(read, start, catalogue.instructions, romMapped, follow.checked ? recent : []);
    if (document.activeElement !== address) address.value = hex(start);
    views.forEach((view, index) => {
      const row = rows[index]; view.row.hidden = row === undefined;
      if (row === undefined) return;
      const current = !row.executed && row.address === pc, routine = romRoutine(row.address, row.romMapped, catalogue.routines);
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
      view.assembly.textContent = row.assembly;
      view.label.textContent = routine?.name ?? "";
      view.label.title = routine?.description ?? "";
    });
    back.disabled = history.length === 0; next.disabled = nextAddress() === undefined; run.disabled = !canRun;
    status.setAttribute("aria-live", running ? "off" : "polite");
    status.textContent = `${follow.checked ? "Following PC" : "Browsing"} · $${hex(start)} · select an address to run there.`;
  }
  return {
    refresh(selected: Machine | undefined, records: readonly Apple2TraceEntry[], available: boolean, active: boolean, update: boolean): void {
      machine = selected; recent = records; canRun = available && !active; running = active;
      // Execution controls must stay safe even while the displayed code is frozen.
      run.disabled = !canRun;
      views.forEach((view, index) => { view.button.disabled = !canRun || !rows[index]?.complete; });
      if (update) render();
    },
  };
}
