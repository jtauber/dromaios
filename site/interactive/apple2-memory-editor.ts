import { apple2EditableMemory } from "./apple2-memory-edit.js";
import type { Apple2MemoryEdit } from "./apple2-memory-edit.js";
import { apple2RamRegions } from "./apple2-inspection.js";
import { hex } from "./apple2-explorer.js";

/** Keep byte actions accurate when virtual scrolling replaces the visible cells. */
export function describeMemoryByte(button: HTMLElement, value: number | undefined): void {
  button.dataset.memoryValue = value === undefined ? "" : hex(value, 2);
  const action = button.closest("[data-memory-editing=true]") ? "Select" : "Watch";
  button.setAttribute("aria-label", `${action} $${button.dataset.memoryByte}: ${value === undefined ? "unavailable" : `$${hex(value, 2)}`}`);
  button.title = button.title.replace(/^(Watch|Select) /, `${action} `);
}

/** Explicit per-inspector edit mode. Enter applies one byte; Escape cancels the draft. */
export function createApple2MemoryEditor(panel: HTMLElement, apply: (edit: Apple2MemoryEdit, text: string) => void, refresh: () => void) {
  const control = document.createElement("span"); control.className = "lab-inspector-choices";
  const toggle = document.createElement("button"); toggle.type = "button"; toggle.textContent = "EDIT";
  toggle.setAttribute("aria-label", `Edit RAM in ${panel.dataset.panelTitle}`); control.append(toggle);
  const form = document.createElement("form"); form.className = "lab-memory-editor";
  const status = document.createElement("span"); status.setAttribute("role", "status");
  const input = document.createElement("input"); input.setAttribute("aria-label", "New byte (hex)");
  input.spellcheck = false; input.autocomplete = "off";
  const save = document.createElement("button"); save.type = "submit"; save.textContent = "Apply";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel";
  form.append(status, input, save, cancel); panel.querySelector(".lab-panel-body")!.prepend(form);
  let enabled = false, target: Apple2MemoryEdit | undefined;
  let displayed: ReturnType<typeof apple2EditableMemory> | undefined;
  let machine: Apple2MemoryEdit["machine"] | undefined;
  function clear(): void {
    target = undefined; input.hidden = save.hidden = cancel.hidden = true; input.setCustomValidity("");
    status.textContent = "Select a RAM byte. ROM and devices are read-only.";
  }
  function mode(value: boolean): void {
    enabled = value; panel.dataset.memoryEditing = String(value); toggle.setAttribute("aria-pressed", String(value));
    form.hidden = !value; clear();
    for (const button of panel.querySelectorAll<HTMLElement>("[data-memory-byte]")) {
      describeMemoryByte(button, button.dataset.memoryValue ? parseInt(button.dataset.memoryValue, 16) : undefined);
    }
  }
  toggle.addEventListener("click", () => { mode(!enabled); if (enabled) refresh(); });
  panel.addEventListener("click", event => {
    const byte = (event.target as Element).closest<HTMLElement>("[data-memory-byte]");
    if (!enabled || !byte) return;
    event.stopPropagation(); clear();
    try {
      if (!displayed || !byte.dataset.memoryValue) throw new Error("This address has no editable RAM byte.");
      target = displayed(parseInt(byte.dataset.memoryByte!, 16), parseInt(byte.dataset.memoryValue, 16));
      status.textContent = `${apple2RamRegions.find(region => region.part === target!.region)!.label} $${hex(target.address)} · ${hex(target.before, 2)} →`;
      input.hidden = save.hidden = cancel.hidden = false; input.value = hex(target.before, 2); input.focus(); input.select();
    } catch (error) { status.textContent = (error as Error).message; }
  });
  form.addEventListener("submit", event => {
    event.preventDefault(); if (!target) return;
    try { apply(target, input.value); clear(); }
    catch (error) { input.setCustomValidity((error as Error).message); input.reportValidity(); }
  });
  input.addEventListener("input", () => input.setCustomValidity(""));
  form.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); clear(); toggle.focus(); }
  });
  cancel.addEventListener("click", clear); mode(false);
  return {
    control,
    refresh(selected: Apple2MemoryEdit["machine"] | undefined, canEdit: boolean, updated: boolean): void {
      toggle.disabled = !canEdit || selected === undefined;
      if ((toggle.disabled && enabled) || selected !== machine) mode(false);
      machine = selected;
      // Scrolling and docking also refresh inspectors. Keep the explicit draft;
      // applying it still validates its original machine, bank, and before value.
      if (updated) displayed = selected ? apple2EditableMemory(selected) : undefined;
    },
  };
}
