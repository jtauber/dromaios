import type { XtMachine } from "./xt-session.js";
import type { Cpu8088Snapshot } from "../../src/components/cpus/generated/8088-cpu.js";

type Register = "ax" | "cx" | "dx" | "ds" | "es" | "ss" | "sp" | "si" | "di";
export type XtRegisterValues = Readonly<Partial<Record<Register, string>>>;

export function matchesXtRegisters(registers: XtRegisterValues | undefined, cpu: Cpu8088Snapshot): boolean {
  return Object.entries(registers ?? {}).every(([key, value]) => cpu[key as Register] === parseInt(value, 16));
}

/** Guards for the chapter's audited DOS load layout, checked only at the selected stop. */
export interface XtDosObservation {
  readonly bytes: { readonly address: string; readonly value: string };
  readonly registers?: XtRegisterValues;
  readonly egaPixel?: { readonly x: number; readonly y: number; readonly index: number; readonly pins: number };
  readonly egaPlane?: { readonly plane: number; readonly offset: string; readonly value: string };
  readonly screen?: { readonly contains: string; readonly lastLine: string };
}

export function matchesXtDosObservation(expect: XtDosObservation, machine: XtMachine, cpu = machine.cpu.snapshot()): boolean {
  const { ram } = machine;
  const address = parseInt(expect.bytes.address, 16), bytes = expect.bytes.value.split(" ").map(b => parseInt(b, 16));
  if (address + bytes.length > ram.size || bytes.some((byte, i) => ram.read(address + i) !== byte)) return false;
  if (!matchesXtRegisters(expect.registers, cpu)) return false;
  if (expect.egaPlane) {
    const { plane, offset, value } = expect.egaPlane;
    if (!("ega" in machine) || machine.ega.planeByte(plane, parseInt(offset, 16)) !== parseInt(value, 16)) return false;
  }
  if (expect.egaPixel) {
    const { x, y, index, pins } = expect.egaPixel;
    const pixel = "ega" in machine && machine.ega.inspectGraphicsPixel(x, y);
    if (!pixel || pixel.index !== index || pixel.pins !== pins) return false;
  }
  if (!expect.screen) return true;
  // Screen text guards describe the CGA text-page layout.
  if ("ega" in machine) return false;
  const { cga, video } = machine;
  if (!cga.videoEnabled() || !cga.textSupported()) return false;
  const lines = Array.from({ length: 25 }, (_, row) => Array.from({ length: cga.columns() }, (_, col) => {
    const byte = video.read(cga.memoryAddress(cga.characterAddress(row, col)));
    return byte >= 32 && byte < 127 ? String.fromCharCode(byte) : " ";
  }).join("").trimEnd()).filter(Boolean);
  return lines.includes(expect.screen.contains) && lines.at(-1) === expect.screen.lastLine;
}
