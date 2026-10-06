import { hex, parseApple2Address } from "./apple2-explorer.js";
import { decodeInstructionBreakpoints } from "./instruction-debugger.js";
import type { createInstructionDebugger, InstructionBreakpoint } from "./instruction-debugger.js";

export function createApple2Breakpoints(root: HTMLElement, debuggerState: ReturnType<typeof createInstructionDebugger>, changed: () => void) {
  const panel = root.querySelector<HTMLElement>("[data-breakpoints]");
  if (!panel) return undefined;
  const form = panel.querySelector<HTMLFormElement>("form")!, address = form.querySelector<HTMLInputElement>("[name=address]")!;
  const scope = form.querySelector<HTMLSelectElement>("[name=scope]")!, output = panel.querySelector<HTMLElement>("[data-breakpoint-rows]")!;
  const status = panel.querySelector<HTMLElement>("[data-breakpoint-status]")!, count = panel.querySelector<HTMLElement>("[data-breakpoint-count]")!;
  const key = "dromaios:debugger:apple2:breakpoints";
  try { debuggerState.setBreakpoints(decodeInstructionBreakpoints(window.localStorage.getItem(key), ["rom"], 0xffff)); }
  catch { /* Breakpoints still work for this visit when storage is unavailable. */ }
  function save(values: readonly InstructionBreakpoint[]): void {
    debuggerState.setBreakpoints(values);
    try { window.localStorage.setItem(key, JSON.stringify(values)); status.textContent = ""; }
    catch { status.textContent = "Breakpoints are available for this visit; browser storage is unavailable."; }
    render(); changed();
  }
  function render(): void {
    output.replaceChildren();
    const points = debuggerState.breakpoints;
    count.textContent = ` (${points.filter(point => point.enabled).length}/${points.length})`;
    for (const point of points) {
      const row = document.createElement("div"), label = document.createElement("label"), enabled = document.createElement("input");
      row.className = "lab-breakpoint-row"; enabled.type = "checkbox"; enabled.checked = point.enabled;
      const name = `$${hex(point.address)} · ${point.space === "rom" ? "ROM only" : "any mapping"}`;
      enabled.setAttribute("aria-label", `Enable breakpoint at ${name}`);
      enabled.addEventListener("change", () => save(points.map(item => item === point ? { ...point, enabled: enabled.checked } : item)));
      label.append(enabled, name);
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove breakpoint at ${name}`);
      remove.addEventListener("click", () => save(points.filter(item => item !== point)));
      row.append(label, remove); output.append(row);
    }
    if (!points.length) output.textContent = "No breakpoints.";
  }
  function set(address: number, space?: string): void {
    const points = debuggerState.breakpoints, existing = points.find(point => point.address === address && point.space === space);
    if (!existing && points.length >= 64) throw new Error("Keep at most 64 breakpoints.");
    save(existing ? points.map(point => point === existing ? { ...point, enabled: !point.enabled } : point)
      : [...points, { address, ...(space && { space }), enabled: true }]);
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    try {
      const value = parseApple2Address(address.value), space = scope.value === "rom" ? "rom" : undefined;
      if (space && value < 0xd000) throw new Error("Motherboard ROM occupies D000–FFFF.");
      const existing = debuggerState.breakpoints.find(point => point.address === value && point.space === space);
      if (!existing?.enabled) set(value, space);
      address.value = "";
    } catch (error) { address.setCustomValidity((error as Error).message); address.reportValidity(); }
  });
  address.addEventListener("input", () => address.setCustomValidity(""));
  scope.addEventListener("change", () => address.setCustomValidity(""));
  const applicable = (address: number, romMapped: boolean) => debuggerState.breakpoints
    .filter(point => point.address === address && (point.space !== "rom" || romMapped));
  render();
  return {
    at(address: number, romMapped: boolean): InstructionBreakpoint | undefined {
      const points = applicable(address, romMapped);
      return points.find(point => point.enabled) ?? points[0];
    },
    toggle(address: number, romMapped: boolean): void {
      try {
        const points = applicable(address, romMapped);
        if (points.length) {
          const enabled = !points.some(point => point.enabled);
          save(debuggerState.breakpoints.map(point => points.includes(point) ? { ...point, enabled } : point));
        } else set(address, romMapped && address >= 0xd000 ? "rom" : undefined);
      }
      catch (error) { status.textContent = (error as Error).message; }
    },
  };
}
