import type { compileCpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";
import type { Catalogue6809, Operand6809 } from "./interactive/6809-catalogue.ts";
import type { InstructionShape } from "./interactive/instruction-shape.ts";
import { instructionShape, NeedsPostbyte } from "./instruction-shape.ts";

/** Mnemonic spelling conventions only; fetches, validity, and flow come from the chapter body. */
function operandNotation(name: string): Operand6809 {
  const [mnemonic, operand] = name.split(" ");
  if (operand === "#byte") return "byte";
  if (operand === "#word") return "word";
  if (operand === "direct" || operand === "extended" || operand === "indexed") return operand;
  if (operand !== undefined) throw new Error(`Unknown 6809 operand notation: ${name}.`);
  if (/^L?B(RA|RN|HI|LS|CC|CS|NE|EQ|VC|VS|PL|MI|GE|LT|GT|LE|SR)$/.test(mnemonic!)) return "relative";
  if (/^LEA[XYUS]$/.test(mnemonic!)) return "indexed";
  if (/^(EXG|TFR)$/.test(mnemonic!)) return "transfer";
  if (/^(PSH|PUL)[SU]$/.test(mnemonic!)) return "mask";
  if (/^(ORCC|ANDCC|CWAI)$/.test(mnemonic!)) return "byte";
  return "none";
}

/** Compact shared shape IDs keep indexed families from duplicating their postbyte descriptions. */
export function instructionCatalogue6809(chapter: ReturnType<typeof compileCpuChapter>): Catalogue6809 {
  const shapes: InstructionShape[] = [], ids = new Map<string, number>();
  function intern(shape: InstructionShape): number {
    const key = JSON.stringify(shape), old = ids.get(key);
    if (old !== undefined) return old;
    const id = shapes.length; shapes.push(shape); ids.set(key, id); return id;
  }
  const instructions = Object.fromEntries(Object.values(chapter.families).flat().map(([opcode, definition]) => {
    const bytes = opcode > 255 ? 2 : 1, operand = operandNotation(definition.name);
    let shape: number | number[];
    try { shape = intern(instructionShape(definition.steps, bytes, undefined, ["s", "u"])); }
    catch (error) {
      if (!(error instanceof NeedsPostbyte)) throw error;
      shape = Array.from({ length: 256 }, (_, byte) => intern(instructionShape(definition.steps, bytes, byte, ["s", "u"])));
    }
    const forms = (Array.isArray(shape) ? shape : [shape]).map(id => shapes[id]!);
    for (const form of forms) {
      if (form.length < bytes || form.length > 5 || (operand === "none" && form.length !== bytes)) {
        throw new Error(`6809 notation disagrees with declared fetches: ${definition.name}.`);
      }
    }
    return [opcode, { name: definition.name, operand, explanation: definition.explanation, shape }];
  }));
  const prefixes = Object.values(chapter.pages).map(page => {
    if (typeof page !== "number") throw new Error("6809 disassembly requires single-byte page prefixes.");
    return page;
  });
  return { prefixes, instructions, shapes,
    indexedRegisters: chapter.operands.indexedRegisters!.map(register => register.name),
    transferRegisters: [...chapter.operands.transferWords!, ...chapter.operands.transferBytes!].map(register => register.name) };
}
