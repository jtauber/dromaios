import type { DebugLocation } from "./instruction-debugger.js";
import type { RomCheckpoint, RomGuide, RomWalkthrough } from "./rom-guide.js";
import { romCheckpointPosition } from "./rom-guide.js";

/** Reading and selecting checkpoints is independent of execution; only Run requests the existing debugger. */
export function createRomWalkthrough(root: HTMLElement, guide: Pick<RomGuide, "routines" | "walkthroughs">, actions: {
  readonly runTo: (address: string, checkpoint: RomCheckpoint) => void;
  readonly browse: (address: number, checkpoint: RomCheckpoint) => void;
  readonly reference: (address: number) => void;
  readonly inspect?: (step: RomCheckpoint) => readonly {
    readonly label: string; readonly show: () => void; readonly available?: () => boolean;
  }[];
  readonly available?: (tour: RomWalkthrough) => boolean;
  readonly position?: typeof romCheckpointPosition;
}) {
  const panel = root.querySelector<HTMLElement>("[data-rom-walkthrough]");
  if (!panel) return undefined;
  const element = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-walkthrough-${name}]`)!;
  const choice = element<HTMLSelectElement>("choice"), checkpoints = element<HTMLSelectElement>("checkpoints");
  const previous = element<HTMLButtonElement>("previous"), next = element<HTMLButtonElement>("next"), run = element<HTMLButtonElement>("run");
  const position = element("position");
  const reference = element<HTMLButtonElement>("reference"), referenceLabel = reference.textContent;
  const referenceText = panel.querySelector<HTMLElement>("[data-walkthrough-reference-text]");
  const inspections = document.createElement("div");
  inspections.className = "basic-controls"; inspections.dataset.walkthroughInspections = "";
  reference.parentElement!.after(inspections);
  let inspectionControls: { button: HTMLButtonElement; available?: () => boolean }[] = [];
  let available = false, running = false, location: DebugLocation | undefined;
  const selected = () => guide.walkthroughs[choice.selectedIndex]!;
  const checkpoint = () => selected().steps[checkpoints.selectedIndex]!;
  for (const tour of guide.walkthroughs) choice.add(new Option(tour.title, tour.id));
  function showPosition(): void {
    const enabled = available && (actions.available?.(selected()) ?? true);
    run.disabled = !enabled || running;
    for (const { button, available } of inspectionControls) button.disabled = !(available?.() ?? true);
    position.setAttribute("aria-live", running ? "off" : "polite");
    const text = (actions.position ?? romCheckpointPosition)(checkpoint(), location, enabled, running);
    if (position.textContent !== text) position.textContent = text;
  }
  function showCheckpoint(): void {
    const step = checkpoint();
    reference.hidden = !step.routine;
    reference.textContent = referenceLabel;
    reference.onclick = () => {
      const routine = guide.routines.find(routine => routine.name === step.routine);
      if (routine) actions.reference(parseInt(routine.address, 16));
    };
    inspections.replaceChildren(); inspectionControls = [];
    for (const inspection of actions.inspect?.(step) ?? []) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = inspection.label;
      button.addEventListener("click", () => { if (inspection.available?.() ?? true) inspection.show(); });
      inspections.append(button); inspectionControls.push({ button, available: inspection.available });
    }
    inspections.hidden = !inspectionControls.length;
    if (referenceText) referenceText.textContent = "";
    element("heading").textContent = `${checkpoints.selectedIndex + 1}. ${step.title} · ${step.execution ?? "$" + step.address}`;
    element("prepare").textContent = step.prepare; element("observe").textContent = step.observe;
    previous.disabled = checkpoints.selectedIndex === 0; next.disabled = checkpoints.selectedIndex === selected().steps.length - 1;
    showPosition();
  }
  function showTour(): void {
    element("setup").textContent = selected().setup;
    checkpoints.replaceChildren();
    selected().steps.forEach((step, index) => checkpoints.add(new Option(`${index + 1}. ${step.title} · ${step.execution ?? "$" + step.address}`, String(index))));
    showCheckpoint();
  }
  choice.addEventListener("change", showTour); checkpoints.addEventListener("change", showCheckpoint);
  previous.addEventListener("click", () => { checkpoints.selectedIndex--; showCheckpoint(); });
  next.addEventListener("click", () => { checkpoints.selectedIndex++; showCheckpoint(); });
  run.addEventListener("click", () => {
    const step = checkpoint();
    if (!run.disabled) actions.runTo(step.execution ?? step.address, step);
  });
  element<HTMLButtonElement>("browse").addEventListener("click", () => {
    const step = checkpoint(); actions.browse(parseInt(step.address, 16), step);
  });
  showTour();
  return {
    refresh(current: DebugLocation | undefined, canRun: boolean, active: boolean): void {
      location = current; available = canRun; running = active; showPosition();
    },
  };
}
