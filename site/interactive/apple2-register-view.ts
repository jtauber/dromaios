import type { Cpu6502Snapshot, Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import { hex } from "./apple2-explorer.js";
import { registerEditor } from "./register-editor.js";
import type { Editable6502Register } from "./apple2-register-edit.js";

export function createApple2Registers(cpuView: HTMLElement, edit?: (register: Editable6502Register, text: string) => void) {
  let state: Cpu6502Snapshot | undefined, latest: Cpu6502StepRecord | undefined;
  const editors: ReturnType<typeof registerEditor>[] = [];
  const updateValues: ((state: Cpu6502Snapshot) => void)[] = [];
  const registers = document.createElement("span"), flags = document.createElement("span");
  registers.className = "apple2-registers"; flags.className = "apple2-flags";
  cpuView.replaceChildren(registers, "\n", flags);
  function addValue(name: string, read: (state: Cpu6502Snapshot) => number, width: number, flagName?: string): void {
    const field = document.createElement("span"), label = document.createElement("span");
    const value = document.createElement(flagName || !edit ? "span" : "button"), change = document.createElement("span");
    if (value instanceof HTMLButtonElement) {
      value.type = "button"; value.setAttribute("aria-label", `Edit ${name.toUpperCase()}`);
      editors.push(registerEditor(value, name as Editable6502Register, () => state![name as Editable6502Register],
        text => edit!(name as Editable6502Register, text)));
    }
    field.className = "apple2-cpu-value"; field.dataset.cpuValue = name;
    label.className = "apple2-cpu-label"; label.textContent = name.toUpperCase();
    value.className = "apple2-cpu-number";
    change.className = "visually-hidden";
    field.append(label, flagName ? "" : " ", value, change);
    if (flagName) { field.classList.add("apple2-cpu-flag"); field.setAttribute("role", "img"); }
    (flagName ? flags : registers).append(field, "  ");
    updateValues.push(state => {
      const label = name.toUpperCase(), current = hex(read(state), width);
      const changed = latest !== undefined && read(latest.before) !== read(latest.after);
      const previous = latest === undefined ? current : hex(read(latest.before), width);
      value.textContent = `${flagName ? "=" : "$"}${current}`;
      field.classList.toggle("is-changed", changed);
      field.title = changed ? `${label} changed ${previous} → ${current} in the last instruction` : flagName ? "" : edit ? "Click to edit while paused; Enter applies, Escape cancels." : "";
      if (flagName) {
        const set = read(state) !== 0;
        field.classList.toggle("is-set", set);
        field.title = `${flagName} (${label}): ${set ? "set" : "clear"} (${current})` + (changed ? `. ${field.title}` : "");
        field.setAttribute("aria-label", field.title);
      }
      change.textContent = changed ? ` (changed from ${previous})` : "";
    });
  }
  for (const row of [["a", "x", "y"], ["pc", "sp"]] as const) {
    for (const name of row) addValue(name, state => state[name], name === "pc" ? 4 : 2);
    registers.append("\n");
  }
  for (const [flag, name] of [["n", "Negative"], ["v", "Overflow"], ["d", "Decimal"],
    ["i", "IRQ disable"], ["z", "Zero"], ["c", "Carry"]] as const) addValue(flag, state => +state.flags[flag], 1, name);
  return {
    refresh(current: Cpu6502Snapshot, record: Cpu6502StepRecord | undefined, editable: boolean, update: boolean): void {
      state = current; latest = record;
      for (const editor of editors) editor.enable(editable);
      if (update) for (const show of updateValues) show(current);
    },
  };
}
