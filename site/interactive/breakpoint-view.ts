import { decodeInstructionBreakpoints } from "./instruction-debugger.js";
import type { InstructionBreakpoint } from "./instruction-debugger.js";

const hex = (address: number) => address.toString(16).toUpperCase().padStart(4, "0");

/** Address-stop editing and persistence. The machine supplies valid mappings, storage identity, and stop policy. */
export function createBreakpointView(panel: HTMLElement | null, options: {
  readonly kind: "breakpoint" | "watchpoint";
  readonly key: string;
  readonly maximum: number;
  readonly spaces?: readonly { readonly value: string; readonly label: string; readonly accepts: (address: number) => boolean }[];
  readonly defaultSpace?: (address: number, space: string | undefined) => string | undefined;
  readonly values: () => readonly InstructionBreakpoint[];
  readonly set: (values: readonly InstructionBreakpoint[]) => void;
  readonly changed: () => void;
  readonly history?: (address: number) => void;
}) {
  if (!panel) return undefined;
  const { kind, key, maximum, values, set, changed, spaces = [] } = options;
  const form = panel.querySelector<HTMLFormElement>("form")!, input = form.querySelector<HTMLInputElement>("[name=address]")!;
  const scope = form.querySelector<HTMLSelectElement>("[name=scope]");
  const output = panel.querySelector<HTMLElement>("[data-stop-rows]")!, status = panel.querySelector<HTMLElement>("[data-stop-status]")!;
  const count = panel.querySelector<HTMLElement>("[data-stop-count]");
  try { set(decodeInstructionBreakpoints(localStorage.getItem(key), spaces.map(space => space.value), maximum)); }
  catch { status.textContent = "Browser storage is unavailable; these stops work for this visit."; }
  function save(points: readonly InstructionBreakpoint[]): void {
    if (points.length > 64) throw new Error(`Keep at most 64 ${kind}s.`);
    set(points);
    try { localStorage.setItem(key, JSON.stringify(values())); status.textContent = ""; }
    catch { status.textContent = "These stops work for this visit, but could not be saved."; }
    render(); changed();
  }
  function render(): void {
    output.replaceChildren(); const points = values();
    if (count) count.textContent = ` (${points.filter(point => point.enabled).length}/${points.length})`;
    for (const point of points) {
      const row = document.createElement("div"), label = document.createElement("label"), enabled = document.createElement("input");
      row.className = "lab-breakpoint-row"; enabled.type = "checkbox"; enabled.checked = point.enabled;
      const name = `$${hex(point.address)}` + (spaces.length ? ` · ${spaces.find(space => space.value === point.space)?.label ?? "any mapping"}` : "");
      enabled.setAttribute("aria-label", `Enable ${kind} at ${name}`);
      enabled.addEventListener("change", () => save(points.map(item => item === point ? { ...point, enabled: enabled.checked } : item)));
      label.append(enabled, name);
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${kind} at ${name}`);
      remove.addEventListener("click", () => save(points.filter(item => item !== point)));
      row.append(label);
      if (options.history) {
        const history = document.createElement("button"); history.type = "button"; history.textContent = "History";
        history.setAttribute("aria-label", `History for watch at $${hex(point.address)}`);
        history.addEventListener("click", () => options.history!(point.address)); row.append(history);
      }
      row.append(remove); output.append(row);
    }
    if (!points.length) output.textContent = `No ${kind}s.`;
  }
  function add(address: number, space?: string): void {
    const points = values(), existing = points.find(point => point.address === address && point.space === space);
    save(existing ? points.map(point => point === existing ? { ...point, enabled: true } : point)
      : [...points, { address, ...(space && { space }), enabled: true }]);
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    try {
      const text = input.value.trim().replace(/^\$|^0x/i, ""), address = parseInt(text, 16);
      if (!/^[0-9a-f]{1,4}$/i.test(text) || address > maximum) throw new Error(`Enter a hexadecimal address from 0000 to ${hex(maximum)}.`);
      const space = spaces.find(space => space.value === scope?.value);
      if (space && !space.accepts(address)) throw new Error(`$${hex(address)} cannot use the ${space.label} filter.`);
      add(address, space?.value); input.value = "";
    } catch (cause) { input.setCustomValidity((cause as Error).message); input.reportValidity(); }
  });
  input.addEventListener("input", () => input.setCustomValidity(""));
  scope?.addEventListener("change", () => input.setCustomValidity(""));
  const applicable = (address: number, space?: string) => values().filter(point => point.address === address && (point.space === undefined || point.space === space));
  render();
  return {
    at(address: number, space?: string): InstructionBreakpoint | undefined {
      const points = applicable(address, space); return points.find(point => point.enabled) ?? points[0];
    },
    toggle(address: number, space?: string): void {
      try {
        const points = applicable(address, space);
        if (points.length) save(values().map(point => points.includes(point) ? { ...point, enabled: !points.some(point => point.enabled) } : point));
        else add(address, options.defaultSpace?.(address, space));
      } catch (cause) { status.textContent = (cause as Error).message; }
    },
  };
}
