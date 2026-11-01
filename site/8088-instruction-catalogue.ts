import type { compileCpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";
import type { Catalogue8088, Encoding8088 } from "./interactive/8088-disassembly.ts";
import { instructionShape } from "./instruction-shape.ts";

/** Intel operand notation for families whose chapter names describe a group or an operand width. */
function notation(name: string, opcode: number, words: readonly string[]): string | readonly string[] {
  const width = opcode & 1 ? 16 : 8;
  const rm = "rm" + width;
  if (name.startsWith("ALU ")) return ["ADD", "OR", "ADC", "SBB", "AND", "SUB", "XOR", "CMP"]
    .map(op => `${op} ${rm},${opcode === 0x83 ? "signed8" : "imm" + width}`);
  if (name.includes("shifts/rotates")) return ["ROL", "ROR", "RCL", "RCR", "SHL", "SHR", "", "SAR"]
    .map(op => `${op} ${rm},${name.endsWith("CL") ? "CL" : "1"}`);
  if (name.includes("multiply, and divide group")) return [`TEST ${rm},imm${width}`, "", ...["NOT", "NEG", "MUL", "IMUL", "DIV", "IDIV"].map(op => op + " " + rm)];
  if (name.startsWith("INC/DEC")) return [`INC ${rm}`, `DEC ${rm}`, "CALL rm16", "CALL farMem", "JMP rm16", "JMP farMem", "PUSH rm16"];
  if (name.startsWith("ESC ")) return "ESC escape,escOperand";
  const sized = /^(\w+) (8|16)-bit (.+)$/.exec(name);
  if (sized) {
    const operands = sized[3]!.split(",").map(operand => {
      const token = ({ "r/m": "rm", r: "reg", n: "imm" })[operand];
      if (!token) throw new Error("Unknown 8088 operand in " + name);
      return token + sized[2];
    });
    return sized[1] + " " + operands.join(",");
  }
  if (name.includes("r/m16")) return name.replace("r/m16", "rm16");
  if (name.endsWith("r16,m")) return name.replace("r16,m", name.startsWith("LEA") ? "reg16,mem" : "reg16,farMem");
  if (/\bn\b/.test(name)) {
    const word = name.startsWith("RET") || (!/^(IN|OUT) /.test(name) && words.some(r => name.includes(" " + r + ",")));
    return name.replace(/\bn\b/, word ? "imm16" : "imm8");
  }
  return name;
}

export function instructionCatalogue8088(chapter: ReturnType<typeof compileCpuChapter>): Catalogue8088 {
  const execution = chapter.execution;
  if (!execution || !("prefixes" in execution)) throw new Error("Expected segmented 8088 execution.");
  const names = (group: string) => chapter.operands[group]!.map(item => item.name);
  const words = names("words");
  const instructions: Record<number, Encoding8088> = {};
  for (const [opcode, definition] of Object.values(chapter.families).flat()) {
    const firstFetch = definition.steps.find(step => step.kind === "fetch-byte");
    const modRM = firstFetch?.name === "postbyte";
    const dispatch = definition.steps.find(step => step.kind === "dispatch" && step.selector.kind === "value" && step.selector.name === "postbyte");
    const forms = dispatch?.kind === "dispatch" ? dispatch.cases.map(({ mask, value }) => [mask, value] as const) : [];
    const condition = opcode >= 0x70 && opcode <= 0x7f
      ? instructionShape(definition.steps, 1, undefined, [], "ip").condition : undefined;
    if (opcode >= 0x70 && opcode <= 0x7f && !condition) throw new Error("8088 Jcc needs its declared flag condition.");
    instructions[opcode] = { notation: notation(definition.name, opcode, words), explanation: definition.explanation,
      ...(condition && { condition }), ...(modRM ? { forms } : {}) };
  }
  const prefixes = Object.fromEntries(execution.prefixes.map(prefix => [prefix.opcode,
    prefix.kind === "segment" ? prefix.field.toUpperCase() : prefix.kind === "ignore" ? "LOCK" : prefix.value === 1 ? "REP" : "REPNE"]));
  return { instructions, prefixes, bytes: names("bytes"), words, segments: names("segments"), bases: names("memoryBases") };
}
