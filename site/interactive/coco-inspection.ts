import { cocoDisplayMode } from "../../src/machines/6809/coco/runtime.js";
import type { Coco } from "../../src/machines/6809/coco/runtime.js";
import { checkUnsigned } from "../../src/components/validation.js";

export const cocoHex = (value: number, width = 4): string => value.toString(16).toUpperCase().padStart(width, "0");

/** Observable storage only. Unpopulated sockets and I/O have no inspectable byte. */
export function readCocoStorage(machine: Coco, address: number): number | undefined {
  checkUnsigned("Memory address", address, 0xffff);
  if (!machine.sam.supportedMemory()) return undefined;
  if (address < 0x8000) return machine.ram.read(address);
  if (address < 0xa000 && machine.extended.loaded) {
    const value = machine.extended.read(address - 0x8000);
    return value === "bus-error" ? undefined : value;
  }
  if (machine.firmware.loaded && (address >= 0xa000 && address <= 0xbfff || address >= 0xffe0)) {
    const value = machine.firmware.read(address & 0x1fff);
    return value === "bus-error" ? undefined : value;
  }
  return undefined;
}

/** Accessible text alongside bitmap video, using the same SAM-selected physical page. */
export function cocoScreenText(machine: Coco): string {
  if (!machine.sam.supportedMemory() || machine.sam.videoMode() !== 0 || !machine.vdg.internalText(machine.pias.videoPins)) return "";
  return Array.from({ length: 16 }, (_, row) => Array.from({ length: 32 }, (_, column) => {
    const byte = machine.ram.read(machine.sam.displayAddress(row, column)), glyph = machine.vdg.glyph(byte);
    return machine.vdg.semigraphics(byte) ? "█" : glyph === 30 ? "↑" : glyph === 31 ? "←"
      : String.fromCharCode(machine.vdg.characterCode(byte));
  }).join("").trimEnd()).join("\n").trimEnd();
}

/** The same decoded display selection used by the native raster, including unsupported settings. */
export function cocoDisplayStatus(machine: Coco): string {
  try {
    const mode = cocoDisplayMode(machine);
    const format = mode.kind === "text" ? "Text / SG4" : `${mode.width} × ${mode.height} · ${2 ** mode.bitsPerPixel} colours`;
    const css = (machine.pias.videoPins >> 3) & 1;
    return `${format} · CSS ${css} · $${cocoHex(machine.sam.displayStart())}`;
  } catch (cause) { return cause instanceof Error ? cause.message : String(cause); }
}
