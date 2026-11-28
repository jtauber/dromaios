import { cocoMemorySupported, cocoRamAddress, cocoDisplayAddress } from "../../src/machines/6809/coco/memory.js";
import { cocoDisplayMode } from "../../src/machines/6809/coco/runtime.js";
import type { Coco, CocoPixel } from "../../src/machines/6809/coco/runtime.js";
import { checkUnsigned } from "../../src/components/validation.js";

export const cocoHex = (value: number, width = 4): string => value.toString(16).toUpperCase().padStart(width, "0");

/** The live readout and the captured stop name the same bits, including leading zeroes. */
export function cocoPixelStorage(dot: CocoPixel): string {
  const { address, byte } = dot, storage = `RAM $${cocoHex(address)} = $${cocoHex(byte, 2)}`;
  if ("blockBit" in dot) {
    const names = ["green", "yellow", "blue", "red", "buff", "cyan", "magenta", "orange"];
    const shared = dot.foreground.toString(2).padStart(3, "0");
    return `${storage} · block bit ${dot.blockBit} = ${(byte >> dot.blockBit) & 1} · colour bits 6–4 = ${shared} (${names[dot.foreground]})`;
  }
  if ("glyph" in dot) return `${storage} · glyph $${cocoHex(dot.glyph, 2)} · row ${dot.glyphRow}`;
  const { bit, bitsPerPixel } = dot;
  const field = bitsPerPixel === 1 ? `bit ${bit}` : `bits ${bit + bitsPerPixel - 1}–${bit}`;
  const value = (byte >> bit) & ((1 << bitsPerPixel) - 1);
  return `${storage} · ${field} = ${value.toString(2).padStart(bitsPerPixel, "0")}`;
}

// Presentation colours, including the VDG's two-dot composite approximation.
export const cocoMonitorColours = [
  0x00dc00, 0xffff00, 0x3030ff, 0xff3030, 0xffffc8, 0x00ffff, 0xff00ff,
  0xff8c00, 0x000000, 0x003c00, 0x462300, 0x3050ff, 0xff7030,
] as const;

/** Observable storage only. Unpopulated sockets and I/O have no inspectable byte. */
export function readCocoStorage(machine: Coco, address: number): number | undefined {
  checkUnsigned("Memory address", address, 0xffff);
  if (!cocoMemorySupported(machine)) return undefined;
  const physical = cocoRamAddress(machine, address);
  if (physical !== undefined) return machine.ram.read(physical);
  if (address < 0xa000 && machine.extended.loaded) {
    const value = machine.extended.read(address - 0x8000);
    return value === "bus-error" ? undefined : value;
  }
  if (machine.firmware.loaded && (address >= 0xa000 && address <= 0xbfff || address >= 0xffe0)) {
    const value = machine.firmware.read(address & 0x1fff);
    return value === "bus-error" ? undefined : value;
  }
  if (machine.cartridge?.inserted() && address >= 0xc000 && address < 0xff00) {
    const value = machine.cartridge.read(address - 0xc000);
    return value === "bus-error" ? undefined : value;
  }
  if (machine.dos?.loaded && address >= 0xc000 && address < 0xff00) {
    const value = machine.dos.read(address & 0x1fff);
    return value === "bus-error" ? undefined : value;
  }
  return undefined;
}

/** Whole characters only: extended semigraphics can display slices of different glyphs. */
export function cocoScreenText(machine: Coco): string {
  if (!cocoMemorySupported(machine) || machine.sam.videoMode() !== 0 || !machine.vdg.internalText(machine.pias.videoPins)) return "";
  return Array.from({ length: 16 }, (_, row) => Array.from({ length: 32 }, (_, column) => {
    const byte = machine.ram.read(cocoDisplayAddress(machine, row, column)), glyph = machine.vdg.glyph(byte);
    return machine.vdg.semigraphics(byte) ? "█" : glyph === 30 ? "↑" : glyph === 31 ? "←"
      : String.fromCharCode(machine.vdg.characterCode(byte));
  }).join("").trimEnd()).join("\n").trimEnd();
}

/** The same decoded display selection used by the native raster, including unsupported settings. */
export function cocoDisplayStatus(machine: Coco): string {
  try {
    const mode = cocoDisplayMode(machine);
    const format = mode.kind === "text" ? "Text / SG4"
      : mode.kind === "semigraphics" ? `SG${mode.height / 8} · 64 × ${mode.height} · 8 colours + black`
      : `${mode.width} × ${mode.height} · ${2 ** mode.bitsPerPixel} colours`;
    const css = (machine.pias.videoPins >> 3) & 1;
    return `${format} · CSS ${css} · $${cocoHex(machine.sam.displayStart())}`;
  } catch (cause) { return cause instanceof Error ? cause.message : String(cause); }
}
