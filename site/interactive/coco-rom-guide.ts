import { cocoMemorySupported } from "../../src/machines/6809/coco/memory.js";
import type { Coco } from "../../src/machines/6809/coco/runtime.js";
import { createRomNotes } from "./rom-guide.js";
import type { RomGuide, RomWalkthrough } from "./rom-guide.js";
import { createRomReference } from "./rom-reference.js";
import type { MemoryLabel } from "./rom-reference.js";
import type { Decoded6809 } from "./6809-disassembly.js";
import { address6809Operand } from "./6809-disassembly.js";

export type CocoRomGuides = Readonly<Record<"firmware" | "extended", RomGuide>>;

/** Exact ROM identities are enforced at loading; capture mapping with the inspected bytes. */
export function observeCocoRoms(machine: Coco) {
  const supported = cocoMemorySupported(machine), romMap = !(machine.ram.size === 0x10000 && machine.sam.allRam());
  const firmware = supported && machine.firmware.loaded && romMap, extended = supported && machine.extended.loaded && romMap;
  const vectors = supported && machine.firmware.loaded;
  const dos = supported && romMap && !machine.cartridge?.inserted() && (machine.dos?.loaded ?? false);
  return { firmware, extended, dos,
    mapped: (address: number) => extended && address >= 0x8000 && address < 0xa000
      || firmware && address >= 0xa000 && address < 0xc000
      || vectors && address >= 0xffe0
      || dos && address >= 0xc000 && address < 0xff00,
  };
}

export function cocoWalkthroughAvailable(tour: RomWalkthrough, guides: CocoRomGuides, mapping: ReturnType<typeof observeCocoRoms>): boolean {
  return mapping.firmware && (guides.extended.walkthroughs.includes(tour) ? mapping.extended : !mapping.extended);
}

/** Symbol lookup, byte-checked notes, and operand labels have no CPU bus connection. */
export function createCocoRomAnnotations(guides: CocoRomGuides) {
  const reference = createRomReference(Object.values(guides).flatMap(guide => guide.regions),
    Object.values(guides).flatMap(guide => guide.routines), Object.values(guides).flatMap(guide => guide.labels));
  const notes = createRomNotes(Object.values(guides).flatMap(guide => guide.notes));
  const owner = new Map(Object.entries(guides).flatMap(([socket, guide]) => [...guide.routines, ...guide.labels]
    .map(entry => [parseInt(entry.address, 16), socket as keyof CocoRomGuides] as const)));
  return {
    reference,
    observe(mapping: ReturnType<typeof observeCocoRoms>) {
      const label = (address: number) => {
        const socket = owner.get(address);
        const visible = socket && (mapping[socket] || socket === "firmware" && address >= 0xffe0 && mapping.mapped(address));
        return visible ? reference.at(address) : undefined;
      };
      return (row: Decoded6809, dp?: number) => {
        const address = address6809Operand(row, dp), exact = address === undefined ? undefined : label(address);
        const previous = address === undefined ? undefined : label(address - 1) as MemoryLabel | undefined;
        const operand = exact ?? (previous?.bytes === 2 ? previous : undefined);
        return {
          entry: mapping.mapped(row.address) ? label(row.address) : undefined,
          operand: address === undefined ? undefined : { address, label: operand,
            text: operand ? operand.name + (exact ? "" : "+1") : undefined },
          note: notes({ ...row, romMapped: mapping.mapped(row.address) }),
        };
      };
    },
  };
}
