import type { createApple2Session } from "./apple2-session.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { RomCheckpoint, RomGuide, RomWalkthrough } from "./rom-guide.js";
import { romCheckpointPosition } from "./rom-guide.js";
import { createRomWalkthrough } from "./rom-walkthrough-view.js";
import { dos33Catalogue, dos33FileSectors } from "./dos33-catalogue.js";
import { hasDos33Rwts } from "./dos33-reads.js";
import type { createDos33ReadTrace, LoadObservation } from "./dos33-reads.js";
import { hex } from "./apple2-explorer.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
type LoadCheckpoint = RomCheckpoint & { inspect: number; expect: LoadObservation };
type LoadTour = Omit<RomWalkthrough, "steps"> & { steps: readonly LoadCheckpoint[] };
const loadStep = (step: RomCheckpoint): step is LoadCheckpoint => "expect" in step;
const space = (step: RomCheckpoint) => parseInt(step.address, 16) < 0xc000 ? "ram" : "rom";

/** Enable the tour whose sector stops follow the mounted file's actual chain. */
function answerTour(image: readonly number[] | undefined, tours: readonly LoadTour[]): string | undefined {
  if (!image) return;
  try {
    const file = dos33Catalogue(image).files.find(file => file.name === "ANSWER" && file.type === "A");
    if (!file) return;
    const sectors = dos33FileSectors(image, file);
    if (file.count !== sectors.length - 1) return; // The catalogue sector belongs to the volume.
    for (const tour of tours) {
      const stops = tour.steps.flatMap(({ expect, inspect }) => "track" in expect ? [{ ...expect, inspect }] : []);
      if (stops.length === sectors.length && stops[0]!.inspect - stops[0]!.buffer === file.entry % 256
        && stops.every((s, i) => s.track * 16 + s.sector === sectors[i]!.index)) return tour.id;
    }
  } catch { /* Other disk formats and damaged catalogues have no ANSWER tour. */ }
}

export function createApple2Walkthrough(root: HTMLElement, guide: RomGuide, machine: () => Machine | undefined,
  trace: ReturnType<typeof createDos33ReadTrace> | undefined, actions: {
    runTo(address: string, space: string, when?: () => boolean): void;
    browse(tool: "code" | "memory" | "rom", address: number): void;
  }) {
  const source = root.querySelector("[data-load-walkthroughs]");
  const tours: LoadTour[] = source ? JSON.parse(source.textContent!) : [];
  let lastImage: readonly number[] | undefined, diskTour: string | undefined;
  return createRomWalkthrough(root, { routines: guide.routines, walkthroughs: [...guide.walkthroughs, ...tours] }, {
    available(tour) {
      if (!tour.id.startsWith("answer-")) return true;
      const selected = machine(), image = selected?.disk.inspectMedium()?.snapshot();
      if (image !== lastImage) { lastImage = image; diskTour = answerTour(image, tours); }
      return !!trace && !!selected && diskTour === tour.id && hasDos33Rwts(selected);
    },
    runTo(address, step) {
      if (loadStep(step)) actions.runTo(address, space(step), () => trace!.matches(step.expect));
      else actions.runTo(address, "rom");
    },
    browse: address => actions.browse("code", address),
    reference: address => actions.browse("rom", address),
    inspect: step => loadStep(step) ? { label: `Inspect RAM $${hex(step.inspect)}`, show: () => actions.browse("memory", step.inspect) } : undefined,
    position(step, location: DebugLocation | undefined, available, running) {
      if (!loadStep(step)) return romCheckpointPosition(step, location, available, running);
      if (!available || !location) return "Boot the matching ANSWER disk and pause at the Applesoft prompt to start this tour.";
      if (running) return `Running to ${step.title} at $${step.address}.`;
      if (location.address === parseInt(step.address, 16) && location.space === space(step) && trace?.matches(step.expect)) {
        return `At checkpoint · ${step.title} ($${step.address}).`;
      }
      return `Paused at $${hex(location.address)} (${location.space}) · waiting for ${step.title}.`;
    },
  });
}
