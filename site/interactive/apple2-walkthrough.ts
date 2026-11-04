import type { createApple2Session } from "./apple2-session.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { RomCheckpoint, RomGuide, RomWalkthrough } from "./rom-guide.js";
import { romCheckpointPosition } from "./rom-guide.js";
import { createRomWalkthrough } from "./rom-walkthrough-view.js";
import { dos33BasicLength, dos33BinaryHeader, dos33Catalogue, dos33FileSectors, sectorLabel } from "./dos33-catalogue.js";
import { hasDos33Rwts } from "./dos33-reads.js";
import type { createDos33ReadTrace, LoadObservation } from "./dos33-reads.js";
import { hex } from "./apple2-explorer.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
type LoadCheckpoint = RomCheckpoint & { inspect: number; expect: LoadObservation; space?: "rom" | "lc-upper" | "device"; limit?: number };
type LoadTour = Omit<RomWalkthrough, "steps"> & {
  fromPowerOn?: boolean;
  steps: readonly LoadCheckpoint[];
} & ({ bootBytes: readonly (readonly [offset: number, bytes: readonly number[]])[] } | {
  file: { name: string; type: "A" } | { name: string; type: "B"; address: number; length: number }
    | { name: string; type: "I"; entry: number; length: number };
});
const loadStep = (step: RomCheckpoint): step is LoadCheckpoint => "expect" in step;
const space = (step: LoadCheckpoint) => step.space ?? (parseInt(step.address, 16) < 0xc000 ? "ram" : "rom");

/** Check the boot bytes or DOS file layout the selected tour depends on. */
function matchesDisk(image: readonly number[], tour: LoadTour): boolean {
  if ("bootBytes" in tour) return tour.bootBytes.every(([offset, bytes]) => bytes.every((byte, i) => byte === image[offset + i]));
  try {
    const file = dos33Catalogue(image).files.find(f => f.name === tour.file.name && f.type === tour.file.type);
    if (!file) return false;
    const sectors = dos33FileSectors(image, file);
    if (file.count !== sectors.length - 1) return false; // The catalogue sector belongs to the volume.
    if (tour.file.type !== "A") {
      const data = sectors.filter(s => s.fileSector !== undefined), first = data[0];
      const headerSize = tour.file.type === "B" ? 4 : 2;
      if (!first || data.length !== Math.ceil((headerSize + tour.file.length) / 256)
        || !data.every((s, i) => s.fileSector === i)) return false;
      if (tour.file.type === "I") return file.entry === tour.file.entry && dos33BasicLength(image, first.index) === tour.file.length;
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
    runTo(address: string, space: string, when?: () => boolean, limit?: number): void;
    browse(tool: "code" | "memory" | "rom", address: number): void;
    inspectPixel(x: number, y: number): void;
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
      return !!trace && !!selected && enabled.get(load)! && (load.fromPowerOn ? selected.disk.inspect().installed : hasDos33Rwts(selected));
    },
    runTo(address, step) {
      if (loadStep(step)) actions.runTo(address, space(step), () => trace!.matches(step.expect), step.limit);
      else actions.runTo(address, "rom");
    },
    browse: address => actions.browse("code", address),
    reference: address => actions.browse("rom", address),
    inspect(step) {
      if (!loadStep(step)) return undefined;
      if ("loresPixel" in step.expect) {
        const [x, y] = step.expect.loresPixel;
        return { label: `Inspect pixel (${x},${y})`, show: () => actions.inspectPixel(x, y) };
      }
      return { label: `Inspect ${step.inspect >= 0xd000 ? "mapped memory" : "RAM"} $${hex(step.inspect)}`, show: () => actions.browse("memory", step.inspect) };
    },
    position(step, location: DebugLocation | undefined, available, running) {
      if (!loadStep(step)) return romCheckpointPosition(step, location, available, running);
      if (!available || !location) return "Insert the disk specified in the walkthrough setup.";
      if (running) return `Running to ${step.title} at $${step.address}.`;
      if (location.address === parseInt(step.address, 16) && location.space === space(step) && trace?.matches(step.expect)) {
        const hit = `At checkpoint · ${step.title} ($${step.address}).`;
        if ("bootSectors" in step.expect) {
          const { firstSector, bootSectors } = step.expect;
          const range = bootSectors === 1 ? sectorLabel(firstSector) : `${sectorLabel(firstSector)} through ${sectorLabel(firstSector + bootSectors - 1)}`;
          return `${hit} All ${(256 * bootSectors).toLocaleString("en-US")} bytes match ${range}.`;
        }
        if ("bank" in step.expect) {
          const offset = step.expect.address - 0xd000, selected = machine()!;
          const rom = selected.firmware.read(offset), byte = selected[step.expect.bank].read(offset);
          return `${hit} At $${hex(step.expect.address)} · bank ${step.expect.bank === "bank2" ? 2 : 1} $${hex(byte, 2)} · ROM $${typeof rom === "number" ? hex(rom, 2) : "??"}.`;
        }
        return hit;
      }
      return `Paused at $${hex(location.address)} (${location.space}) · waiting for ${step.title}.`;
    },
  });
}
