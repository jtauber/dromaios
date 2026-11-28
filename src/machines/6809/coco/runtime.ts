import type { create6809Coco } from "../../generated/6809/coco.ts";
import type { create6809Coco64 } from "../../generated/6809/coco64.ts";
import type { create6809CocoDisk } from "../../generated/6809/coco-disk.ts";
import { characterRows } from "../../../components/devices/mc6847-character-set.ts";
import { advanceCocoSync, ticksUntilCocoSync } from "./timing.ts";
import type { Cpu6809TimedStepRecord } from "../../../components/cpus/generated/6809-cpu.ts";
import { cocoMemorySupported, cocoDisplayAddress } from "./memory.ts";

export type Coco = (ReturnType<typeof create6809Coco> & { readonly disk?: undefined; readonly dos?: undefined; readonly cartridge?: undefined })
  | ReturnType<typeof create6809CocoDisk> | ReturnType<typeof create6809Coco64>;
export type CocoSnapshot = ReturnType<Coco["snapshot"]>;

/** One timed CPU boundary, or an idle interval ending at the next board event. */
export function stepCoco(machine: Coco) {
  requireMemoryProfile(machine);
  const start = machine.clock.ticks;
  const rate = machine.sam.clockMode();
  const motor = machine.pias.cassetteMotor, output = machine.pias.cassetteOutput;
  const disk = machine.cartridge?.inserted() ? undefined : machine.disk;
  const halted = disk?.halted;
  const execute = () => {
    if (halted) return haltedBoundary(machine);
    const nmi = disk?.takeNmi() ? machine.interrupt("nmi") : undefined;
    return nmi && nmi.outcome !== "ignored" ? nmi
      : cpuBoundary(machine.pias, machine.step, machine.interrupt);
  };
  const record = disk ? disk.cpuBoundary(execute) : execute();
  // One board tick is a fast E period. Internal cycles present $FFFF; the CPU
  // record supplies real bus transfers but not dummy reads or switch stretching.
  let elapsedTicks = (record.clocks - record.accesses.length) * machine.sam.cycleTicks(rate, 0xffff);
  for (const access of record.accesses) elapsedTicks += machine.sam.cycleTicks(rate, access.address);
  machine.clock.advance(elapsedTicks);
  // Entering a wait pays the instruction cost first. Subsequent waiting boundaries
  // advance the board without inventing an instruction or repeating its CPU cost.
  const idleTicks = record.outcome === "waiting" && record.clocks === 0
    ? Math.min(ticksUntilCocoSync(machine), disk?.ticksUntilEvent() ?? Infinity) : 0;
  machine.clock.advance(idleTicks);
  machine.pias.cassette.advance(machine.clock.ticks - start, machine.clock.hertz!, motor, output);
  disk?.advanceBoardTicks(machine.clock.ticks - start);
  advanceCocoSync(machine, start);
  // A ROM Pak ties CART to Q. At each complete boundary, its selected edge
  // has occurred; PIA1 CB1 latches it until acknowledged. Q finishes high.
  if (machine.cartridge?.inserted() && machine.clock.ticks > start) {
    machine.pias.setCartridgeLine(false); machine.pias.setCartridgeLine(true);
  }
  return { ...record, idleTicks, elapsedTicks: machine.clock.ticks - start };
}

/** Cartridge HALT leaves CPU state unchanged; only board time advances. */
function haltedBoundary(machine: Coco): Cpu6809TimedStepRecord {
  const before = machine.cpu.snapshot();
  return { outcome: "waiting", before, after: machine.cpu.snapshot(), instruction: null, accesses: [], clocks: 0 };
}

/** Untimed arbitration for an isolated preview CPU; never advance the live board. */
export function stepCocoCpu(machine: Pick<Coco, "cpu" | "pias" | "sam" | "ram">) {
  requireMemoryProfile(machine);
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

function requireMemoryProfile(machine: Pick<Coco, "sam" | "ram">): void {
  if (!cocoMemorySupported(machine)) throw new RangeError(`Unsupported CoCo memory configuration for ${machine.ram.size / 1024} KiB RAM.`);
}

export type CocoDisplayMode = { readonly kind: "text" } | {
  readonly kind: "semigraphics";
  readonly height: number;
} | {
  readonly kind: "bitmap";
  readonly width: number;
  readonly height: number;
  readonly bitsPerPixel: number;
};

/** Decode the VDG geometry when the SAM supplies the matching address sequence. */
function decodeDisplayMode(machine: Coco): CocoDisplayMode | undefined {
  const { sam, vdg } = machine, pins = machine.pias.videoPins;
  if (vdg.alphaMode(pins)) {
    if (sam.displayBytesPerRow() === 32 && vdg.internalText(pins)) {
      return sam.videoMode() === 0 ? { kind: "text" }
        : { kind: "semigraphics", height: 192 / sam.displayLinesPerRow() };
    }
  } else {
    const width = vdg.graphicsWidth(pins), height = vdg.graphicsHeight(pins), bitsPerPixel = vdg.graphicsBitsPerPixel(pins);
    if (sam.displayBytesPerRow() === width * bitsPerPixel / 8 && sam.displayLinesPerRow() === 192 / height) {
      return { kind: "bitmap", width, height, bitsPerPixel };
    }
  }
}

export function cocoDisplayMode(machine: Coco): CocoDisplayMode {
  requireMemoryProfile(machine);
  const mode = decodeDisplayMode(machine);
  if (mode) return mode;
  const { sam, pias } = machine;
  throw new RangeError(`Unsupported CoCo display configuration: SAM V=${sam.videoMode().toString(2).padStart(3, "0")}, VDG pins=$${pias.videoPins.toString(16).toUpperCase().padStart(2, "0")}.`);
}

/** Display interpretation only; it is not retained in the machine snapshot. */
export type CocoVideoSignal = "direct" | "composite" | "composite-reversed";

export type CocoPixel = { address: number; byte: number; colour: number } & (
  | { bit: number; bitsPerPixel: number }
  | { blockBit: number; foreground: number }
  | { glyph: number; glyphRow: number }
);

/** Map a raster dot to its physical screen byte and the VDG's interpretation of that byte. */
export function inspectCocoPixel(machine: Coco, x: number, y: number, signal: CocoVideoSignal = "direct"): CocoPixel | undefined {
  if (!Number.isInteger(x) || x < 0 || x >= 256 || !Number.isInteger(y) || y < 0 || y >= 192) return;
  const mode = cocoMemorySupported(machine) ? decodeDisplayMode(machine) : undefined;
  if (!mode) return;
  if (mode.kind !== "bitmap") return inspectCharacterCell(machine, x, y);
  const pixel = Math.floor(x * mode.width / 256), row = Math.floor(y * mode.height / 192);
  const bitsPerPixel = mode.bitsPerPixel, pixelsPerByte = 8 / bitsPerPixel;
  const address = cocoDisplayAddress(machine, row, Math.floor(pixel / pixelsPerByte));
  const byte = machine.ram.read(address), index = pixel % pixelsPerByte;
  const bit = 8 - (index + 1) * bitsPerPixel; // Low bit of the field; pixels are packed left to right, MSB first.
  const palette = bitmapPalette(machine, signal);
  return { address, bit, bitsPerPixel, byte, colour: palette.at(byte, palette.paired ? index >> 1 : index) };
}

function inspectCharacterCell(machine: Coco, x: number, y: number): CocoPixel {
  const { vdg, ram, pias } = machine, row = y % 12, column = x % 8;
  // The SAM can fetch a new byte row while the VDG continues its twelve-line character scan.
  const address = cocoDisplayAddress(machine, Math.floor(y / machine.sam.displayLinesPerRow()), Math.floor(x / 8));
  const byte = ram.read(address), pins = pias.videoPins;
  const foreground = vdg.foreground(byte, pins), background = vdg.background(byte, pins);
  if (vdg.semigraphics(byte)) {
    const blockBit = (row < 6 ? 3 : 1) - Math.floor(column / 4);
    const colour = byte & (1 << blockBit) ? foreground : background;
    return { address, byte, blockBit, foreground, colour };
  }
  const glyph = vdg.glyph(byte), dots = vdg.textPixels(byte, characterRows[glyph * 12 + row]!);
  return { address, byte, glyph, glyphRow: row, colour: dots & (0x80 >> column) ? foreground : background };
}

/** Capture the active raster from physical RAM; never perform CPU-bus or PIA reads. */
export function renderCocoFrame(machine: Coco, signal: CocoVideoSignal = "direct"): Uint8Array {
  const mode = cocoDisplayMode(machine), pixels = new Uint8Array(256 * 192);
  if (mode.kind === "bitmap") renderBitmap(machine, mode, pixels, signal);
  else renderAlpha(machine, pixels);
  return pixels;
}

function renderAlpha(machine: Coco, pixels: Uint8Array): void {
  const { ram, sam, vdg } = machine, pins = machine.pias.videoPins;
  const linesPerRow = sam.displayLinesPerRow();
  for (let row = 0; row < 192 / linesPerRow; row++) for (let column = 0; column < 32; column++) {
    const byte = ram.read(cocoDisplayAddress(machine, row, column));
    const semigraphics = vdg.semigraphics(byte), glyph = vdg.glyph(byte);
    const foreground = vdg.foreground(byte, pins), background = vdg.background(byte, pins);
    for (let line = 0; line < linesPerRow; line++) {
      const y = row * linesPerRow + line;
      // SAM row changes do not restart the VDG's twelve-line character scan.
      const characterRow = y % 12;
      const dots = semigraphics ? vdg.semigraphicsPixels(byte, characterRow)
        : vdg.textPixels(byte, characterRows[glyph * 12 + characterRow]!);
      const start = y * 256 + column * 8;
      for (let x = 0; x < 8; x++) pixels[start + x] = dots & (0x80 >> x) ? foreground : background;
    }
  }
}

function bitmapPalette({ pias, vdg }: Coco, signal: CocoVideoSignal) {
  const pins = pias.videoPins;
  if (signal !== "direct" && vdg.artifactMode(pins)) {
    return { paired: true, at: (byte: number, pair: number) => vdg.artifactPairColour(byte, pair, signal === "composite-reversed") };
  }
  return { paired: false, at: (byte: number, pixel: number) => vdg.graphicsColour(byte, pixel, pins) };
}

function renderBitmap(machine: Coco, mode: Extract<CocoDisplayMode, { kind: "bitmap" }>, pixels: Uint8Array, signal: CocoVideoSignal): void {
  const { ram, sam } = machine, palette = bitmapPalette(machine, signal);
  const pixelWidth = palette.paired ? 2 : 256 / mode.width, pixelHeight = 192 / mode.height;
  const pixelsPerByte = palette.paired ? 4 : 8 / mode.bitsPerPixel;
  for (let row = 0; row < mode.height; row++) {
    const start = row * pixelHeight * 256;
    for (let column = 0; column < sam.displayBytesPerRow(); column++) {
      const byte = ram.read(cocoDisplayAddress(machine, row, column));
      for (let pixel = 0; pixel < pixelsPerByte; pixel++) {
        const x = (column * pixelsPerByte + pixel) * pixelWidth;
        const colour = palette.at(byte, pixel);
        pixels.fill(colour, start + x, start + x + pixelWidth);
      }
    }
    // A SAM byte row persists for several raster lines in the lower-resolution modes.
    for (let line = 1; line < pixelHeight; line++) pixels.copyWithin(start + line * 256, start, start + 256);
  }
}
