import type { MemoryAccess } from "../../src/components/cpus/memory-access.js";
import type { Boundary6809 } from "./6809-instruction-preview.js";
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

export type DataRead6809 = MemoryAccess & { readonly kind: "read" };

/** The 6809 fetches the complete encoding before data transfers. An interrupt entry fetches no instruction bytes. */
export function dataReads6809(record: Boundary6809): readonly DataRead6809[] {
  if (record.outcome !== "executed" && record.outcome !== "accepted") return [];
  const fetches = record.instruction?.bytes.length ?? 0;
  return record.accesses.filter((access, index): access is DataRead6809 => index >= fetches && access.kind === "read");
}
