import type { Coco } from "../../src/machines/6809/coco/runtime.js";
import { checkUnsigned } from "../../src/components/validation.js";

export const cocoHex = (value: number, width = 4): string => value.toString(16).toUpperCase().padStart(width, "0");

/** Observable storage only. Unpopulated sockets and I/O have no inspectable byte. */
export function readCocoStorage(machine: Coco, address: number): number | undefined {
  checkUnsigned("Memory address", address, 0xffff);
  if (!machine.sam.supportedMemory()) return undefined;
  if (address < 0x8000) return machine.ram.read(address);
  if (machine.firmware.loaded && (address >= 0xa000 && address <= 0xbfff || address >= 0xffe0)) {
    const value = machine.firmware.read(address & 0x1fff);
    return value === "bus-error" ? undefined : value;
  }
  return undefined;
}

/** Accessible text alongside bitmap video, using the same SAM-selected physical page. */
export function cocoScreenText(machine: Coco): string {
  if (!machine.sam.supportedMemory() || machine.sam.videoMode() !== 0 || !machine.vdg.alphaMode(machine.pias.videoPins)) return "";
  return Array.from({ length: 16 }, (_, row) => Array.from({ length: 32 }, (_, column) => {
    const byte = machine.ram.read(machine.sam.textAddress(row, column)), glyph = machine.vdg.glyph(byte);
    return machine.vdg.semigraphics(byte) ? "█" : glyph === 30 ? "↑" : glyph === 31 ? "←"
      : String.fromCharCode(machine.vdg.characterCode(byte));
  }).join("").trimEnd()).join("\n").trimEnd();
}
