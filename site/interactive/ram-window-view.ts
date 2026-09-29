import type { Ram } from "../../src/components/memory/ram.js";
import { asciiByteLabel } from "./ascii.js";
import { hex } from "./register-programs.js";

/** Inspect a displayed RAM range and mark a pointer, without changing either. */
export function renderRamWindow(root: HTMLElement, ram: Ram, pointer: number, running: boolean): void {
  const name = root.dataset.pointerName!;
  let visible = false;
  for (const row of root.querySelectorAll<HTMLElement>("[data-ram-cell]")) {
    const address = Number(row.dataset.ramCell);
    const value = ram.read(address); // This view accepts concrete RAM, never a device read path.
    const selected = address === pointer;
    visible ||= selected;
    row.querySelector<HTMLElement>("[data-ram-byte]")!.textContent = hex(value, 2);
    row.querySelector<HTMLElement>("[data-ram-character]")!.textContent = asciiByteLabel(value);
    row.querySelector<HTMLElement>("[data-ram-pointer]")!.textContent = selected ? `← ${name}` : "";
    if (selected) row.setAttribute("aria-current", "location");
    else row.removeAttribute("aria-current");
  }
  const status = root.querySelector<HTMLElement>("[data-ram-window-status]")!;
  status.setAttribute("aria-live", running ? "off" : "polite");
  const message = `${name} = ${hex(pointer, 4)}${visible ? ": the marked row is the addressed byte." : " is outside this window; no displayed byte is addressed."}`;
  if (status.textContent !== message) status.textContent = message;
}
