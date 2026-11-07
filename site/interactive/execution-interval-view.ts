import { createExecutionIntervals, executionIntervalText } from "./execution-intervals.js";
import type { DebugStop } from "./instruction-debugger.js";

/** Render measurements at host refresh boundaries, never in the CPU's instruction loop. */
export function createExecutionIntervalView(root: HTMLElement, clock: () => { readonly ticks: number }) {
  const element = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-clock-${name}]`)!;
  const mark = element<HTMLButtonElement>("mark"), clear = element<HTMLButtonElement>("clear");
  const elapsed = element<HTMLElement>("elapsed"), interval = element<HTMLElement>("interval");
  const measurements = createExecutionIntervals(clock);
  let running = false, unavailable = true, stop: DebugStop["kind"] | undefined;
  function render(): void {
    const values = measurements.update(running, stop);
    mark.disabled = running || unavailable;
    clear.disabled = running || unavailable || values.marker === undefined;
    elapsed.textContent = values.marker ? `Since marker: ${values.marker.clocks.toLocaleString()} CPU clocks` : "No clock marker.";
    elapsed.title = values.marker ? `Marked at ${values.marker.at.toLocaleString()} CPU clocks` : "";
    interval.hidden = values.interval === undefined;
    interval.textContent = values.interval ? executionIntervalText(values.interval) : "";
    for (const output of [elapsed, interval]) output.setAttribute("aria-live", running ? "off" : "polite");
  }
  mark.addEventListener("click", () => { if (!mark.disabled) { measurements.mark(); render(); } });
  clear.addEventListener("click", () => { if (!clear.disabled) { measurements.clearMarker(); render(); } });
  return {
    begin: measurements.begin,
    clearStep: measurements.clearStep,
    refresh(state: { running: boolean; unavailable: boolean; stop?: DebugStop["kind"] }): void {
      running = state.running; unavailable = state.unavailable; stop = state.stop; render();
    },
  };
}
