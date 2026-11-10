import type { create6809Coco } from "../../generated/6809/coco.ts";
import { characterRows } from "../../../components/devices/mc6847-character-set.ts";
import { advanceCocoSync, clocksUntilCocoSync } from "./timing.ts";

export type Coco = ReturnType<typeof create6809Coco>;
export type CocoSnapshot = ReturnType<Coco["snapshot"]>;

/** One timed CPU boundary, or an idle interval ending at the next video sync edge. */
export function stepCoco(machine: Coco) {
  requireExecutionProfile(machine);
  const start = machine.clock.ticks;
  const motor = machine.pias.cassetteMotor, output = machine.pias.cassetteOutput;
  const record = cpuBoundary(machine.pias, machine.step, machine.interrupt);
  // Entering a wait pays the instruction cost first. Subsequent waiting boundaries
  // advance the board without inventing an instruction or repeating its CPU cost.
  const idleClocks = record.outcome === "waiting" && record.clocks === 0 ? clocksUntilCocoSync(machine) : 0;
  machine.clock.advance(idleClocks);
  machine.pias.cassette.advance(machine.clock.ticks - start, machine.clock.hertz!, motor, output);
  advanceCocoSync(machine, start);
  return { ...record, idleClocks };
}

/** Untimed arbitration for an isolated preview CPU; never advance the live board. */
export function stepCocoCpu(machine: Pick<Coco, "cpu" | "pias" | "sam">) {
  requireExecutionProfile(machine);
  return cpuBoundary(machine.pias, () => machine.cpu.step(), source => machine.cpu.interrupt(source));
}

function cpuBoundary<Instruction, Interrupt extends { readonly outcome: string }>(
  pias: Coco["pias"], step: () => Instruction, interrupt: (source: "firq" | "irq") => Interrupt,
): Instruction | Interrupt {
  for (const source of ["firq", "irq"] as const) {
    if (!pias[source]) continue;
    const record = interrupt(source);
    if (record.outcome !== "ignored") return record;
  }
  return step();
}

function requireExecutionProfile(machine: Pick<Coco, "sam">): void {
  requireMemoryProfile(machine);
  if (machine.sam.clockMode() !== 0) throw new RangeError("Unsupported CoCo clock configuration: requires normal speed (SAM R=00).");
}

function requireMemoryProfile({ sam }: Pick<Coco, "sam">): void {
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
