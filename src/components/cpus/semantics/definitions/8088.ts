import { cpu8088StateDescription, cpu8088Status } from "../../state/8088.ts";
import { byteRegisters8088, wordRegisters8088 } from "../../8088-registers.ts";
import { opcodeFamily } from "../../opcodes.ts";
import { addOverflow, addWrap, bitAnd, bitOr, bitXor, borrow, capture, carry, concat, cpuSymbols, evenParity, flagLiteral, flagValue, halfBorrow, halfCarry,
  highByte, literal, lowByte, negative, not, overflow, projectAddress, readFlag, readMemory, readRegister, readSource, select, signExtend, subtract, updateFlags, value, writeLatch, writeMemory, writeRegister, xor, zero } from "../model.ts";
import type { InstructionDefinition, NumberExpression, Statement } from "../model.ts";
import { arithmetic, byteRegisterView, immediateByte, instructionSet, registerView, transfer } from "../builders.ts";
import { immediateWord } from "../intel.ts";
import { flagInstruction, flagPolicy, packedStatus, updateStatus } from "../status.ts";
import { defineInstruction } from "../validate.ts";
import { choose, conditional, flagCondition, relativeBranchSteps } from "../control-flow.ts";
import type { Condition } from "../control-flow.ts";

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

// Numeric keys are the encoding authority for both generated bodies and runtime bindings.
export const instructions8088 = instructionSet([
  // 00 ooo 10 w: ooo selects ADD/OR/ADC/SBB/AND/SUB/XOR/CMP; w=0 AL, w=1 AX.
  ...opcodeFamily("00 ooo 10 w", { o: operations, w: widths }, ({ o, w }) => accumulator(o, w)),
  // 0100 d rrr: d=0 INC, d=1 DEC; rrr selects AX/CX/DX/BX/SP/BP/SI/DI.
  ...opcodeFamily("0100 d rrr", { d: [false, true], r: wordRegisters8088 }, ({ d: decrement, r: register }) => defineInstruction({
    cpu: cpu.declaration, name: `${decrement ? "DEC" : "INC"} ${register.toUpperCase()}`,
    explanation: "Capture the word and CF. Add/subtract one with word wrapping; update arithmetic flags, then restore captured CF before writing the register. Preserve TF/IF/DF.",
    steps: [readRegister("left", cpu.register(register)), ...adjustmentSteps(16, decrement), writeRegister(cpu.register(register), value("result"))],
  })),
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
  // 1110 00cc: cc=00 LOOPNE, 01 LOOPE, 10 LOOP decrement CX; 11 JCXZ only tests it.
  ...opcodeFamily("1110 00 cc", { c: ["LOOPNE", "LOOPE", "LOOP", "JCXZ"] }, ({ c: name }) => defineInstruction({
    cpu: cpu.declaration, name: `${name} rel8`,
    explanation: "Fetch the displacement first. LOOP variants decrement CX, reread it, and skip ZF when it is zero; LOOP never reads ZF. JCXZ reads CX once without decrementing. Only a taken path reads and writes IP, with word wrapping. Preserve every flag.",
    steps: [readSource("offset", immediateByte),
      ...(name === "JCXZ" ? [] : [readRegister("counter", cpu.register("cx")), writeRegister(cpu.register("cx"), subtract(value("counter"), literal(16, 1)))]),
      ...conditional({ steps: [readRegister("remaining", cpu.register("cx"))], test: name === "JCXZ" ? zero(value("remaining")) : not(zero(value("remaining"))) },
        name === "LOOPNE" || name === "LOOPE" ? conditional(flagCondition(cpu.flag("zf"), name === "LOOPE"), relativeByteBranch()) : relativeByteBranch())],
  })),
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

function memoryOperand(width: 8 | 16): OperandDefinition {
  const address = (next: boolean) => projectAddress(value("segment"), next ? addWrap(value("offset"), literal(16, 1)) : value("offset"), 4, 20);
  return { name: `${width === 8 ? "byte" : "word"} [segment:offset]`, memory: true,
    read: name => width === 8 ? [readMemory(name, address(false))] : [
      readMemory(`${name}Low`, address(false)), readMemory(`${name}High`, address(true)), capture(name, concat(value(`${name}High`), value(`${name}Low`)))],
    write: contents => width === 8 ? [writeMemory(address(false), contents)] : [
      writeMemory(address(false), lowByte(contents)), writeMemory(address(true), highByte(contents))],
  };
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
