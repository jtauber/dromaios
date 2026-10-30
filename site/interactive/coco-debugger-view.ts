import { decodeCocoAddressStops } from "./coco-debugger.js";
import type { CocoAddressStop, createCocoDebugger } from "./coco-debugger.js";
import { cocoHex as hex } from "./coco-inspection.js";

/** Address preferences and navigation only; the debugger owns stop decisions and captured writes. */
export function createCocoDebuggerView(root: HTMLElement, debug: ReturnType<typeof createCocoDebugger>, actions: {
  readonly changed: () => void;
  readonly code: (address: number) => void;
  readonly memory: (address: number) => void;
}) {
  function list(kind: "breakpoint" | "watchpoint", maximum: number, values: () => readonly CocoAddressStop[],
    set: (points: readonly CocoAddressStop[]) => void) {
    const panel = root.querySelector<HTMLElement>(`[data-coco-${kind}s]`)!;
    const form = panel.querySelector<HTMLFormElement>("form")!, input = form.querySelector<HTMLInputElement>("input")!;
    const output = panel.querySelector<HTMLElement>("[data-stop-rows]")!, status = panel.querySelector<HTMLElement>("[data-stop-status]")!;
    const key = `dromaios:debugger:coco:${kind}s`;
    try { set(decodeCocoAddressStops(localStorage.getItem(key), maximum)); }
    catch { status.textContent = "Browser storage is unavailable; these stops work for this visit."; }
    function render(): void {
      output.replaceChildren();
      const points = values();
      for (const point of points) {
        const row = document.createElement("div"), label = document.createElement("label"), enabled = document.createElement("input");
        row.className = "lab-breakpoint-row"; enabled.type = "checkbox"; enabled.checked = point.enabled;
        enabled.setAttribute("aria-label", `Enable ${kind} at $${hex(point.address)}`);
        enabled.addEventListener("change", () => save(points.map(item => item === point ? { ...point, enabled: enabled.checked } : item)));
        label.append(enabled, `$${hex(point.address)}`);
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×";
        remove.setAttribute("aria-label", `Remove ${kind} at $${hex(point.address)}`);
        remove.addEventListener("click", () => save(points.filter(item => item !== point)));
        row.append(label, remove); output.append(row);
      }
      if (!points.length) output.textContent = `No ${kind}s.`;
    }
    function save(points: readonly CocoAddressStop[]): void {
      set(points);
      try { localStorage.setItem(key, JSON.stringify(values())); status.textContent = ""; }
      catch { status.textContent = "These stops work for this visit, but could not be saved."; }
      render(); actions.changed();
    }
    function add(address: number): void {
      const points = values(), existing = points.find(point => point.address === address);
      save(existing ? points.map(point => point === existing ? { ...point, enabled: true } : point) : [...points, { address, enabled: true }]);
    }
    form.addEventListener("submit", event => {
      event.preventDefault();
      try {
        const text = input.value.trim().replace(/^\$|^0x/i, "");
        if (!/^[0-9a-f]{1,4}$/i.test(text) || parseInt(text, 16) > maximum) {
          throw new Error(`Enter a hexadecimal address from 0000 to ${hex(maximum)}.`);
        }
        add(parseInt(text, 16)); input.value = "";
      } catch (cause) { input.setCustomValidity((cause as Error).message); input.reportValidity(); }
    });
    input.addEventListener("input", () => input.setCustomValidity(""));
    render();
    return {
      has: (address: number) => values().some(point => point.address === address && point.enabled),
      toggle(address: number): void {
        try {
          const points = values(), existing = points.find(point => point.address === address);
          if (existing) save(points.map(point => point === existing ? { ...point, enabled: !point.enabled } : point));
          else add(address);
        } catch (cause) { status.textContent = (cause as Error).message; }
      },
    };
  }
  const breakpoints = list("breakpoint", 0xffff, () => debug.breakpoints, debug.setBreakpoints);
  list("watchpoint", 0x7fff, () => debug.watchpoints, debug.setWatchpoints);
  const code = root.querySelector<HTMLButtonElement>("[data-watchpoint-code]")!;
  const memory = root.querySelector<HTMLButtonElement>("[data-watchpoint-memory]")!;
  const navigation = root.querySelector<HTMLElement>("[data-watchpoint-navigation]")!;
  code.addEventListener("click", () => { if (debug.hit) actions.code(debug.hit.caller.address); });
  memory.addEventListener("click", () => { if (debug.hit) actions.memory(debug.hit.address); });
  return {
    ...breakpoints,
    refresh(): void {
      code.disabled = memory.disabled = !debug.hit;
      navigation.hidden = !debug.hit;
      const stop = debug.stop;
      const text = stop?.detail ?? (stop ? `${stop.kind === "breakpoint" ? "Breakpoint" : stop.kind === "target" ? "Target reached" : stop.kind === "limit"
        ? "Target not reached within 2,000,000 boundaries" : stop.kind === "step" ? "Step complete" : "Paused"} · PC $${hex(stop.location.address)} (${stop.location.space}).`
        : debug.request === "target" ? "Running to address…" : "");
      for (const status of root.querySelectorAll<HTMLElement>("[data-debugger-status]")) {
        if (status.textContent !== text) status.textContent = text;
      }
    },
  };
}
