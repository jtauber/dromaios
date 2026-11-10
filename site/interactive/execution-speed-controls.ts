import { createClockPacing } from "./clock-pacing.js";
import type { ExecutionPacing } from "./execution-controller.js";

/** Normal and Unlimited share pacing policy and presentation across laboratories. */
export function createExecutionSpeedControls(root: HTMLElement, options: {
  readonly clock: () => { readonly ticks: number; readonly hertz: number | undefined };
  readonly setPacing: (pacing: ExecutionPacing | undefined) => void;
  readonly changed: () => void;
}) {
  const hertz = options.clock().hertz;
  if (hertz === undefined) throw new Error("The machine chapter must declare its CPU clock frequency.");
  const pacing = createClockPacing({ ticks: () => options.clock().ticks, hertz, now: () => performance.now() });
  const buttons = root.querySelectorAll<HTMLButtonElement>("[data-machine-speed]");
  let normal = true;
  options.setPacing(pacing);
  for (const button of buttons) {
    button.title = button.dataset.machineSpeed === "normal"
      ? `Limit Run to ${hertz.toLocaleString()} CPU clocks per second; busy inspectors may make it slower.`
      : "Run as fast as the browser allows, yielding between batches.";
    button.addEventListener("click", () => {
      normal = button.dataset.machineSpeed === "normal";
      options.setPacing(normal ? pacing : undefined);
      options.changed();
    });
  }
  return {
    get normal() { return normal; },
    refresh(unavailable: boolean): void {
      for (const button of buttons) {
        button.disabled = unavailable;
        button.setAttribute("aria-pressed", String((button.dataset.machineSpeed === "normal") === normal));
      }
    },
  };
}
