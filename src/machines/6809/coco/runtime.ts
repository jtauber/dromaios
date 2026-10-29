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

export type CocoDisplayMode = { readonly kind: "text" } | {
  readonly kind: "bitmap";
  readonly width: number;
  readonly height: number;
  readonly bitsPerPixel: number;
};

/** Decode the VDG geometry and require the matching SAM address sequence. */
export function cocoDisplayMode(machine: Coco): CocoDisplayMode {
  requireMemoryProfile(machine);
  const { sam, vdg } = machine, pins = machine.pias.videoPins;
  if (vdg.alphaMode(pins)) {
    if (sam.videoMode() === 0 && vdg.internalText(pins)) return { kind: "text" };
  } else {
    const width = vdg.graphicsWidth(pins), height = vdg.graphicsHeight(pins), bitsPerPixel = vdg.graphicsBitsPerPixel(pins);
    if (sam.displayBytesPerRow() === width * bitsPerPixel / 8 && sam.displayLinesPerRow() === 192 / height) {
      return { kind: "bitmap", width, height, bitsPerPixel };
    }
  }
  throw new RangeError(`Unsupported CoCo display configuration: SAM V=${sam.videoMode().toString(2).padStart(3, "0")}, VDG pins=$${pins.toString(16).toUpperCase().padStart(2, "0")}.`);
}

/** Capture the active raster from physical RAM; never perform CPU-bus or PIA reads. */
export function renderCocoFrame(machine: Coco): Uint8Array {
  const mode = cocoDisplayMode(machine), pixels = new Uint8Array(256 * 192);
  if (mode.kind === "text") renderText(machine, pixels);
  else renderBitmap(machine, mode, pixels);
  return pixels;
}

function renderText(machine: Coco, pixels: Uint8Array): void {
  const { ram, sam, vdg } = machine, pins = machine.pias.videoPins;
  for (let row = 0; row < 16; row++) for (let column = 0; column < 32; column++) {
    const byte = ram.read(sam.displayAddress(row, column));
    const semigraphics = vdg.semigraphics(byte), glyph = vdg.glyph(byte);
    const foreground = vdg.foreground(byte, pins), background = vdg.background(byte, pins);
    for (let line = 0; line < 12; line++) {
      const dots = semigraphics ? vdg.semigraphicsPixels(byte, line)
        : vdg.textPixels(byte, characterRows[glyph * 12 + line]!);
      const start = (row * 12 + line) * 256 + column * 8;
      for (let x = 0; x < 8; x++) pixels[start + x] = dots & (0x80 >> x) ? foreground : background;
    }
  }
}

function renderBitmap(machine: Coco, mode: Extract<CocoDisplayMode, { kind: "bitmap" }>, pixels: Uint8Array): void {
  const { ram, sam, vdg } = machine, pins = machine.pias.videoPins;
  const pixelWidth = 256 / mode.width, pixelHeight = 192 / mode.height, pixelsPerByte = 8 / mode.bitsPerPixel;
  for (let row = 0; row < mode.height; row++) {
    const start = row * pixelHeight * 256;
    for (let column = 0; column < sam.displayBytesPerRow(); column++) {
      const byte = ram.read(sam.displayAddress(row, column));
      for (let pixel = 0; pixel < pixelsPerByte; pixel++) {
        const x = (column * pixelsPerByte + pixel) * pixelWidth;
        pixels.fill(vdg.graphicsColour(byte, pixel, pins), start + x, start + x + pixelWidth);
      }
    }
    // A SAM byte row persists for several raster lines in the lower-resolution modes.
    for (let line = 1; line < pixelHeight; line++) pixels.copyWithin(start + line * 256, start, start + 256);
  }
}
