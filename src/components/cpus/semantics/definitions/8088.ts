import { cpu8088StateDescription } from "../../state/8088.ts";
import { opcodeFamily } from "../../opcodes.ts";
import { addWrap, bitAnd, bitOr, capture, concat, cpuSymbols, deferInterrupt, extend, flagLiteral, flagValue,
  readTest, reportInterrupt, sendEscape, fetchByte, literal, not, perform, projectAddress, readFlag, readRegister,
  readSource, select, shiftBits, signExtend, subtract, updateFlags, value, writeLatch, writeRegister, when, xor, zero } from "../model.ts";
import type { InstructionDefinition, NumberExpression, Statement, ValueSource } from "../model.ts";
import { immediateByte, immediateWord, instructionSet, registerView, registerSource } from "../builders.ts";
import type { RegisterView } from "../builders.ts";
import { flagInstruction, flagPolicy } from "../status.ts";
import { defineInstruction } from "../validate.ts";
import { choose, conditional, flagCondition, relativeBranchSteps } from "../control-flow.ts";
import { segmentedWordStack, stackPush, stackPop } from "../stack.ts";
import type { Condition } from "../control-flow.ts";
import { portTransfer } from "../ports.ts";
import { actions, families, operands, policies, sources, views } from "../generated/8088.ts";

const cpu = cpuSymbols("8088", cpu8088StateDescription);
const wordRegisters = operands.words.map(operand => {
  if (operand.kind !== "register") throw new Error("8088 word operands must be stored chapter registers.");
  return operand.register;
});
const registers = [
  operands.bytes.map(operand => {
    if (operand.kind !== "view") throw new Error("8088 byte operands must be writable chapter views.");
    const view: RegisterView = { source: operand.read, write: byte => [perform(operand.write, { byte })] };
    return { name: operand.name, view };
  }),
  wordRegisters.map(word => ({ name: word.field.toUpperCase(), view: registerView(word) })),
] as const;
const widths = [8, 16] as const;
function comparisonSteps(width: 8 | 16): readonly Statement[] {
  const left = value("left"), right = value("right");
  return [capture("result", subtract(left, right)),
    updateFlags(policies[`SUB${width}FLAGS`], { left, right, result: value("result"), incoming: flagLiteral(false) })];
}

// Construction-time decisions retain the original short-circuit flag-read order.
type Decision = (yes: readonly Statement[], no: readonly Statement[]) => readonly Statement[];
const decision = (condition: Condition): Decision => (yes, no) => choose(condition, yes, no);
const flagTest = (field: "cf" | "zf" | "sf" | "pf" | "of") => decision({ steps: [readFlag(field, cpu.flag(field))], test: flagValue(field) });
const either = (left: Decision, right: Decision): Decision => (yes, no) => left(yes, right(yes, no));
const signMismatch = decision({ steps: [readFlag("sf", cpu.flag("sf")), readFlag("of", cpu.flag("of"))], test: xor(flagValue("sf"), flagValue("of")) });
// 0111 ttt p: rows select ttt; names select p=0/1 without changing the read schedule.
const branchConditions = [
  { names: ["JO", "JNO"], decide: flagTest("of") }, // 000: overflow
  { names: ["JB", "JAE"], decide: flagTest("cf") }, // 001: unsigned below
  { names: ["JE", "JNE"], decide: flagTest("zf") }, // 010: equal
  { names: ["JBE", "JA"], decide: either(flagTest("cf"), flagTest("zf")) }, // 011: unsigned below or equal
  { names: ["JS", "JNS"], decide: flagTest("sf") }, // 100: sign
  { names: ["JP", "JNP"], decide: flagTest("pf") }, // 101: parity
  { names: ["JL", "JGE"], decide: signMismatch }, // 110: signed less
  { names: ["JLE", "JG"], decide: either(flagTest("zf"), signMismatch) }, // 111: signed less or equal
] as const;
const relativeByteBranch = () => relativeBranchSteps(cpu.register("ip"), signExtend(value("offset"), 16));

const stack = segmentedWordStack(cpu.register("ss"), cpu.register("sp"));
const segmentRegisters = ["es", "cs", "ss", "ds"] as const;

function pushedRegister(register: typeof wordRegisters[number]): ValueSource {
  const source = registerView(register).source;
  // Original 8088 PUSH SP captures the decremented value, before the stack's own pointer update.
  return register.field === "sp" ? { ...source, name: "decremented SP", result: subtract(source.result, literal(16, 2)) } : source;
}

function popSegment(register: "es" | "ss" | "ds") {
  const definition = stackPop(cpu.declaration, "POP " + register.toUpperCase(), stack,
    [writeRegister(cpu.register(register), value("result")), deferInterrupt("all")]);
  return defineInstruction({ ...definition, explanation: definition.explanation
    + " After loading any segment, request inhibition of all interrupt recognition at retirement." });
}

function farTransfer(call: boolean): readonly Statement[] {
  return [
    ...(call ? [readRegister("returnCS", cpu.register("cs")), ...stack.push(value("returnCS"), "code"),
      readRegister("returnIP", cpu.register("ip")), ...stack.push(value("returnIP"), "return")] : []),
    writeRegister(cpu.register("cs"), value("targetSegment")), writeRegister(cpu.register("ip"), value("targetOffset")),
  ];
}

function returnSteps(far: boolean, discard: NumberExpression): readonly Statement[] {
  return [readSource("targetIP", stack.pop), ...(far ? [readSource("targetCS", stack.pop)] : []),
    writeRegister(cpu.register("ip"), value("targetIP")), ...(far ? [writeRegister(cpu.register("cs"), value("targetCS"))] : []),
    readRegister("discardPointer", cpu.register("sp")), writeRegister(cpu.register("sp"), addWrap(value("discardPointer"), discard))];
}

function restoreFlagsSteps(): readonly Statement[] {
  return [readSource("status", stack.pop), readFlag("oldIF", cpu.flag("if")),
    when(not(flagValue("oldIF")), [when(not(zero(bitAnd(value("status"), literal(16, 0x200)))), [deferInterrupt("intr")])]),
    perform(actions.restoreFlags, { status: value("status") })];
}

function interruptEntry(vector: NumberExpression): readonly Statement[] {
  const offset = shiftBits(extend(vector, 16), "left", 2);
  return [...memoryOperand(16, literal(16, 0), offset).read("targetOffset"),
    ...memoryOperand(16, literal(16, 0), addWrap(offset, literal(16, 2))).read("targetSegment"),
    readSource("savedFlags", views.FLAGS),
    updateFlags(flagPolicy(cpu, "disable traps and mask INTR", {}, { tf: flagLiteral(false), if: flagLiteral(false) }), {}),
    ...(["recognitionDeferred", "interruptDeferred", "waiting", "halted"] as const).map(field => writeLatch(cpu.latch(field), false)),
    ...stack.push(value("savedFlags"), "flags"), readRegister("savedCS", cpu.register("cs")), ...stack.push(value("savedCS"), "code"),
    readRegister("savedIP", cpu.register("ip")), ...stack.push(value("savedIP"), "return"),
    writeRegister(cpu.register("cs"), value("targetSegment")), writeRegister(cpu.register("ip"), value("targetOffset"))];
}
const interruptExplanation = "Read all four vector bytes before touching flags or stack, even when the frame overlaps the vector. Capture FLAGS, clear TF then IF and the recognition/wait/halt latches, then push FLAGS, live CS, and live IP. Commit target CS then IP after all writes succeed; preserve any owed trap. " + stack.explanation;
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

// Numeric keys are the encoding authority for both generated bodies and runtime bindings.
export const instructions8088 = instructionSet([
  ...Object.values(families).flat().filter(([, definition]) => !definition.inputs),
  // 000 ss 11p: ss=ES/CS/SS/DS; p=0 PUSH, p=1 POP, with POP CS undocumented.
  ...opcodeFamily("000 ss 110", { s: segmentRegisters }, ({ s }) =>
    stackPush(cpu.declaration, "PUSH " + s.toUpperCase(), stack, registerView(cpu.register(s)).source)),
  [0x07, popSegment("es")], [0x17, popSegment("ss")], [0x1f, popSegment("ds")],
  // 0101 p rrr: p=0 PUSH/1 POP; rrr selects AX/CX/DX/BX/SP/BP/SI/DI.
  ...opcodeFamily("0101 p rrr", { p: [false, true], r: wordRegisters }, ({ p: pop, r }) => pop
    ? stackPop(cpu.declaration, "POP " + r.field.toUpperCase(), stack, r)
    : stackPush(cpu.declaration, "PUSH " + r.field.toUpperCase(), stack, pushedRegister(r))),
  // 0111 ttt p: ttt selects the positive condition; p=1 inverts it without changing flag-read order.
  ...opcodeFamily("0111 ttt p", { t: branchConditions, p: [0, 1] }, ({ t: condition, p: invert }) => defineInstruction({
    cpu: cpu.declaration, name: `${condition.names[invert]} rel8`,
    explanation: "Fetch the signed displacement before testing flags. Preserve short-circuit flag reads; only a taken path reads and writes post-fetch IP. Wrap IP within CS and preserve flags and control state.",
    steps: [readSource("offset", immediateByte), ...condition.decide(invert ? [] : relativeByteBranch(), invert ? relativeByteBranch() : [])],
  })),
  // 1001 0 rrr: exchange AX with the selected word; rrr=000 is the documented NOP.
  ...opcodeFamily("1001 0 rrr", { r: wordRegisters }, ({ r: register }) => defineInstruction({
    cpu: cpu.declaration, name: register.field === "ax" ? "NOP" : `XCHG AX,${register.field.toUpperCase()}`,
    explanation: "Capture the selected register before AX, then write AX before the selected register. NOP retains the same self-exchange schedule. Do not access flags or memory.",
    steps: [readRegister("selected", register), readRegister("accumulator", cpu.register("ax")),
      writeRegister(cpu.register("ax"), value("selected")), writeRegister(register, value("accumulator"))],
  })),
  // 1001 1010: far CALL fetches the full pointer before either return-address push.
  [0x9a, defineInstruction({ cpu: cpu.declaration, name: "CALL ptr16:16",
    explanation: "Fetch offset then segment, low byte first. Push live CS then IP; capture IP only after the CS push. Commit CS:IP after both pushes. " + stack.explanation,
    steps: [readSource("targetOffset", immediateWord), readSource("targetSegment", immediateWord), ...farTransfer(true)] })],
  [0x9b, waitInstruction(false)], // 1001 1011: sample TEST before the next coprocessor instruction.
  // 1001 110p: p=0 pushes packed FLAGS; p=1 restores them after a complete pop.
  [0x9c, stackPush(cpu.declaration, "PUSHF", stack, views.FLAGS)],
  [0x9d, defineInstruction({ cpu: cpu.declaration, name: "POPF",
    explanation: "Pop the complete FLAGS word, then read live IF. A 0-to-1 transition requests INTR deferral before replacing the flag object. Ignore reserved bits. " + stack.explanation,
    steps: restoreFlagsSteps() })],
  // 1100 f 01n: f=0 near/1 far; n=0 fetches a discard count, n=1 discards zero.
  ...opcodeFamily("1100 f 01 n", { f: [false, true], n: [false, true] }, ({ f: far, n: plain }) => defineInstruction({
    cpu: cpu.declaration, name: (far ? "RETF" : "RET") + (plain ? "" : " n"),
    explanation: "Fetch any discard count before stack reads. Pop IP, then CS for a far return, before committing either target. Finally add the unsigned discard count to live SP, even when zero. " + stack.explanation,
    steps: [...(plain ? [] : [readSource("discard", immediateWord)]), ...returnSteps(far, plain ? literal(16, 0) : value("discard"))],
  })),
  // 1100 1111: IRET completes the far return before reading and restoring FLAGS.
  // 1100 11tt: tt=00 breakpoint, 01 type byte, 10 overflow, 11 return.
  [0xcc, softwareInterrupt("INT3", 3)], [0xcd, softwareInterrupt("INT n", "immediate")], [0xce, softwareInterrupt("INTO", 4, flagCondition(cpu.flag("of"), true))],
  [0xcf, defineInstruction({ cpu: cpu.declaration, name: "IRET",
    explanation: "Pop IP and CS before committing either target, then pop FLAGS and apply POPF's IF-transition deferral. Failed FLAGS reads retain the completed far return. Retirement samples the original TF. " + stack.explanation,
    steps: [...returnSteps(true, literal(16, 0)), ...restoreFlagsSteps()] })],
  // 1110 r 1 d w: r=0 immediate port/1 DX; d=0 IN/1 OUT; w=0 AL/1 AX.
  ...opcodeFamily("1110 r 1 d w", { r: [false, true], d: [false, true], w: registers }, ({ r: useDx, d: output, w }) =>
    portTransfer(cpu.declaration, output ? `OUT ${useDx ? "DX" : "n"},${w[0]!.name}` : `IN ${w[0]!.name},${useDx ? "DX" : "n"}`,
      useDx ? registerSource(cpu.register("dx")) : { name: "zero-extended immediate port", width: 16,
        steps: [fetchByte("port")], result: extend(value("port"), 16) }, w[0]!.view, output)),
  // 1110 00cc: cc=00 LOOPNE, 01 LOOPE, 10 LOOP decrement CX; 11 JCXZ only tests it.
  ...opcodeFamily("1110 00 cc", { c: ["LOOPNE", "LOOPE", "LOOP", "JCXZ"] }, ({ c: name }) => defineInstruction({
    cpu: cpu.declaration, name: `${name} rel8`,
    explanation: "Fetch the displacement first. LOOP variants decrement CX, reread it, and skip ZF when it is zero; LOOP never reads ZF. JCXZ reads CX once without decrementing. Only a taken path reads and writes IP, with word wrapping. Preserve every flag.",
    steps: [readSource("offset", immediateByte),
      ...(name === "JCXZ" ? [] : [readRegister("counter", cpu.register("cx")), writeRegister(cpu.register("cx"), subtract(value("counter"), literal(16, 1)))]),
      ...conditional({ steps: [readRegister("remaining", cpu.register("cx"))], test: name === "JCXZ" ? zero(value("remaining")) : not(zero(value("remaining"))) },
        name === "LOOPNE" || name === "LOOPE" ? conditional(flagCondition(cpu.flag("zf"), name === "LOOPE"), relativeByteBranch()) : relativeByteBranch())],
  })),
  // 1110 10f0: f=0 relative CALL; f=1 immediate far JMP.
  [0xe8, defineInstruction({ cpu: cpu.declaration, name: "CALL rel16",
    explanation: "Fetch the complete displacement before capturing and pushing return IP. Only after both writes add the displacement to live IP with word wrapping. " + stack.explanation,
    steps: [readSource("displacement", immediateWord), readRegister("returnIP", cpu.register("ip")),
      ...stack.push(value("returnIP")), ...relativeBranchSteps(cpu.register("ip"), value("displacement"))] })],
  [0xea, defineInstruction({ cpu: cpu.declaration, name: "JMP ptr16:16",
    explanation: "Fetch the complete offset and segment before writing CS then IP. Preserve SP and flags; never read the target.",
    steps: [readSource("targetOffset", immediateWord), readSource("targetSegment", immediateWord), ...farTransfer(false)] })],
  // 1110 10s1: s=0 fetches a word displacement; s=1 sign-extends a byte.
  ...opcodeFamily("1110 10 s 1", { s: [immediateWord, immediateByte] }, ({ s: source }) => defineInstruction({
    cpu: cpu.declaration, name: `JMP rel${source.width}`,
    explanation: "Fetch the complete displacement low byte first, then add it to post-fetch IP with word wrapping. Preserve CS and flags; never read the target.",
    steps: [readSource("offset", source), ...relativeBranchSteps(cpu.register("ip"), source.width === 8 ? signExtend(value("offset"), 16) : value("offset"))],
  })),
  // 1111 010h: h=0 HLT, h=1 CMC. 1111 1f0v: f=0 carry/1 direction, v is the new value.
  [0xf4, defineInstruction({ cpu: cpu.declaration, name: "HLT", explanation: "Set the stored halt latch without accessing registers or flags; the CPU boundary still owns retirement and pending traps.",
    steps: [writeLatch(cpu.latch("halted"), true)] })],
  [0xf5, flagInstruction(cpu, "CMC", "cf", "complement")],
  // 1111 101v: v writes IF; only STI's 0-to-1 transition requests INTR deferral.
  ...opcodeFamily("1111 101 v", { v: [false, true] }, ({ v: enabled }) => defineInstruction({
    cpu: cpu.declaration, name: enabled ? "STI" : "CLI",
    explanation: enabled ? "Read IF and request INTR deferral only when it was clear, then set IF. The boundary commits inhibition at successful retirement."
      : "Clear IF without reading flags or requesting deferral. Preserve every other flag.",
    steps: [...(enabled ? [readFlag("enabled", cpu.flag("if")), when(not(flagValue("enabled")), [deferInterrupt("intr")])] : []),
      ...flagInstruction(cpu, enabled ? "STI" : "CLI", "if", enabled).steps],
  })),
  ...opcodeFamily("1111 1 f 0 v", { f: [{ field: "cf", names: ["CLC", "STC"] }, { field: "df", names: ["CLD", "STD"] }], v: [0, 1] },
    ({ f, v }) => flagInstruction(cpu, f.names[v]!, f.field, Boolean(v))),
]);

// Resolved operands retain only the decoder's captured segment/offset; no live address callback enters a body.
interface OperandDefinition {
  readonly name: string;
  readonly memory?: true;
  readonly read: (name: string) => readonly Statement[];
  readonly write: (contents: NumberExpression) => readonly Statement[];
}

function memoryOperand(width: 8 | 16, segment = value("segment"), offset = value("offset")): OperandDefinition {
  const pointer = concat(segment, offset);
  return { name: `${width === 8 ? "byte" : "word"} [segment:offset]`, memory: true,
    read: name => [readSource(name, sources[`memory${width}`], { pointer })],
    write: contents => [perform(actions[`store${width}`], { pointer, contents })],
  };
}

/** Register-pair families and r/m families share the same operand definitions and selectors. */
function operandSet(width: 8 | 16) {
  const choices: readonly OperandDefinition[] = registers[width === 8 ? 0 : 1]
    .map(({ name, view }) => ({ name, read: name => [readSource(name, view.source)], write: view.write }));
  const memory = memoryOperand(width);
  return { width, registers: choices, memory,
    resolved: [...choices.map((operand, selector) => [selector, operand] as const), ["memory", memory] as const] };
}

const byteOperands = operandSet(8), wordOperands = operandSet(16);

function resolvedInstruction(operands: readonly Pick<OperandDefinition, "memory">[], definition: Omit<InstructionDefinition, "cpu" | "inputs">): InstructionDefinition {
  return defineInstruction({ cpu: cpu.declaration,
    ...(operands.some(operand => operand.memory) ? { inputs: { segment: 16, offset: 16 } as const } : {}), ...definition });
}

function readFarPointer(): readonly Statement[] {
  return [...wordOperands.memory.read("targetOffset"),
    ...memoryOperand(16, value("segment"), addWrap(value("offset"), literal(16, 2))).read("targetSegment")];
}

/** The remaining native resolved pop; indirect pushes and calls belong to the chapter. */
export const stack8088 = {
  POP_memory: defineInstruction({ cpu: cpu.declaration, name: "POP word [segment:offset] (resolved)", inputs: { segment: 16, offset: 16 },
    explanation: "Enter with the destination resolved before the pop. Capture the complete stack word, increment SP, then write the destination low/high without reading it. " + stack.explanation,
    steps: [readSource("word", stack.pop), ...wordOperands.memory.write(value("word"))] }),
};

// Segment writes from MOV have the same inhibition policy as POP; LES/LDS do not request it.
function segmentMove(segment: typeof segmentRegisters[number], operand: OperandDefinition, toSegment: boolean) {
  return resolvedInstruction([operand], {
    name: `MOV ${toSegment ? segment.toUpperCase() + "," + operand.name : operand.name + "," + segment.toUpperCase()} (resolved)`,
    explanation: "Resolve the operand before reading the source. Transfer the complete word low byte first with logical offset wrapping. "
      + (toSegment ? "Write the segment, then request all-interrupt inhibition at successful retirement. " : "Capture the segment before writing the destination. ")
      + "Preserve flags. Failed effects retain completed byte transfers and prevent later effects.",
    steps: toSegment ? [...operand.read("contents"), writeRegister(cpu.register(segment), value("contents")), deferInterrupt("all")]
      : [readRegister("contents", cpu.register(segment)), ...operand.write(value("contents"))],
  });
}

/** Remaining transfers: resolved segment moves and address loads, plus XLAT's live table lookup. */
export const addressing8088: Readonly<Record<string, InstructionDefinition>> = Object.fromEntries([
  ...segmentRegisters.flatMap(segment => wordOperands.resolved.flatMap(([selector, operand]) =>
    [false, true].filter(toSegment => !toSegment || segment !== "cs").map(toSegment => [
      `segment_${toSegment ? "load" : "store"}_${segment}_${selector}`, segmentMove(segment, operand, toSegment),
    ]))),
  ...wordRegisters.flatMap((register, r) => [
    [`LEA_${r}`, defineInstruction({ cpu: cpu.declaration, name: `LEA ${register.field.toUpperCase()},m (resolved)`, inputs: { offset: 16 },
      explanation: "Write the decoder's captured effective offset without accessing data memory, flags, or segments.",
      steps: [writeRegister(register, value("offset"))] })],
    ...(["es", "ds"] as const).map(segment => [`${segment === "es" ? "LES" : "LDS"}_${r}`, defineInstruction({
      cpu: cpu.declaration, name: `${segment === "es" ? "LES" : "LDS"} ${register.field.toUpperCase()},m (resolved)`, inputs: { segment: 16, offset: 16 },
      explanation: "Read the complete far pointer: offset low/high, then segment low/high, wrapping each logical offset. Only after all four reads write the general register, then the segment. Preserve flags and recognition delays.",
      steps: [...readFarPointer(),
        writeRegister(register, value("targetOffset")), writeRegister(cpu.register(segment), value("targetSegment"))],
    })]),
  ]),
  ...[false, true].map(override => [`XLAT${override ? "_override" : ""}`, defineInstruction({
    cpu: cpu.declaration, name: `XLAT${override ? " (segment override)" : ""}`,
    ...(override ? { inputs: { segment: 16 } as const } : {}),
    explanation: "Read BX then AL and wrap their sum before selecting DS or the captured override. Read one table byte, then replace AL while preserving live AH. Preserve flags; a failed read leaves AX unchanged.",
    steps: [readRegister("base", cpu.register("bx")), readSource("index", registers[0][0]!.view.source),
      capture("offset", addWrap(value("base"), extend(value("index"), 16))),
      ...(override ? [] : [readRegister("segment", cpu.register("ds"))]),
      ...byteOperands.memory.read("contents"), ...registers[0][0]!.view.write(value("contents"))],
  })]),
]);

type StringOperation = "move" | "compare" | "store" | "load" | "scan";
const stringNames = { move: "MOVS", compare: "CMPS", store: "STOS", load: "LODS", scan: "SCAS" } as const;

function stringBody(operation: StringOperation, width: 8 | 16, repeat: "once" | "repe" | "repne", override: boolean) {
  const compares = operation === "compare" || operation === "scan", repeated = repeat !== "once";
  const source = memoryOperand(width, value("sourceSegment"), value("sourceOffset"));
  const destination = memoryOperand(width, value("destinationSegment"), value("destinationOffset"));
  const accumulator = registers[width === 8 ? 0 : 1][0]!.view;
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
