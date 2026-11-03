import type { createApple2Session } from "./apple2-session.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { RomCheckpoint, RomGuide, RomWalkthrough } from "./rom-guide.js";
import { romCheckpointPosition } from "./rom-guide.js";
import { createRomWalkthrough } from "./rom-walkthrough-view.js";
import { dos33BinaryHeader, dos33Catalogue, dos33FileSectors } from "./dos33-catalogue.js";
import { hasDos33Rwts } from "./dos33-reads.js";
import type { createDos33ReadTrace, LoadObservation } from "./dos33-reads.js";
import { hex } from "./apple2-explorer.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
type LoadCheckpoint = RomCheckpoint & { inspect: number; expect: LoadObservation };
type LoadTour = Omit<RomWalkthrough, "steps"> & {
  file: { name: string; type: "A" } | { name: string; type: "B"; address: number; length: number };
  steps: readonly LoadCheckpoint[];
};
const loadStep = (step: RomCheckpoint): step is LoadCheckpoint => "expect" in step;
const space = (step: RomCheckpoint) => parseInt(step.address, 16) < 0xc000 ? "ram" : "rom";

/** A sector tour follows the pinned file chain. A binary tour follows the header's destination wherever DOS allocated the file. */
function matchesDisk(image: readonly number[], tour: LoadTour): boolean {
  try {
    const file = dos33Catalogue(image).files.find(f => f.name === tour.file.name && f.type === tour.file.type);
    if (!file) return false;
    const sectors = dos33FileSectors(image, file);
    if (file.count !== sectors.length - 1) return false; // The catalogue sector belongs to the volume.
    if (tour.file.type === "B") {
      const first = sectors.find(s => s.fileSector === 0);
      if (!first || !sectors.some(s => s.fileSector === 1)) return false;
      const header = dos33BinaryHeader(image, first.index);
      return header.address === tour.file.address && header.length === tour.file.length;
    }
    const stops = tour.steps.flatMap(({ expect, inspect }) => "track" in expect ? [{ ...expect, inspect }] : []);
    return stops.length === sectors.length && stops[0]!.inspect - stops[0]!.buffer === file.entry % 256
      && stops.every((s, i) => s.track * 16 + s.sector === sectors[i]!.index);
  } catch { return false; } // Other disk formats and damaged catalogues have no matching tour.
}

export function createApple2Walkthrough(root: HTMLElement, guide: RomGuide, machine: () => Machine | undefined,
  trace: ReturnType<typeof createDos33ReadTrace> | undefined, actions: {
    runTo(address: string, space: string, when?: () => boolean): void;
    browse(tool: "code" | "memory" | "rom", address: number): void;
  }) {
  const source = root.querySelector("[data-load-walkthroughs]");
  const tours: LoadTour[] = source ? JSON.parse(source.textContent!) : [];
  let lastImage: readonly number[] | undefined;
  const enabled = new Map<LoadTour, boolean>();
  return createRomWalkthrough(root, { routines: guide.routines, walkthroughs: [...guide.walkthroughs, ...tours] }, {
    available(tour) {
      const load = tours.find(t => t === tour);
      if (!load) return true;
      const selected = machine(), image = selected?.disk.inspectMedium()?.snapshot();
      if (image !== lastImage) { lastImage = image; enabled.clear(); }
      if (!enabled.has(load)) enabled.set(load, !!image && matchesDisk(image, load));
      return !!trace && !!selected && enabled.get(load)! && hasDos33Rwts(selected);
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
      if (!available || !location) return "Boot the disk specified by this tour and pause at the Applesoft prompt to start this tour.";
      if (running) return `Running to ${step.title} at $${step.address}.`;
      if (location.address === parseInt(step.address, 16) && location.space === space(step) && trace?.matches(step.expect)) {
        return `At checkpoint · ${step.title} ($${step.address}).`;
      }
      return `Paused at $${hex(location.address)} (${location.space}) · waiting for ${step.title}.`;
    },
  });
}
