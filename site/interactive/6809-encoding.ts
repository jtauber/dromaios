import type { Catalogue6809 } from "./6809-catalogue.js";
import type { InstructionShape } from "./instruction-shape.js";

/** Opcode and postbyte select chapter-derived metadata; operand spelling is a separate concern. */
export function read6809Encoding(fetch: () => number | undefined, catalogue: Catalogue6809) {
  const first = fetch(); let opcode = first, opcodeBytes = 1;
  if (first !== undefined && catalogue.prefixes.includes(first)) {
    const second = fetch(); opcodeBytes = 2;
    opcode = second === undefined ? undefined : first * 256 + second;
  }
  const info = opcode === undefined ? undefined : catalogue.instructions[opcode];
  let shape: InstructionShape | undefined;
  if (info) {
    if (typeof info.shape === "number") shape = catalogue.shapes[info.shape];
    else { const postbyte = fetch(); if (postbyte !== undefined) shape = catalogue.shapes[info.shape[postbyte]!]; }
  }
  return { opcodeBytes, info, shape };
}

/** Completed fetched bytes supply effects without memory reads or formatted disassembly. */
export function captured6809Shape(bytes: readonly number[], catalogue: Catalogue6809): InstructionShape | undefined {
  let offset = 0;
  const { shape } = read6809Encoding(() => bytes[offset++], catalogue);
  if (!shape?.supported || bytes.length < shape.length) return undefined;
  for (let index = 0; index < shape.length; index++) if (bytes[index] === undefined) return undefined;
  return shape;
}
