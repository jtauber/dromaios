import { cpu8088StateDescription } from "../../state/8088.ts";
import { opcodeFamily } from "../../opcodes.ts";
import { addWrap, bitAnd, bitOr, capture, concat, cpuSymbols, deferInterrupt, extend, flagLiteral, flagValue,
  readTest, reportInterrupt, sendEscape, fetchByte, literal, not, perform, projectAddress, readFlag, readRegister,
  readSource, select, shiftBits, subtract, updateFlags, value, writeLatch, writeRegister, when, zero } from "../model.ts";
import type { InstructionDefinition, NumberExpression, Statement } from "../model.ts";
import { instructionSet, registerView, registerSource } from "../builders.ts";
import { flagPolicy } from "../status.ts";
import { defineInstruction } from "../validate.ts";
import { conditional, flagCondition } from "../control-flow.ts";
import type { Condition } from "../control-flow.ts";
import { portTransfer } from "../ports.ts";
import { actions, families, policies, sources, views } from "../generated/8088.ts";

const cpu = cpuSymbols("8088", cpu8088StateDescription);
const accumulators = [
  { name: "AL", view: { source: views.AL, write: (byte: NumberExpression) => [perform(actions.setAL, { byte })] } },
  { name: "AX", view: registerView(cpu.register("ax")) },
];
const widths = [8, 16] as const;
function comparisonSteps(width: 8 | 16): readonly Statement[] {
  const left = value("left"), right = value("right");
  return [capture("result", subtract(left, right)),
    updateFlags(policies[`SUB${width}FLAGS`], { left, right, result: value("result"), incoming: flagLiteral(false) })];
}

function interruptEntry(vector: NumberExpression): readonly Statement[] {
  const offset = shiftBits(extend(vector, 16), "left", 2);
  return [...memoryOperand(16, literal(16, 0), offset).read("targetOffset"),
    ...memoryOperand(16, literal(16, 0), addWrap(offset, literal(16, 2))).read("targetSegment"),
    readSource("savedFlags", views.FLAGS),
    updateFlags(flagPolicy(cpu, "disable traps and mask INTR", {}, { tf: flagLiteral(false), if: flagLiteral(false) }), {}),
    ...(["recognitionDeferred", "interruptDeferred", "waiting", "halted"] as const).map(field => writeLatch(cpu.latch(field), false)),
    perform(actions.pushWord, { word: value("savedFlags") }), readRegister("savedCS", cpu.register("cs")), perform(actions.pushWord, { word: value("savedCS") }),
    readRegister("savedIP", cpu.register("ip")), perform(actions.pushWord, { word: value("savedIP") }),
    writeRegister(cpu.register("cs"), value("targetSegment")), writeRegister(cpu.register("ip"), value("targetOffset"))];
}
const interruptExplanation = "Read all four vector bytes before touching flags or stack, even when the frame overlaps the vector. Capture FLAGS, clear TF then IF and the recognition/wait/halt latches, then push FLAGS, live CS, and live IP. Commit target CS then IP after all writes succeed; preserve any owed trap. "
  + "Each push uses the chapter’s captured SS:SP and low-first word writes, retaining completed effects on failure.";
function softwareInterrupt(name: string, type: number | "immediate", condition?: Condition): InstructionDefinition {
  const vector = type === "immediate" ? value("vector") : literal(8, type);
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: (type === "immediate" ? "Fetch the type byte first. " : condition ? "Test OF first; when clear perform no delivery effects. " : `Use vector ${type}. `)
      + interruptExplanation + " Report software delivery only after the complete entry succeeds.",
    steps: [...(type === "immediate" ? [fetchByte("vector")] : []),
      ...conditional(condition, [...interruptEntry(vector), reportInterrupt(vector)])],
  });
}
function waitInstruction(resuming: boolean): InstructionDefinition {
  return defineInstruction({ cpu: cpu.declaration, name: resuming ? "resume WAIT" : "WAIT",
    explanation: "Sample and record TEST once before writing waiting. " + (resuming
      ? "On release, increment live IP past the saved WAIT opcode. Busy resumption leaves IP alone and does not refetch. "
      : "When busy, decrement live IP to the WAIT opcode, after any prefixes. Immediate release leaves IP alone. ")
      + "Only a low sample requests all-interrupt inhibition at successful retirement. Preserve flags and pending traps; failed pin sampling changes no CPU state.",
    steps: [readTest("high"), writeLatch(cpu.latch("waiting"), flagValue("high")),
      when(resuming ? not(flagValue("high")) : flagValue("high"), [readRegister("position", cpu.register("ip")),
        writeRegister(cpu.register("ip"), (resuming ? addWrap : subtract)(value("position"), literal(16, 1)))]),
      when(not(flagValue("high")), [deferInterrupt("all")])],
  });
}
function escapeInstruction(memory: boolean): InstructionDefinition {
  return defineInstruction({ cpu: cpu.declaration, name: `ESC ${memory ? "memory" : "register"} (resolved)`,
    inputs: { highOpcode: 3, modRM: 8, ...(memory ? { segment: 16, offset: 16 } as const : {}) },
    explanation: "After ModR/M fetch and address resolution, " + (memory
      ? "read a complete dummy word low byte first, even without a device; wrap each logical byte offset before projecting to the physical bus. "
      : "pass the register selector without reading any CPU register or memory. ")
      + "Combine opcode bits ooo with ModR/M ppp to form the six-bit external opcode. Send a detached request and record it only after callback success; preserve all CPU state.",
    steps: [...(memory ? memoryOperand(16).read("operand") : []), sendEscape({
      opcode: bitOr(shiftBits(extend(value("highOpcode"), 8), "left", 3), bitAnd(shiftBits(value("modRM"), "right", 3), literal(8, 7))), modRM: value("modRM"),
      ...(memory ? { memory: { segment: value("segment"), offset: value("offset"), address: projectAddress(value("segment"), value("offset"), 4, 20), value: value("operand") } } : {}),
    })],
  });
}

// Entry and WAIT resumption are boundary helpers; two resolved ESC bodies cover all eight primary encodings.
export const control8088 = {
  enterInterrupt: defineInstruction({ cpu: cpu.declaration, name: "interrupt entry", inputs: { vector: 8 }, explanation: interruptExplanation, steps: interruptEntry(value("vector")) }),
  resumeWait: waitInstruction(true), escapeRegister: escapeInstruction(false), escapeMemory: escapeInstruction(true),
};

// Families with numeric inputs receive the decoder's captured prefix selection.
export const operandInstructions8088 = instructionSet(Object.values(families).flat().filter(([, definition]) => definition.inputs));

// Chapter families provide ordinary instructions; these remaining families need
// native external-event capabilities until their instruction effects migrate.
export const instructions8088 = instructionSet([
  ...Object.values(families).flat().filter(([, definition]) => !definition.inputs),
  [0x9b, waitInstruction(false)],
  // 1100 11tt: breakpoint, type byte, overflow, and interrupt return.
  [0xcc, softwareInterrupt("INT3", 3)], [0xcd, softwareInterrupt("INT n", "immediate")], [0xce, softwareInterrupt("INTO", 4, flagCondition(cpu.flag("of"), true))],
  [0xcf, defineInstruction({ cpu: cpu.declaration, name: "IRET",
    explanation: "Complete the chapter's far return before its FLAGS pop. Failed FLAGS reads retain the completed return; POPF requests INTR deferral before restoring flags. Retirement samples the original TF.",
    steps: [perform(actions.returnFar, { discard: literal(16, 0) }), perform(families.popFlags[0]![1], {})] })],
  // 1110 r1dw: r=0 immediate port/1 DX; d=0 IN/1 OUT; w=0 AL/1 AX.
  ...opcodeFamily("1110 r 1 d w", { r: [false, true], d: [false, true], w: accumulators }, ({ r: useDx, d: output, w }) =>
    portTransfer(cpu.declaration, output ? `OUT ${useDx ? "DX" : "n"},${w.name}` : `IN ${w.name},${useDx ? "DX" : "n"}`,
      useDx ? registerSource(cpu.register("dx")) : { name: "zero-extended immediate port", width: 16,
        steps: [fetchByte("port")], result: extend(value("port"), 16) }, w.view, output)),
]);

// Native external and string bodies consume the same chapter memory operations.
function memoryOperand(width: 8 | 16, segment = value("segment"), offset = value("offset")) {
  const pointer = concat(segment, offset);
  return {
    read: (name: string) => [readSource(name, sources[`memory${width}`], { pointer })],
    write: (contents: NumberExpression) => [perform(actions[`store${width}`], { pointer, contents })],
  };
}

type StringOperation = "move" | "compare" | "store" | "load" | "scan";
const stringNames = { move: "MOVS", compare: "CMPS", store: "STOS", load: "LODS", scan: "SCAS" } as const;

function stringBody(operation: StringOperation, width: 8 | 16, repeat: "once" | "repe" | "repne", override: boolean) {
  const compares = operation === "compare" || operation === "scan", repeated = repeat !== "once";
  const source = memoryOperand(width, value("sourceSegment"), value("sourceOffset"));
  const destination = memoryOperand(width, value("destinationSegment"), value("destinationOffset"));
  const accumulator = accumulators[width === 8 ? 0 : 1]!.view;
  const compare = (left: readonly Statement[]) => [...left, ...destination.read("right"), ...comparisonSteps(width)];
  const transfers = {
    move: [...source.read("contents"), ...destination.write(value("contents"))],
    compare: compare(source.read("left")),
    store: [readSource("contents", accumulator.source), ...destination.write(value("contents"))],
    load: [...source.read("contents"), ...accumulator.write(value("contents"))],
    scan: compare([readSource("left", accumulator.source)]),
  };
  const advance = (register: "si" | "di") => [readRegister(register, cpu.register(register)),
    writeRegister(cpu.register(register), addWrap(value(register), value("delta")))];
  const rewind = [writeRegister(cpu.register("ip"), value("startIP"))];
  const steps = [
    // Capture both operand coordinates before any data access, as in the original instruction schedule.
    override ? capture("sourceSegment", value("segment")) : readRegister("sourceSegment", cpu.register("ds")),
    readRegister("sourceOffset", cpu.register("si")), readRegister("destinationSegment", cpu.register("es")), readRegister("destinationOffset", cpu.register("di")),
    ...transfers[operation], readFlag("backward", cpu.flag("df")),
    capture("delta", select(flagValue("backward"), literal(16, 0x10000 - width / 8), literal(16, width / 8))),
    ...(operation === "move" || operation === "compare" || operation === "load" ? advance("si") : []),
    ...(operation === "load" ? [] : advance("di")),
    ...(repeated ? [readRegister("count", cpu.register("cx")), writeRegister(cpu.register("cx"), subtract(value("count"), literal(16, 1))),
      ...conditional({ steps: [readRegister("remaining", cpu.register("cx"))], test: not(zero(value("remaining"))) },
        compares ? conditional(flagCondition(cpu.flag("zf"), repeat === "repe"), rewind) : rewind)] : []),
  ];
  const prefix = repeated ? (compares ? repeat.toUpperCase() : "REP") + " " : "";
  return defineInstruction({ cpu: cpu.declaration,
    name: `${prefix}${stringNames[operation]}${width === 8 ? "B" : "W"}${override ? " (segment override)" : ""}`,
    inputs: { ...(override ? { segment: 16 as const } : {}), ...(repeated ? { startIP: 16 as const } : {}) },
    explanation: (repeated ? "Read CX first; zero skips all operand, flag, and index effects. " : "Do not access CX or IP. ")
      + "Capture the source segment/SI and fixed ES/DI before accessing data, even when only one operand is used. Transfer words low byte first, wrapping offsets before physical projection. "
      + (compares ? "Read the left operand before the destination; update subtraction CF/AF/OF/ZF/SF/PF in that order. " : "Preserve flags and capture sources before writes; byte loads preserve live AH. ")
      + "After the data effects, read DF and advance the live indices, SI before DI when both apply. "
      + (repeated ? "Decrement live CX, reread it, and only when nonzero test the new ZF if comparing. Rewind IP to the supplied prefix start only when repeating. " : "")
      + "One body performs one element; the CPU boundary owns retirement, interrupts, and the next prefix fetch. Failed effects retain completed changes.",
    steps: conditional(repeated ? { steps: [readRegister("initialCount", cpu.register("cx"))], test: not(zero(value("initialCount"))) } : undefined, steps),
  });
}

/** Prefix choices specialize bodies; each repeated invocation performs at most one element. */
export const strings8088: Readonly<Record<string, InstructionDefinition>> = Object.fromEntries(
  (Object.keys(stringNames) as StringOperation[]).flatMap(operation => widths.flatMap(width =>
    (["once", "repe", ...(operation === "compare" || operation === "scan" ? ["repne" as const] : [])] as const).flatMap(repeat =>
      [false, true].map(override => [`${operation}_${width}${repeat === "once" ? "" : "_" + repeat}${override ? "_override" : ""}`,
        stringBody(operation, width, repeat, override)])))));
