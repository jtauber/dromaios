import type { DebugLocation } from "./instruction-debugger.js";
import type { RomGuide, RomWalkthrough } from "./rom-guide.js";
import { romCheckpointPosition } from "./rom-guide.js";

/** Reading and selecting checkpoints is independent of execution; only Run requests the existing debugger. */
export function createRomWalkthrough(root: HTMLElement, guide: Pick<RomGuide, "routines" | "walkthroughs">, actions: {
  readonly runTo: (address: string) => void;
  readonly browse: (address: number) => void;
  readonly reference: (address: number) => void;
  readonly available?: (tour: RomWalkthrough) => boolean;
}) {
  const panel = root.querySelector<HTMLElement>("[data-rom-walkthrough]");
  if (!panel) return undefined;
  const element = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-walkthrough-${name}]`)!;
  const choice = element<HTMLSelectElement>("choice"), checkpoints = element<HTMLSelectElement>("checkpoints");
  const previous = element<HTMLButtonElement>("previous"), next = element<HTMLButtonElement>("next"), run = element<HTMLButtonElement>("run");
  const position = element("position");
  let available = false, running = false, location: DebugLocation | undefined;
  const selected = () => guide.walkthroughs[choice.selectedIndex]!;
  const checkpoint = () => selected().steps[checkpoints.selectedIndex]!;
  for (const tour of guide.walkthroughs) choice.add(new Option(tour.title, tour.id));
  function showPosition(): void {
    const enabled = available && (actions.available?.(selected()) ?? true);
    run.disabled = !enabled || running;
    position.setAttribute("aria-live", running ? "off" : "polite");
    const text = romCheckpointPosition(checkpoint(), location, enabled, running);
    if (position.textContent !== text) position.textContent = text;
  }
  function showCheckpoint(): void {
    const step = checkpoint();
    element("heading").textContent = `${checkpoints.selectedIndex + 1}. ${step.title} · $${step.address}`;
    element("prepare").textContent = step.prepare; element("observe").textContent = step.observe;
    previous.disabled = checkpoints.selectedIndex === 0; next.disabled = checkpoints.selectedIndex === selected().steps.length - 1;
    showPosition();
  }
  function showTour(): void {
    element("setup").textContent = selected().setup;
    checkpoints.replaceChildren();
    selected().steps.forEach((step, index) => checkpoints.add(new Option(`${index + 1}. ${step.title} · $${step.address}`, String(index))));
    showCheckpoint();
  }
  choice.addEventListener("change", showTour); checkpoints.addEventListener("change", showCheckpoint);
  previous.addEventListener("click", () => { checkpoints.selectedIndex--; showCheckpoint(); });
  next.addEventListener("click", () => { checkpoints.selectedIndex++; showCheckpoint(); });
  run.addEventListener("click", () => { if (!run.disabled) actions.runTo(checkpoint().address); });
  element<HTMLButtonElement>("browse").addEventListener("click", () => actions.browse(parseInt(checkpoint().address, 16)));
  element<HTMLButtonElement>("reference").addEventListener("click", () => {
    const routine = guide.routines.find(routine => routine.name === checkpoint().routine)!;
    actions.reference(parseInt(routine.address, 16));
  });
  showTour();
  return {
    refresh(current: DebugLocation | undefined, canRun: boolean, active: boolean): void {
      location = current; available = canRun; running = active; showPosition();
    },
  };
}
