import { cpu8088StateDescription, cpu8088Status, cpu8088StatusWord } from "../../state/8088.ts";
import { byteRegisters8088, wordRegisters8088 } from "../../8088-registers.ts";
import { opcodeFamily } from "../../opcodes.ts";
import { addOverflow, addWrap, bitAnd, bitOr, bitXor, borrow, capture, carry, concat, cpuSymbols, deferInterrupt, evenParity, extend, flagLiteral, flagValue, halfBorrow, halfCarry,
  readTest, reportInterrupt, sendEscape, divide, fetchByte, highByte, iterate, literal, lowByte, multiply, negative, not, overflow, projectAddress, readFlag, readMemory, readRegister, readSource, reject, select, shiftBits, signExtend, subtract, truncate, updateFlags, value, writeLatch, writeMemory, writeRegister, when, xor, zero } from "../model.ts";
import type { InstructionDefinition, NumberExpression, Statement, ValueSource } from "../model.ts";
import { arithmetic, atLeast, byteRegisterView, immediateByte, instructionSet, readWord, registerView, registerSource, shift, transfer, writeWord } from "../builders.ts";
import type { ShiftInput } from "../builders.ts";
import { immediateWord } from "../intel.ts";
import { flagInstruction, flagPolicy, packedStatus, restoreStatus, updateStatus } from "../status.ts";
import { defineInstruction } from "../validate.ts";
import { choose, conditional, flagCondition, relativeBranchSteps } from "../control-flow.ts";
import { segmentedWordStack, stackPush, stackPop } from "../stack.ts";
import type { Condition } from "../control-flow.ts";
import { portTransfer } from "../ports.ts";

const cpu = cpuSymbols("8088", cpu8088StateDescription);
const registers = [
  byteRegisters8088.map(({ word, shift }) => ({ name: `${word[0]}${shift === 0 ? "l" : "h"}`.toUpperCase(), immediate: immediateByte, view: byteRegisterView(cpu.register(word), shift === 0 ? "low" : "high") })),
  wordRegisters8088.map(word => ({ name: word.toUpperCase(), immediate: immediateWord, view: registerView(cpu.register(word)) })),
] as const;
const widths = [8, 16] as const;
const immediates = { 8: immediateByte, 16: immediateWord };
const operations = ["ADD", "OR", "ADC", "SBB", "AND", "SUB", "XOR", "CMP"] as const;
type Operation = typeof operations[number] | "TEST";

function resultFlags(width: 8 | 16) {
  return { zf: zero(value("result")), sf: negative(value("result")), pf: evenParity(width === 8 ? value("result") : lowByte(value("result"))) };
}

function arithmeticBody(operation: "add" | "subtract", width: 8 | 16, withCarry = false): readonly Statement[] {
  const adding = operation === "add", left = value("left"), right = value("right"), incoming = withCarry ? flagValue("carry") : undefined;
  return arithmetic(operation, flagPolicy(cpu, `8088 ${operation}`, { left: width, right: width, result: width, ...(withCarry ? { carry: "flag" as const } : {}) }, {
    cf: (adding ? carry : borrow)(left, right, incoming), af: (adding ? halfCarry : halfBorrow)(left, right, incoming),
    of: (adding ? addOverflow : overflow)(left, right, incoming), ...resultFlags(width),
  }), incoming);
}

function adjustmentSteps(width: 8 | 16, decrement: boolean): readonly Statement[] {
  return [readFlag("preservedCarry", cpu.flag("cf")), capture("right", literal(width, 1)),
    ...arithmeticBody(decrement ? "subtract" : "add", width),
    updateFlags(flagPolicy(cpu, "preserved carry", { carry: "flag" }, { cf: flagValue("carry") }), { carry: flagValue("preservedCarry") })];
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

function aluSteps(operation: Operation, width: 8 | 16, write: (contents: NumberExpression) => readonly Statement[]): readonly Statement[] {
  const withCarry = operation === "ADC" || operation === "SBB";
  const logical = operation === "OR" || operation === "AND" || operation === "XOR" || operation === "TEST";
  const logic = { OR: bitOr, AND: bitAnd, XOR: bitXor, TEST: bitAnd };
  return [
    ...(withCarry ? [readFlag("carry", cpu.flag("cf"))] : []),
    ...(logical ? [capture("result", logic[operation](value("left"), value("right"))),
      updateFlags(flagPolicy(cpu, `8088 ${operation}`, { result: width }, {
        of: flagLiteral(false), cf: flagLiteral(false), af: flagLiteral(false), ...resultFlags(width),
      }), { result: value("result") })] : arithmeticBody(operation === "ADD" || operation === "ADC" ? "add" : "subtract", width, withCarry)),
    ...(operation === "CMP" || operation === "TEST" ? [] : write(value("result")))];
}

function accumulator(operation: Operation, width: 8 | 16) {
  const destination = registers[width === 8 ? 0 : 1][0]!, withCarry = operation === "ADC" || operation === "SBB";
  const logical = operation === "OR" || operation === "AND" || operation === "XOR" || operation === "TEST";
  const writeBack = operation !== "CMP" && operation !== "TEST";
  return defineInstruction({ cpu: cpu.declaration, name: `${operation} ${destination.name},n`,
    explanation: "Fetch the complete immediate low byte first, then read the accumulator. "
      + (withCarry ? "Capture CF after both operands. " : "Do not read incoming flags. ")
      + (logical ? "Clear OF, CF, and AF in that order; AF is deterministically cleared although undefined on hardware. "
        : "Update CF, AF, and OF in that order from unsigned carry/borrow, nibble carry/borrow, and signed overflow. ")
      + "Then set ZF/SF from the full result and PF from its low byte. Preserve TF/IF/DF. "
      + (writeBack ? "Write the accumulator after flags; a byte write retains the current upper half of AX. " : "Do not write the accumulator. ")
      + "A failed fetch prevents all body effects; completed fetches and IP changes remain.",
    steps: [readSource("right", immediates[width]), readSource("left", destination.view.source),
      ...aluSteps(operation, width, destination.view.write)],
  });
}

const stack = segmentedWordStack(cpu.register("ss"), cpu.register("sp"));
const segmentRegisters = ["es", "cs", "ss", "ds"] as const;

function pushedRegister(register: typeof wordRegisters8088[number]): ValueSource {
  const source = registerView(cpu.register(register)).source;
  // Original 8088 PUSH SP captures the decremented value, before the stack's own pointer update.
  return register === "sp" ? { ...source, name: "decremented SP", result: subtract(source.result, literal(16, 2)) } : source;
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
    restoreStatus(cpu, cpu8088StatusWord, value("status"))];
}

function decimalAdjustment(subtracting: boolean, unpacked: boolean): InstructionDefinition {
  const operation = subtracting ? subtract : addWrap;
  const finish = (low: boolean, high = false): readonly Statement[] => unpacked ? [
    writeRegister(cpu.register("ax"), concat(operation(value("high"), literal(8, low ? 1 : 0)),
      bitAnd(operation(value("original"), literal(8, low ? 6 : 0)), literal(8, 15)))),
    updateFlags(flagPolicy(cpu, "unpacked adjustment", {}, { cf: flagLiteral(low), af: flagLiteral(low) }), {}),
  ] : [
    capture("result", operation(value("original"), literal(8, (low ? 6 : 0) + (high ? 0x60 : 0)))),
    updateFlags(flagPolicy(cpu, "decimal correction", {}, { af: flagLiteral(low), cf: flagLiteral(high) }), {}),
    ...registers[0][0]!.view.write(value("result")),
    updateFlags(flagPolicy(cpu, "decimal result", { result: 8 }, resultFlags(8)), { result: value("result") }),
  ];
  const adjusted = (low: boolean) => unpacked ? finish(low) : choose({
    steps: [readFlag("highAF", cpu.flag("af"))],
    test: atLeast(value("original"), select(flagValue("highAF"), literal(8, 0xa0), literal(8, 0x9a))),
  }, finish(low, true), choose({ steps: [readFlag("highCF", cpu.flag("cf"))], test: flagValue("highCF") }, finish(low, true), finish(low)));
  return defineInstruction({ cpu: cpu.declaration, name: unpacked ? (subtracting ? "AAS" : "AAA") : (subtracting ? "DAS" : "DAA"),
    explanation: "Capture AL first and retain short-circuit AF/CF reads. " + (unpacked
      ? "Capture AH separately; adjust each byte independently, mask AL to its low nibble, write AX, then CF and AF. Preserve undefined result flags."
      : "The original 8088 high-digit threshold is 9F when AF is set, otherwise 99. Apply AF then CF, write AL preserving live AH, then ZF/SF/PF; preserve OF and control flags."),
    steps: [readSource("original", registers[0][0]!.view.source), ...(unpacked ? [readSource("high", registers[0][4]!.view.source)] : []),
      ...choose({ steps: [], test: atLeast(bitAnd(value("original"), literal(8, 15)), literal(8, 10)) }, adjusted(true),
        choose({ steps: [readFlag("lowAF", cpu.flag("af"))], test: flagValue("lowAF") }, adjusted(true), adjusted(false)))],
  });
}

function radixAdjustment(beforeDivision: boolean): InstructionDefinition {
  return defineInstruction({ cpu: cpu.declaration, name: beforeDivision ? "AAD" : "AAM",
    explanation: "Fetch and require the documented 0A radix before reading AX. " + (beforeDivision
      ? "Capture AL, then live AH; combine AH * 10 + AL modulo 256 and clear AH. "
      : "Divide AL by ten, storing the quotient in AH and remainder in AL. ")
      + "After writing AX, reread AL for ZF/SF/PF. Preserve undefined CF/AF/OF and control flags.",
    steps: [fetchByte("radix"), when(not(zero(subtract(value("radix"), literal(8, 10)))), [reject("opcode")]),
      readSource("low", registers[0][0]!.view.source), ...(beforeDivision ? [
        readSource("high", registers[0][4]!.view.source),
        writeRegister(cpu.register("ax"), extend(truncate(addWrap(multiply(value("high"), literal(8, 10)), extend(value("low"), 16)), 8), 16)),
      ] : [divide({ quotient: "quotient", remainder: "remainder", dividend: extend(value("low"), 16), divisor: literal(8, 10), signed: false, onError: "divide-error" }),
        writeRegister(cpu.register("ax"), concat(value("quotient"), value("remainder")))]),
      readSource("result", registers[0][0]!.view.source),
      updateFlags(flagPolicy(cpu, "radix result", { result: 8 }, resultFlags(8)), { result: value("result") })],
  });
}

function interruptEntry(vector: NumberExpression): readonly Statement[] {
  const offset = shiftBits(extend(vector, 16), "left", 2);
  return [...memoryOperand(16, literal(16, 0), offset).read("targetOffset"),
    ...memoryOperand(16, literal(16, 0), addWrap(offset, literal(16, 2))).read("targetSegment"),
    readSource("savedFlags", packedStatus(cpu, cpu8088StatusWord)),
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

// Numeric keys are the encoding authority for both generated bodies and runtime bindings.
export const instructions8088 = instructionSet([
  // 000 ss 11p: ss=ES/CS/SS/DS; p=0 PUSH, p=1 POP, with POP CS undocumented.
  ...opcodeFamily("000 ss 110", { s: segmentRegisters }, ({ s }) =>
    stackPush(cpu.declaration, "PUSH " + s.toUpperCase(), stack, registerView(cpu.register(s)).source)),
  [0x07, popSegment("es")], [0x17, popSegment("ss")], [0x1f, popSegment("ds")],
  // 00 ooo 10 w: ooo selects ADD/OR/ADC/SBB/AND/SUB/XOR/CMP; w=0 AL, w=1 AX.
  ...opcodeFamily("00 ooo 10 w", { o: operations, w: widths }, ({ o, w }) => accumulator(o, w)),
  // 001 u s 111: u=0 packed (DAA/DAS), u=1 unpacked (AAA/AAS); s=0 add/1 subtract.
  ...opcodeFamily("001 u s 111", { u: [false, true], s: [false, true] }, ({ u, s }) => decimalAdjustment(s, u)),
  // 0100 d rrr: d=0 INC, d=1 DEC; rrr selects AX/CX/DX/BX/SP/BP/SI/DI.
  ...opcodeFamily("0100 d rrr", { d: [false, true], r: wordRegisters8088 }, ({ d: decrement, r: register }) => defineInstruction({
    cpu: cpu.declaration, name: `${decrement ? "DEC" : "INC"} ${register.toUpperCase()}`,
    explanation: "Capture the word and CF. Add/subtract one with word wrapping; update arithmetic flags, then restore captured CF before writing the register. Preserve TF/IF/DF.",
    steps: [readRegister("left", cpu.register(register)), ...adjustmentSteps(16, decrement), writeRegister(cpu.register(register), value("result"))],
  })),
  // 0101 p rrr: p=0 PUSH/1 POP; rrr selects AX/CX/DX/BX/SP/BP/SI/DI.
  ...opcodeFamily("0101 p rrr", { p: [false, true], r: wordRegisters8088 }, ({ p: pop, r }) => pop
    ? stackPop(cpu.declaration, "POP " + r.toUpperCase(), stack, cpu.register(r))
    : stackPush(cpu.declaration, "PUSH " + r.toUpperCase(), stack, pushedRegister(r))),
  // 0111 ttt p: ttt selects the positive condition; p=1 inverts it without changing flag-read order.
  ...opcodeFamily("0111 ttt p", { t: branchConditions, p: [0, 1] }, ({ t: condition, p: invert }) => defineInstruction({
    cpu: cpu.declaration, name: `${condition.names[invert]} rel8`,
    explanation: "Fetch the signed displacement before testing flags. Preserve short-circuit flag reads; only a taken path reads and writes post-fetch IP. Wrap IP within CS and preserve flags and control state.",
    steps: [readSource("offset", immediateByte), ...condition.decide(invert ? [] : relativeByteBranch(), invert ? relativeByteBranch() : [])],
  })),
  // 1001 0 rrr: exchange AX with the selected word; rrr=000 is the documented NOP.
  ...opcodeFamily("1001 0 rrr", { r: wordRegisters8088 }, ({ r: register }) => defineInstruction({
    cpu: cpu.declaration, name: register === "ax" ? "NOP" : `XCHG AX,${register.toUpperCase()}`,
    explanation: "Capture the selected register before AX, then write AX before the selected register. NOP retains the same self-exchange schedule. Do not access flags or memory.",
    steps: [readRegister("selected", cpu.register(register)), readRegister("accumulator", cpu.register("ax")),
      writeRegister(cpu.register("ax"), value("selected")), writeRegister(cpu.register(register), value("accumulator"))],
  })),
  // 1001 100s: CBW sign-extends AL to AX; CWD extends AX's sign into DX.
  ...opcodeFamily("1001 100 s", { s: [false, true] }, ({ s: word }) => defineInstruction({
    cpu: cpu.declaration, name: word ? "CWD" : "CBW",
    explanation: word ? "Capture AX, then fill DX with its sign bit without changing AX or flags." : "Capture AL and sign-extend it to replace AX without accessing flags.",
    steps: [readRegister("word", cpu.register("ax")), writeRegister(cpu.register(word ? "dx" : "ax"), word
      ? select(negative(value("word")), literal(16, 0xffff), literal(16, 0)) : signExtend(lowByte(value("word")), 16))],
  })),
  // 1001 1010: far CALL fetches the full pointer before either return-address push.
  [0x9a, defineInstruction({ cpu: cpu.declaration, name: "CALL ptr16:16",
    explanation: "Fetch offset then segment, low byte first. Push live CS then IP; capture IP only after the CS push. Commit CS:IP after both pushes. " + stack.explanation,
    steps: [readSource("targetOffset", immediateWord), readSource("targetSegment", immediateWord), ...farTransfer(true)] })],
  [0x9b, waitInstruction(false)], // 1001 1011: sample TEST before the next coprocessor instruction.
  // 1001 110p: p=0 pushes packed FLAGS; p=1 restores them after a complete pop.
  [0x9c, stackPush(cpu.declaration, "PUSHF", stack, packedStatus(cpu, cpu8088StatusWord))],
  [0x9d, defineInstruction({ cpu: cpu.declaration, name: "POPF",
    explanation: "Pop the complete FLAGS word, then read live IF. A 0-to-1 transition requests INTR deferral before replacing the flag object. Ignore reserved bits. " + stack.explanation,
    steps: restoreFlagsSteps() })],
  // 1001 111d: d=0 stores AH's modeled flags; d=1 loads their packed byte into AH.
  [0x9e, defineInstruction({ cpu: cpu.declaration, name: "SAHF",
    explanation: "Capture AH, then update CF/PF/AF/ZF/SF in layout order, ignoring reserved bits. Preserve the flag object, OF/TF/IF/DF, registers, and control state.",
    steps: [readRegister("word", cpu.register("ax")), updateStatus(cpu, cpu8088Status, highByte(value("word")))] })],
  [0x9f, defineInstruction({ cpu: cpu.declaration, name: "LAHF",
    explanation: "Read CF/PF/AF/ZF/SF in layout order and pack SF:ZF:0:AF:0:PF:1:CF into AH. Preserve the live AL byte at writeback and leave every flag unchanged.",
    steps: [readSource("status", packedStatus(cpu, cpu8088Status)), ...registers[0][4]!.view.write(value("status"))] })],
  // 1010 100 w: TEST AL/AX,n sets logical flags without accumulator writeback.
  ...opcodeFamily("1010 100 w", { w: widths }, ({ w }) => accumulator("TEST", w)),
  // 1011 w rrr: w=0 AL/CL/DL/BL/AH/CH/DH/BH; w=1 AX/CX/DX/BX/SP/BP/SI/DI.
  ...opcodeFamily("1011 w rrr", { w: registers, r: [0, 1, 2, 3, 4, 5, 6, 7] }, ({ w, r }) => {
    const { name, view, immediate } = w[r]!;
    return defineInstruction({ cpu: cpu.declaration, name: `MOV ${name},n`,
      explanation: "Fetch the complete immediate low byte first, then write the destination. A byte write retains the current other half of its stored word. Do not access flags. A failed fetch leaves the destination untouched.",
      steps: transfer(view.write(value("result")), immediate),
    });
  }),
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
  // 1101 010d: d=0 AAM/1 AAD; only the documented second byte 0A is accepted.
  ...opcodeFamily("1101 010 d", { d: [false, true] }, ({ d }) => radixAdjustment(d)),
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
  readonly write: (contents: NumberExpression, captureName: string) => readonly Statement[];
}

function registerOperands(width: 8 | 16): readonly OperandDefinition[] {
  return registers[width === 8 ? 0 : 1].map(({ name, view }) => ({ name, read: name => [readSource(name, view.source)], write: view.write }));
}

function memoryOperand(width: 8 | 16, segment = value("segment"), offset = value("offset")): OperandDefinition {
  const address = (next: boolean) => projectAddress(segment, next ? addWrap(offset, literal(16, 1)) : offset, 4, 20);
  return { name: `${width === 8 ? "byte" : "word"} [segment:offset]`, memory: true,
    read: name => {
      if (width === 8) return [readMemory(name, address(false))];
      const word = readWord("low-first", address(false), address(true), `${name}Low`, `${name}High`);
      return [...word.steps, capture(name, word.result)];
    },
    write: contents => width === 8 ? [writeMemory(address(false), contents)] : writeWord("low-first", address(false), address(true), contents),
  };
}

function readFarPointer(): readonly Statement[] {
  return [...memoryOperand(16).read("targetOffset"),
    ...memoryOperand(16, value("segment"), addWrap(value("offset"), literal(16, 2))).read("targetSegment")];
}

function transferDefinition(destination: OperandDefinition, source: Pick<OperandDefinition, "name" | "memory">, steps: readonly Statement[], exchange = false): InstructionDefinition {
  const memory = destination.memory || source.memory;
  return defineInstruction({ cpu: cpu.declaration, name: `${exchange ? "XCHG" : "MOV"} ${destination.name},${source.name} (resolved)`,
    ...(memory ? { inputs: { segment: 16, offset: 16 } as const } : {}),
    explanation: "Enter after successful operand resolution. "
      + (exchange ? "Read the r/m operand before the register, then write r/m before the register. Capture both values before either write. "
        : "Read the complete source before writing the destination; never read a memory destination. ")
      + (memory ? "Use the captured segment and offset for every access. Transfer low byte first; wrap each byte's offset to 16 bits before computing (segment * 16 + offset) modulo 2^20. " : "No memory access occurs. ")
      + "Byte-register writes preserve the current other half at each writeback, including overlapping views. Preserve all flags and control state. Failed effects retain completed reads/writes and prevent later effects.",
    steps,
  });
}

function moveBody(destination: OperandDefinition, source: Pick<OperandDefinition, "name" | "read" | "memory">) {
  return transferDefinition(destination, source, [...source.read("right"), ...destination.write(value("right"), "destinationWord")]);
}

function exchangeBody(left: OperandDefinition, right: OperandDefinition) {
  return transferDefinition(left, right, [...left.read("left"), ...right.read("right"),
    ...left.write(value("right"), "destinationWord"), ...right.write(value("left"), "sourceWord")], true);
}

/** Specialized register choices; memory bodies share every decoder-resolved addressing mode. */
export const transfers8088: Readonly<Record<string, InstructionDefinition>> = Object.fromEntries(widths.flatMap(width => {
  const operands = registerOperands(width);
  const memory = memoryOperand(width);
  return [
    ...operands.flatMap((destination, d) => operands.flatMap((source, s) => [
      [`move_${width}_${d}_${s}`, moveBody(destination, source)], [`exchange_${width}_${d}_${s}`, exchangeBody(destination, source)],
    ])),
    ...operands.flatMap((register, r) => [
      [`load_${width}_${r}`, moveBody(register, memory)], [`store_${width}_${r}`, moveBody(memory, register)],
      [`exchangeMemory_${width}_${r}`, exchangeBody(memory, register)],
    ]),
    [`immediate_${width}`, moveBody(memory, { name: "n", read: name => [readSource(name, immediates[width])] })],
  ];
}));

function aluDefinition(operation: Operation, width: 8 | 16, destination: OperandDefinition, source: Pick<OperandDefinition, "name" | "read" | "memory">): InstructionDefinition {
  return defineInstruction({ cpu: cpu.declaration, name: `${operation} ${destination.name},${source.name} (resolved)`,
    ...(destination.memory || source.memory ? { inputs: { segment: 16, offset: 16 } as const } : {}),
    explanation: "Enter after successful operand resolution. Read the complete source before the destination, then capture CF for ADC/SBB. "
      + "Transfer low byte first, wrapping each logical offset before physical projection. Update arithmetic CF/AF/OF or clear logical OF/CF/AF, then ZF/SF/PF; word parity uses the low byte. "
      + (operation === "CMP" || operation === "TEST" ? "Do not write either operand. " : "Write the destination after flags; byte views retain their live other half. ")
      + "Preserve TF/IF/DF and control state. Failed effects retain every completed read, flag update, and byte write.",
    steps: [...source.read("right"), ...destination.read("left"), ...aluSteps(operation, width, contents => destination.write(contents, "preservedWord"))],
  });
}

/** ModR/M ALU bodies share resolved operands with MOV/XCHG and flags with the accumulator forms. */
export const alu8088: Readonly<Record<string, InstructionDefinition>> = Object.fromEntries(widths.flatMap(width => {
  const operands = registerOperands(width), memory = memoryOperand(width);
  return [...operations, "TEST" as const].flatMap(operation => [
    ...operands.flatMap((destination, d) => operands.map((source, s) =>
      [`${operation}_${width}_${d}_${s}`, aluDefinition(operation, width, destination, source)])),
    ...operands.flatMap((register, r) => [
      [`${operation}_toMemory_${width}_${r}`, aluDefinition(operation, width, memory, register)],
      ...(operation === "TEST" ? [] : [[`${operation}_fromMemory_${width}_${r}`, aluDefinition(operation, width, register, memory)]]),
    ]),
    ...[...operands, memory].flatMap((destination, r) => {
      const selector = destination.memory ? "memory" : r;
      const immediate = { name: "n", read: (name: string) => [readSource(name, immediates[width])] };
      return [
        [`${operation}_immediate_${width}_${selector}`, aluDefinition(operation, width, destination, immediate)],
        ...(width !== 16 || !["ADD", "ADC", "SBB", "SUB", "CMP"].includes(operation) ? [] : [
          [`${operation}_signed_${width}_${selector}`, aluDefinition(operation, width, destination,
            { name: "sign-extended n8", read: (name: string) => [readSource("immediate", immediateByte), capture(name, signExtend(value("immediate"), 16))] })],
        ]),
      ];
    }),
  ]);
}));

/** INC/DEC restore captured CF before writeback; NOT has no flag effects and NEG uses ordinary subtraction flags. */
export const unary8088: Readonly<Record<string, InstructionDefinition>> = Object.fromEntries(widths.flatMap(width =>
  ["INC", "DEC", "NOT", "NEG"].flatMap(operation => [...registerOperands(width), memoryOperand(width)].map((operand, r) => [
    `${operation}_${width}_${operand.memory ? "memory" : r}`, defineInstruction({
      cpu: cpu.declaration, name: `${operation} ${operand.name} (resolved)`,
      ...(operand.memory ? { inputs: { segment: 16, offset: 16 } as const } : {}),
      explanation: "Enter after operand resolution and read the complete operand low byte first. "
        + (operation === "NOT" ? "Complement every operand bit without reading or writing flags. "
          : operation === "NEG" ? "Subtract the operand from zero and update CF/AF/OF/ZF/SF/PF before writing. "
            : "Capture CF after the operand. Add/subtract one, update arithmetic flags, then restore CF before writing. ")
        + "A byte write preserves its live other half; word memory writes wrap each offset before projection. Failed effects retain completed flags and writes; preserve control state.",
      steps: operation === "NOT" ? [...operand.read("operand"), ...operand.write(bitXor(value("operand"), literal(width, 2 ** width - 1)), "preservedWord")]
        : [...operand.read(operation === "NEG" ? "right" : "left"),
          ...(operation === "NEG" ? [capture("left", literal(width, 0)), ...arithmeticBody("subtract", width)] : adjustmentSteps(width, operation === "DEC")),
          ...operand.write(value("result"), "preservedWord")],
    }),
  ]))));

// D0-D3 + mm ooo rrr: each selector describes a single bit movement; /6 is undocumented.
const shiftOperations: readonly (readonly [string, "left" | "right", ShiftInput] | undefined)[] = [
  ["ROL", "left", "outgoing"],     // 000: rotate the outgoing bit into bit 0.
  ["ROR", "right", "outgoing"],    // 001: rotate the outgoing bit into the top bit.
  ["RCL", "left", cpu.flag("cf")], // 010: insert live carry at bit 0.
  ["RCR", "right", cpu.flag("cf")], // 011: insert live carry at the top bit.
  ["SHL", "left", "zero"],         // 100: shift in zero at bit 0.
  ["SHR", "right", "zero"],        // 101: shift in zero at the top bit.
  undefined,                     // 110: undocumented.
  ["SAR", "right", "sign"],        // 111: preserve the sign bit.
];

function shiftedOperand(width: 8 | 16, selector: number, useCL: boolean, operand: OperandDefinition): InstructionDefinition {
  const [name, direction, incoming] = shiftOperations[selector]!, bit = shift(direction, incoming);
  const result = [updateFlags(flagPolicy(cpu, "shift result", { result: width }, { ...resultFlags(width), af: flagLiteral(false) }), { result: value("shifted") })];
  return defineInstruction({ cpu: cpu.declaration, name: `${name} ${operand.name},${useCL ? "CL" : "1"} (resolved)`,
    ...(operand.memory ? { inputs: { segment: 16, offset: 16 } as const } : {}),
    explanation: (useCL ? "Capture the full eight-bit CL count before reading the resolved operand. " : "Read the resolved operand and move it one bit. ")
      + "Each iteration moves one bit and writes CF; through-carry forms reread CF each time. "
      + "Only count one updates OF, from the changed sign bit. Nonzero shifts set ZF/SF/PF and clear undefined AF; rotates preserve them. "
      + "Count zero still reads and writes the unchanged operand, preserving all flags. Write back after flags, retaining live byte halves and completed memory writes on failure.",
    steps: [...(useCL ? [readSource("count", registers[0][1]!.view.source)] : [capture("count", literal(8, 1))]), ...operand.read("operand"),
      iterate("shifted", value("count"), value("operand"), [capture("original", value("shifted")), ...bit.steps,
        updateFlags(flagPolicy(cpu, "outgoing shift bit", { original: width }, { cf: bit.carry }), { original: value("original") })], value("result")),
      when(zero(subtract(value("count"), literal(8, 1))), [updateFlags(flagPolicy(cpu, "one-bit overflow", { before: width, after: width },
        { of: negative(bitXor(value("before"), value("after"))) }), { before: value("operand"), after: value("shifted") })]),
      ...(selector < 4 ? [] : useCL ? [when(not(zero(value("count"))), result)] : result),
      ...operand.write(value("shifted"), "preservedWord")],
  });
}

function productOrQuotient(width: 8 | 16, operation: "MUL" | "IMUL" | "DIV" | "IDIV", operand: OperandDefinition): InstructionDefinition {
  const signed = operation.startsWith("I"), dividing = operation.endsWith("DIV"), wide = width === 8 ? 16 : 32;
  const low = (contents: NumberExpression) => truncate(contents, width);
  const high = (contents: NumberExpression) => truncate(shiftBits(contents, "right", width), width);
  const product = value("product"), overflow = signed ? not(zero(bitXor(product, signExtend(low(product), wide)))) : not(zero(high(product)));
  return defineInstruction({ cpu: cpu.declaration, name: `${operation} ${operand.name} (resolved)`,
    ...(operand.memory ? { inputs: { segment: 16, offset: 16 } as const } : {}),
    explanation: "Read the complete resolved source before the accumulator, retaining low-first segmented reads. " + (dividing
      ? "Divide AX or DX:AX with a quotient truncated toward zero and a remainder following the dividend sign. Reject zero divisors and overflow before register writes; original signed 8088 division also rejects the most negative quotient. Write AL/AH or AX then DX; preserve every flag. The CPU boundary delivers divide-error outcomes."
      : "Form the complete signed/unsigned product. Write AX, then DX for words, then OF and CF according to whether the product fits the original operand width. Preserve all other flags."),
    steps: [...operand.read("operand"), ...(dividing ? [
      ...(width === 8 ? [readRegister("dividend", cpu.register("ax"))] : [readRegister("high", cpu.register("dx")), readRegister("low", cpu.register("ax")), capture("dividend", concat(value("high"), value("low")))]),
      divide({ quotient: "quotient", remainder: "remainder", dividend: value("dividend"), divisor: value("operand"), signed, onError: "divide-error" }),
      ...(signed ? [when(zero(bitXor(value("quotient"), literal(width, 2 ** (width - 1)))), [reject("divide-error")])] : []),
      writeRegister(cpu.register("ax"), width === 8 ? concat(value("remainder"), value("quotient")) : value("quotient")),
      ...(width === 16 ? [writeRegister(cpu.register("dx"), value("remainder"))] : []),
    ] : [readSource("accumulator", registers[width === 8 ? 0 : 1][0]!.view.source), capture("product", multiply(value("accumulator"), value("operand"), signed)),
      writeRegister(cpu.register("ax"), width === 8 ? product : low(product)), ...(width === 16 ? [writeRegister(cpu.register("dx"), high(product))] : []),
      updateFlags(flagPolicy(cpu, "product overflow", { product: wide }, { of: overflow, cf: overflow }), { product })])],
  });
}

/** 1101 00vw shifts and 1111 011w /4-7 products/quotients share resolved register and memory operands. */
export const arithmetic8088: Readonly<Record<string, InstructionDefinition>> = Object.fromEntries(widths.flatMap(width =>
  [...registerOperands(width), memoryOperand(width)].flatMap((operand, r) => {
    const target = `${width}_${operand.memory ? "memory" : r}`;
    return [
      ...shiftOperations.flatMap((operation, selector) => operation ? [false, true].map(useCL =>
        [`shift_${selector}_${useCL ? "cl" : "one"}_${target}`, shiftedOperand(width, selector, useCL, operand)]) : []),
      ...(["MUL", "IMUL", "DIV", "IDIV"] as const).map(operation => [`${operation}_${target}`, productOrQuotient(width, operation, operand)]),
    ];
  })));


/** Resolved stack/control operands; register PUSH/POP reuse their short-encoding bodies. */
export const stack8088: Readonly<Record<string, InstructionDefinition>> = Object.fromEntries([
  ["PUSH_memory", defineInstruction({ cpu: cpu.declaration, name: "PUSH word [segment:offset] (resolved)", inputs: { segment: 16, offset: 16 },
    explanation: "Read the complete resolved source before adjusting SP or writing the stack. " + stack.explanation,
    steps: [...memoryOperand(16).read("word"), ...stack.push(value("word"))] })],
  ["POP_memory", defineInstruction({ cpu: cpu.declaration, name: "POP word [segment:offset] (resolved)", inputs: { segment: 16, offset: 16 },
    explanation: "Enter with the destination resolved before the pop. Capture the complete stack word, increment SP, then write the destination low/high without reading it. " + stack.explanation,
    steps: [readSource("word", stack.pop), ...memoryOperand(16).write(value("word"), "unused")] })],
  ...[...registerOperands(16), memoryOperand(16)].flatMap((operand, r) => [false, true].map(call => [
    (call ? "CALL_" : "JMP_") + (operand.memory ? "memory" : r), defineInstruction({
      cpu: cpu.declaration, name: (call ? "CALL " : "JMP ") + operand.name + " (resolved)",
      ...(operand.memory ? { inputs: { segment: 16, offset: 16 } as const } : {}),
      explanation: "Capture the complete target before any stack writes. " + (call
        ? "Capture and push return IP, then write the captured target. " + stack.explanation : "Write IP without reading the instruction at the target or accessing the stack. Preserve flags."),
      steps: [...operand.read("target"), ...(call ? [readRegister("returnIP", cpu.register("ip")), ...stack.push(value("returnIP"))] : []),
        writeRegister(cpu.register("ip"), value("target"))],
    }),
  ])),
  ...[false, true].map(call => [(call ? "CALL" : "JMP") + "_far_memory", defineInstruction({
    cpu: cpu.declaration, name: (call ? "CALL" : "JMP") + " far [segment:offset] (resolved)", inputs: { segment: 16, offset: 16 },
    explanation: "Read offset then segment, low byte first, using the captured pointer address with wrapping offsets. Capture all four bytes before stack writes or target changes. "
      + (call ? "Push live CS then IP before committing the target. " + stack.explanation : "Write CS then IP; preserve SP and flags."),
    steps: [...readFarPointer(), ...farTransfer(call)],
  })]),
]);

// Segment writes from MOV have the same inhibition policy as POP; LES/LDS do not request it.
function segmentMove(segment: typeof segmentRegisters[number], operand: OperandDefinition, toSegment: boolean) {
  return defineInstruction({ cpu: cpu.declaration,
    name: `MOV ${toSegment ? segment.toUpperCase() + "," + operand.name : operand.name + "," + segment.toUpperCase()} (resolved)`,
    ...(operand.memory ? { inputs: { segment: 16, offset: 16 } as const } : {}),
    explanation: "Resolve the operand before reading the source. Transfer the complete word low byte first with logical offset wrapping. "
      + (toSegment ? "Write the segment, then request all-interrupt inhibition at successful retirement. " : "Capture the segment before writing the destination. ")
      + "Preserve flags. Failed effects retain completed byte transfers and prevent later effects.",
    steps: toSegment ? [...operand.read("contents"), writeRegister(cpu.register(segment), value("contents")), deferInterrupt("all")]
      : [readRegister("contents", cpu.register(segment)), ...operand.write(value("contents"), "unused")],
  });
}

/** Remaining transfers: resolved segment moves and address loads, plus XLAT's live table lookup. */
export const addressing8088: Readonly<Record<string, InstructionDefinition>> = Object.fromEntries([
  ...segmentRegisters.flatMap(segment => [...registerOperands(16), memoryOperand(16)].flatMap((operand, r) =>
    [false, true].filter(toSegment => !toSegment || segment !== "cs").map(toSegment => [
      `segment_${toSegment ? "load" : "store"}_${segment}_${operand.memory ? "memory" : r}`, segmentMove(segment, operand, toSegment),
    ]))),
  ...wordRegisters8088.flatMap((register, r) => [
    [`LEA_${r}`, defineInstruction({ cpu: cpu.declaration, name: `LEA ${register.toUpperCase()},m (resolved)`, inputs: { offset: 16 },
      explanation: "Write the decoder's captured effective offset without accessing data memory, flags, or segments.",
      steps: [writeRegister(cpu.register(register), value("offset"))] })],
    ...(["es", "ds"] as const).map(segment => [`${segment === "es" ? "LES" : "LDS"}_${r}`, defineInstruction({
      cpu: cpu.declaration, name: `${segment === "es" ? "LES" : "LDS"} ${register.toUpperCase()},m (resolved)`, inputs: { segment: 16, offset: 16 },
      explanation: "Read the complete far pointer: offset low/high, then segment low/high, wrapping each logical offset. Only after all four reads write the general register, then the segment. Preserve flags and recognition delays.",
      steps: [...readFarPointer(),
        writeRegister(cpu.register(register), value("targetOffset")), writeRegister(cpu.register(segment), value("targetSegment"))],
    })]),
  ]),
  ...[false, true].map(override => [`XLAT${override ? "_override" : ""}`, defineInstruction({
    cpu: cpu.declaration, name: `XLAT${override ? " (segment override)" : ""}`,
    ...(override ? { inputs: { segment: 16 } as const } : {}),
    explanation: "Read BX then AL and wrap their sum before selecting DS or the captured override. Read one table byte, then replace AL while preserving live AH. Preserve flags; a failed read leaves AX unchanged.",
    steps: [readRegister("base", cpu.register("bx")), readSource("index", registers[0][0]!.view.source),
      capture("offset", addWrap(value("base"), extend(value("index"), 16))),
      ...(override ? [] : [readRegister("segment", cpu.register("ds"))]),
      ...memoryOperand(8).read("contents"), ...registers[0][0]!.view.write(value("contents"))],
  })]),
]);

type StringOperation = "move" | "compare" | "store" | "load" | "scan";
const stringNames = { move: "MOVS", compare: "CMPS", store: "STOS", load: "LODS", scan: "SCAS" } as const;

function stringBody(operation: StringOperation, width: 8 | 16, repeat: "once" | "repe" | "repne", override: boolean) {
  const compares = operation === "compare" || operation === "scan", repeated = repeat !== "once";
  const source = memoryOperand(width, value("sourceSegment"), value("sourceOffset"));
  const destination = memoryOperand(width, value("destinationSegment"), value("destinationOffset"));
  const accumulator = registers[width === 8 ? 0 : 1][0]!.view;
  const compare = (left: readonly Statement[]) => [...left, ...destination.read("right"), ...arithmeticBody("subtract", width)];
  const transfers = {
    move: [...source.read("contents"), ...destination.write(value("contents"), "unused")],
    compare: compare(source.read("left")),
    store: [readSource("contents", accumulator.source), ...destination.write(value("contents"), "unused")],
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
