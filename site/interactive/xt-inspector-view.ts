import { cpu8088StateDescription as fields } from "../../src/components/cpus/generated/8088-cpu.js";
import type { Cpu8088Snapshot } from "../../src/components/cpus/generated/8088-cpu.js";
import { logical8088, physical8088, xtHex } from "./8088-disassembly.js";
import { readXtStorage, xtCodeRows } from "./xt-inspection.js";
import type { XtBoundary, XtCatalogue } from "./xt-inspection.js";
import type { XtMachine } from "./xt-session.js";
import type { createXtRomAnnotations } from "./xt-rom-guide.js";

export function createXtRegisterView(panel: HTMLElement) {
  const numbers = panel.querySelector<HTMLElement>(".lab-registers")!, flags = panel.querySelector<HTMLElement>(".lab-flags")!;
  const pointers = panel.querySelector<HTMLElement>("[data-pointers]")!;
  const fieldsToShow: ((state: Cpu8088Snapshot, before?: Cpu8088Snapshot) => void)[] = [];
  function field(name: string, read: (state: Cpu8088Snapshot) => number, digits: number, flag = false) {
    const cell = document.createElement("span"), label = document.createElement("span"), value = document.createElement("span");
    cell.className = flag ? "lab-cpu-value lab-cpu-flag" : "lab-cpu-value";
    cell.dataset.field = name; label.className = "lab-cpu-label"; label.textContent = name;
    value.className = "lab-cpu-number"; cell.append(label, value); (flag ? flags : numbers).append(cell);
    if (flag) cell.setAttribute("role", "img");
    fieldsToShow.push((state, before) => {
      const now = read(state), changed = before !== undefined && read(before) !== now;
      value.textContent = xtHex(now, digits);
      cell.title = name + " " + value.textContent + (changed ? " (was " + xtHex(read(before), digits) + ")" : "");
      cell.classList.toggle("is-changed", changed);
      if (flag) {
        cell.classList.toggle("is-set", now !== 0);
        cell.setAttribute("aria-label", cell.title);
      }
    });
  }
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    const spec = fields[key];
    if (spec.kind === "unsigned") field(key.toUpperCase(), state => Number(state[key]), spec.bits / 4);
  }
  for (const key of Object.keys(fields.flags.fields) as (keyof Cpu8088Snapshot["flags"])[]) {
    field(key.toUpperCase(), state => Number(state.flags[key]), 1, true);
  }
  return (state: Cpu8088Snapshot, before?: Cpu8088Snapshot) => {
    for (const show of fieldsToShow) show(state, before);
    pointers.textContent = `CS:IP ${logical8088(state.cs, state.ip)} → ${xtHex(state.pc, 5)}\nSS:SP ${logical8088(state.ss, state.sp)} → ${xtHex(physical8088(state.ss, state.sp), 5)}`;
  };
}

export function createXtCodeView(panel: HTMLElement, catalogue: XtCatalogue, annotations: ReturnType<typeof createXtRomAnnotations>) {
  const body = panel.querySelector("tbody")!, status = panel.querySelector<HTMLElement>("[data-code-status]")!;
  return (machine: XtMachine, state: Cpu8088Snapshot, records: readonly XtBoundary[]) => {
    const rows = xtCodeRows(catalogue.cpu, state, address => readXtStorage(machine, catalogue.storage, address), records);
    body.replaceChildren(...rows.map(({ row, kind }) => {
      const tr = document.createElement("tr");
      const annotation = annotations.annotate(row, machine.bios.loaded);
      tr.classList.add("is-" + kind);
      if (row.flow) tr.classList.add("flow-" + row.flow);
      const pointer = tr.insertCell();
      pointer.textContent = kind === "current" ? "→" : kind === "executed" ? "·" : "";
      if (kind !== "ahead") pointer.setAttribute("aria-label", kind === "current" ? "Current CS:IP" : "Previously executed");
      const entry = tr.insertCell(); entry.textContent = annotation.entry?.name ?? ""; entry.title = annotation.entry?.description ?? "";
      tr.insertCell().textContent = logical8088(row.cs, row.ip);
      tr.insertCell().textContent = xtHex(physical8088(row.cs, row.ip), 5);
      tr.insertCell().textContent = row.bytes.map(b => b === undefined ? "--" : xtHex(b, 2)).join(" ");
      tr.insertCell().textContent = row.assembly;
      const destination = tr.insertCell(); destination.textContent = annotation.target?.name ?? ""; destination.title = annotation.target?.description ?? "";
      const note = tr.insertCell(); note.className = "lab-rom-note"; note.textContent = annotation.note ?? "";
      return tr;
    }));
    status.textContent = state.halted ? "Halted · CS:IP points past HLT" : state.waiting ? "Waiting for TEST" : "Following CS:IP";
  };
}
