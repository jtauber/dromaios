import type { create6809Coco } from "../../generated/6809/coco.ts";
import { characterRows } from "../../../components/devices/mc6847-character-set.ts";

export type Coco = ReturnType<typeof create6809Coco>;
export type CocoSnapshot = ReturnType<Coco["snapshot"]>;

/** One CPU boundary, with current board interrupt levels rather than queued host requests. */
export function stepCoco(machine: Coco) {
  requireMemoryProfile(machine);
  for (const source of ["firq", "irq"] as const) {
    if (!machine.pias[source]) continue;
    const record = machine.cpu.interrupt(source);
    if (record.outcome !== "ignored") return record;
  }
  return machine.cpu.step();
}

function requireMemoryProfile({ sam }: Coco): void {
  if (!sam.supportedMemory()) throw new RangeError("Unsupported CoCo memory configuration: requires the normal 32 KiB profile.");
}

/** Capture the active raster from physical RAM; never perform CPU-bus or PIA reads. */
export function renderCocoFrame(machine: Coco): Uint8Array {
  requireMemoryProfile(machine);
  const { ram, sam, vdg } = machine, pins = machine.pias.videoPins;
  if (sam.videoMode() !== 0 || !vdg.alphaMode(pins)) {
    throw new RangeError("Unsupported CoCo display configuration: requires SAM V=000 and VDG A/G=0.");
  }
  const pixels = new Uint8Array(256 * 192);
  for (let row = 0; row < 16; row++) for (let column = 0; column < 32; column++) {
    const byte = ram.read(sam.textAddress(row, column));
    const semigraphics = vdg.semigraphics(byte), glyph = vdg.glyph(byte);
    const foreground = vdg.foreground(byte, pins), background = vdg.background(byte, pins);
    for (let line = 0; line < 12; line++) {
      const dots = semigraphics ? vdg.semigraphicsPixels(byte, line)
        : vdg.textPixels(byte, characterRows[glyph * 12 + line]!);
      const start = (row * 12 + line) * 256 + column * 8;
      for (let x = 0; x < 8; x++) pixels[start + x] = dots & (0x80 >> x) ? foreground : background;
    }
  }
  return pixels;
}
