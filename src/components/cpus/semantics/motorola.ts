import { addOverflow, addWrap, and, carry, halfCarry, flagValue, bitAnd, bitOr, bitXor, borrow, capture, concat, fetchByte, flagLiteral, literal, negative, not, overflow, readFlag, readMemory, readRegister, readSource, subtract, updateFlags, value, writeMemory, writeRegister, xor, zero } from "./model.ts";
import type { CpuDeclaration, Flag, FlagPolicy, InstructionDefinition, NumberExpression, Register, Statement, ValueSource, Width } from "./model.ts";
import { arithmetic, compare, immediateByte, logical, negativeZeroPolicy, readWord, shift, transfer, writeWord } from "./builders.ts";
import { defineInstruction } from "./validate.ts";
import { relativeBranch, relativeTarget, resolvedCall, subroutineCall, subroutineReturn } from "./control-flow.ts";
import type { FlowCpu, Condition } from "./control-flow.ts";
import { byteStack, wordStack } from "./stack.ts";
import { motorolaBranchNames } from "../motorola.ts";

interface MotorolaCpu {
  readonly declaration: CpuDeclaration;
  register(field: "a" | "b"): Register;
  flag(field: "n" | "z" | "v" | "c" | "h"): Flag;
}
interface UnaryPolicy {
  readonly clearReadsOperand: boolean;
  readonly testClearsCarry: boolean;
  readonly rightShiftSetsOverflow: boolean;
}

/** Shared Motorola unary meanings; each CPU declares its read, carry, and overflow differences. */
export function motorolaUnary(cpu: MotorolaCpu, rules: UnaryPolicy) {
  function unary(name: string, calculation: NumberExpression | readonly Statement[], updates: FlagPolicy["updates"], explanation: string, writeBack = true) {
    const read = name !== "CLR" || rules.clearReadsOperand;
    const nz = negativeZeroPolicy(`${cpu.declaration.name} ${name}`, cpu.flag("n"), cpu.flag("z"), 8);
    const policy: FlagPolicy = { ...nz, parameters: { ...(read ? { original: 8 as const } : {}), result: 8 }, updates: [...nz.updates, ...updates] };
    return Object.fromEntries((["a", "b", "memory"] as const).map(target => {
      const memory = target === "memory", suffix = memory ? "Memory" : target.toUpperCase();
      return [`${name.toLowerCase()}${suffix}`, defineInstruction({
        cpu: cpu.declaration, name: memory ? `${name} memory` : `${name}${suffix}`,
        ...(memory ? { inputs: { address: 16 as const } } : {}),
        explanation: [
          memory && "Entry is after successful address resolution.",
          read ? (memory ? "Read the byte at that captured address." : `Capture ${suffix}.`) : "Do not read the destination.",
          explanation, "Apply the declared flags, preserving unlisted flags.",
          writeBack ? "Then write the result once, even if unchanged." : "Do not write a result.",
          memory && read && "A failed read preserves flags and completed addressing effects.",
          memory && writeBack && "A failed write retains their updates and completed addressing effects.",
          !memory && "No data-memory access occurs.",
        ].filter(Boolean).join(" "),
        steps: [
          ...(read ? [memory ? readMemory("original", value("address")) : readRegister("original", cpu.register(target))] : []),
          ...("kind" in calculation ? [capture("result", calculation)] : calculation),
          updateFlags(policy, { ...(read ? { original: value("original") } : {}), result: value("result") }),
          ...(writeBack ? [memory ? writeMemory(value("address"), value("result")) : writeRegister(cpu.register(target), value("result"))] : []),
        ],
      })];
    }));
  }
  function shifts(name: string, direction: "left" | "right", incoming: "zero" | "sign" | Flag = "zero") {
    const operation = shift(direction, incoming), setsOverflow = direction === "left" || rules.rightShiftSetsOverflow;
    return unary(name, operation.steps, [
      { flag: cpu.flag("c"), value: operation.carry },
      ...(setsOverflow ? [{ flag: cpu.flag("v"), value: xor(negative(value("result")), operation.carry) }] : []),
    ], `Shift ${direction}, inserting `
      + (incoming === "zero" ? "zero" : incoming === "sign" ? "the original sign bit" : "the captured incoming C")
      + ". Set C from the outgoing bit. " + (setsOverflow ? "Set V to N XOR C." : "Preserve V."));
  }
  return {
    ...unary("NEG", subtract(literal(8, 0), value("original")), [
      { flag: cpu.flag("v"), value: overflow(literal(8, 0), value("original")) },
      { flag: cpu.flag("c"), value: borrow(literal(8, 0), value("original")) },
    ], "Negate the byte modulo 256. V marks original 80; C marks a nonzero original."),
    ...unary("COM", subtract(literal(8, 0xff), value("original")), [
      { flag: cpu.flag("v"), value: flagLiteral(false) }, { flag: cpu.flag("c"), value: flagLiteral(true) },
    ], "Take the byte's ones' complement: FF minus the original. Clear V and set C."),
    ...shifts("LSR", "right"), ...shifts("ROR", "right", cpu.flag("c")),
    ...shifts("ASR", "right", "sign"),
    ...shifts("ASL", "left"), ...shifts("ROL", "left", cpu.flag("c")),
    ...unary("DEC", subtract(value("original"), literal(8, 1)), [
      { flag: cpu.flag("v"), value: zero(subtract(value("original"), literal(8, 0x80))) },
    ], "Decrement modulo 256. V marks original 80; preserve C."),
    ...unary("INC", addWrap(value("original"), literal(8, 1)), [
      { flag: cpu.flag("v"), value: zero(subtract(value("original"), literal(8, 0x7f))) },
    ], "Increment modulo 256. V marks original 7F; preserve C."),
    ...unary("TST", value("original"), [
      { flag: cpu.flag("v"), value: flagLiteral(false) },
      ...(rules.testClearsCarry ? [{ flag: cpu.flag("c"), value: flagLiteral(false) }] : []),
    ], "Test the original byte, clearing V. " + (rules.testClearsCarry ? "Clear C." : "Preserve C."), false),
    ...unary("CLR", literal(8, 0), [
      { flag: cpu.flag("c"), value: flagLiteral(false) }, { flag: cpu.flag("v"), value: flagLiteral(false) },
    ], "Clear the byte. Set Z; clear N/C/V."),
  };
}

/** Ordinary byte/word comparison changes NZVC, with C meaning borrow. The original 6800 CPX supplies its own policy. */
export function motorolaComparisonFlags(cpu: MotorolaCpu, width: Width): FlagPolicy {
  const nz = negativeZeroPolicy(`${cpu.declaration.name} comparison`, cpu.flag("n"), cpu.flag("z"), width);
  return { ...nz, parameters: { left: width, right: width, result: width }, updates: [
    ...nz.updates, { flag: cpu.flag("v"), value: overflow(value("left"), value("right")) },
    { flag: cpu.flag("c"), value: borrow(value("left"), value("right")) },
  ] };
}

const immediateWord: ValueSource = { name: "immediate word, high byte first", width: 16,
  steps: [fetchByte("high"), fetchByte("low")], result: concat(value("high"), value("low")) };

/** Motorola call stacks store words high-byte-first in memory; each CPU declares what its pointer names. */
export function motorolaSubroutines(cpu: FlowCpu, pointer: Register, position: "free" | "occupied", long = false) {
  const stack = wordStack(byteStack(pointer, position), "big-endian");
  return {
    bsr: subroutineCall(cpu, "BSR", relativeTarget(cpu, immediateByte), stack),
    ...(long ? { lbsr: subroutineCall(cpu, "LBSR", relativeTarget(cpu, immediateWord), stack) } : {}),
    jsr: resolvedCall(cpu, stack), rts: subroutineReturn(cpu, "RTS", stack),
  };
}

/** Motorola cccc=tttp: capture a pair's flags in native order, then optionally invert its test. */
export function motorolaCondition(cpu: { flag(field: "n" | "z" | "v" | "c"): Flag }, code: number): Condition {
  const n = flagValue("n"), z = flagValue("z"), v = flagValue("v"), c = flagValue("c");
  // ttt selects T/HI/CC/NE/VC/PL/GE/GT; p in cccc=tttp negates the chosen test.
  const conditions: readonly Condition[] = [
    { steps: [], test: flagLiteral(true) },
    { steps: [readFlag("c", cpu.flag("c")), readFlag("z", cpu.flag("z"))], test: and(not(c), not(z)) },
    { steps: [readFlag("c", cpu.flag("c"))], test: not(c) },
    { steps: [readFlag("z", cpu.flag("z"))], test: not(z) },
    { steps: [readFlag("v", cpu.flag("v"))], test: not(v) },
    { steps: [readFlag("n", cpu.flag("n"))], test: not(n) },
    { steps: [readFlag("n", cpu.flag("n")), readFlag("v", cpu.flag("v"))], test: not(xor(n, v)) },
    { steps: [readFlag("n", cpu.flag("n")), readFlag("v", cpu.flag("v")), readFlag("z", cpu.flag("z"))], test: and(not(z), not(xor(n, v))) },
  ];
  const condition = conditions[code >> 1]!;
  return { steps: condition.steps, test: code & 1 ? not(condition.test) : condition.test };
}

/** Native condition pairs share explicit flag-read order; 6800 omits BRN and 6809 also supplies long forms. */
export function motorolaBranches(cpu: MotorolaCpu & FlowCpu, names: readonly (typeof motorolaBranchNames)[number][], long = false) {
  return Object.fromEntries(motorolaBranchNames.flatMap((name, code) => {
    if (!names.includes(name)) return [];
    const key = `${long ? "l" : ""}${name}`;
    return [[key, relativeBranch(cpu, key.toUpperCase(), long ? immediateWord : immediateByte,
      code === 0 ? undefined : motorolaCondition(cpu, code))]];
  }));
}

interface OperandForm {
  readonly memory: boolean;
  readonly word: boolean;
  readonly reads: readonly Statement[];
  readonly source: ValueSource | NumberExpression;
}

/** Construct both modes; callers place the memory reads explicitly before using the source. */
function operandFamily(cpu: MotorolaCpu, mnemonic: string, width: Width,
  body: (operand: OperandForm) => Pick<InstructionDefinition, "explanation" | "steps">, key = mnemonic.toLowerCase()) {
  const word = width === 16;
  const memoryWord = readWord("high-first", value("address"), addWrap(value("address"), literal(16, 1)));
  return Object.fromEntries((["Immediate", "Memory"] as const).map(mode => {
    const memory = mode === "Memory";
    const reads = !memory ? [] : word ? memoryWord.steps : [readMemory("byte", value("address"))];
    const source = memory ? (word ? memoryWord.result : value("byte")) : (word ? immediateWord : immediateByte);
    return [`${key}${mode}`, defineInstruction({ cpu: cpu.declaration, name: `${mnemonic} ${memory ? "memory" : word ? "#word" : "#byte"}`,
      ...(memory ? { inputs: { address: 16 as const } } : {}), ...body({ memory, word, reads, source }),
    })];
  }));
}

/** Two bodies per comparison: immediate fetching, or data reads after CPU-owned address resolution. */
export function motorolaComparison(cpu: MotorolaCpu, mnemonic: string, left: Register | ValueSource,
  flags = motorolaComparisonFlags(cpu, left.width),
  explanation = "Apply N/Z/V/C from subtraction, preserving H and control flags. C means borrow.") {
  return operandFamily(cpu, mnemonic, left.width, ({ memory, word, reads, source }) => ({
    explanation: (memory ? "Entry is after successful address resolution. Read the operand at that captured address. " : "Fetch the immediate operand. ")
      + (word ? "Read high byte then low byte, wrapping at FFFF. " : "")
      + `Only then read ${"kind" in left ? left.field.toUpperCase() : left.name}. ${explanation} Do not write a result. `
      + "A failed read leaves flags unchanged; completed fetches and addressing effects remain.",
    steps: [...reads, ...compare(left, source, flags)],
  }));
}

/** Loads, stores, transfers, and logic describe the result in N/Z, clear V, and preserve other flags. */
export function motorolaResultFlags(cpu: MotorolaCpu, operation: string, width: Width = 8): FlagPolicy {
  const nz = negativeZeroPolicy(`${cpu.declaration.name} ${operation}`, cpu.flag("n"), cpu.flag("z"), width);
  return { ...nz, updates: [...nz.updates, { flag: cpu.flag("v"), value: flagLiteral(false) }] };
}

/** Shared A/B logical families: N/Z describe the result, V clears, and BIT omits register writeback. */
export function motorolaLogic(cpu: MotorolaCpu, orMnemonic: "OR" | "ORA" = "OR") {
  const flags = motorolaResultFlags(cpu, "logic");
  return Object.fromEntries(([
    ["and", "AND", bitAnd, true], ["bit", "BIT", bitAnd, false],
    ["eor", "EOR", bitXor, true], ["or", orMnemonic, bitOr, true],
  ] as const).flatMap(([key, mnemonic, operation, writeBack]) => (["a", "b"] as const).flatMap(register =>
    Object.entries(operandFamily(cpu, `${mnemonic}${register.toUpperCase()}`, 8, ({ memory, reads, source }) => ({
      explanation: (memory ? "Entry is after successful address resolution. Read the byte at that address. " : "Fetch the immediate byte. ")
        + `Only then read ${register.toUpperCase()} and combine the captured bytes. `
        + (writeBack ? "Write the result before applying flags. " : "Do not write a result. ")
        + "Set N/Z from the result and clear V, preserving C, H, and control flags. "
        + "A failed read prevents register and flag updates; completed fetches and addressing effects remain.",
      steps: [...reads, ...logical(cpu.register(register), source, operation, flags, writeBack)],
    }), `${key}${register}`)))));
}

// A compound destination supplies explicit writes consuming "result", rather than a hidden runtime setter.
type WritableRegister = Register | { readonly source: ValueSource; readonly write: readonly Statement[]; readonly explanation: string };

/** Byte/word loads and stores share ordering; CPU-owned declarations expose compound register writes. */
export function motorolaTransfers(cpu: MotorolaCpu, suffix: string, register: WritableRegister,
  mnemonics: readonly [string, string] = ["LD", "ST"]) {
  const stored = "kind" in register, width = stored ? register.width : register.source.width, word = width === 16;
  const flags = motorolaResultFlags(cpu, "transfer", width), unit = word ? "word" : "byte";
  const write = stored ? `Write ${register.field.toUpperCase()}` : register.explanation;
  return {
    ...operandFamily(cpu, `${mnemonics[0]}${suffix}`, width, ({ memory, reads, source }) => ({
      explanation: (memory ? `Entry is after successful address resolution. Read the ${unit} at that address. ` : `Fetch the immediate ${unit}. `)
        + (word ? "Read high byte then low byte, wrapping at FFFF. " : "")
        + `${write}, then set N/Z from the captured ${unit} and clear V, preserving other flags. `
        + "A failed read prevents register and flag updates; completed fetches and addressing effects remain.",
      steps: [...reads, ...transfer(stored ? register : register.write, source, flags)],
    }), `ld${suffix.toLowerCase()}`),
    [`st${suffix.toLowerCase()}Memory`]: defineInstruction({
      cpu: cpu.declaration, name: `${mnemonics[1]}${suffix} memory`, inputs: { address: 16 },
      explanation: `Entry is after successful address resolution. Only then capture ${stored ? register.field.toUpperCase() : suffix}. `
        + (word ? "Do not read the destination; write high byte then low byte, wrapping at FFFF, even if unchanged. "
          + "Only after both writes succeed, set N/Z from the captured word and clear V, preserving other flags. "
          + "A failed write leaves flags unchanged; completed writes, fetches, and addressing effects remain."
          : "Do not read the destination; write the captured byte once, even if unchanged. "
          + "Only after a successful write, set N/Z from that byte and clear V, preserving other flags. "
          + "A failed write leaves flags unchanged; completed fetches and addressing effects remain."),
      steps: [stored ? readRegister("result", register) : readSource("result", register.source),
        ...(word ? writeWord("high-first", value("address"), addWrap(value("address"), literal(16, 1)), value("result"))
          : [writeMemory(value("address"), value("result"))]),
        updateFlags(flags, { result: value("result") })],
    }),
  };
}

/** Binary arithmetic consumes left/right, applies NZVC (and byte-addition H), and leaves writeback to the caller. */
export function motorolaArithmetic(cpu: MotorolaCpu, operation: "add" | "subtract", width: Width, withCarry = false): readonly Statement[] {
  const adding = operation === "add", left = value("left"), right = value("right");
  const incoming = withCarry ? flagValue("carry") : undefined;
  const nz = negativeZeroPolicy(`${cpu.declaration.name} ${operation}`, cpu.flag("n"), cpu.flag("z"), width);
  const flags: FlagPolicy = { ...nz, parameters: { left: width, right: width, result: width, ...(withCarry ? { carry: "flag" as const } : {}) },
    updates: [...nz.updates,
      { flag: cpu.flag("v"), value: (adding ? addOverflow : overflow)(left, right, incoming) },
      { flag: cpu.flag("c"), value: (adding ? carry : borrow)(left, right, incoming) },
      ...(adding && width === 8 ? [{ flag: cpu.flag("h"), value: halfCarry(left, right, incoming) }] : []),
    ],
  };
  return [...(withCarry ? [readFlag("carry", cpu.flag("c"))] : []), ...arithmetic(operation, flags, incoming)];
}

/** Immediate and resolved-memory arithmetic share operand-first reads, flags, then explicit register writeback. */
export function motorolaArithmeticFamily(cpu: MotorolaCpu, mnemonic: string, register: WritableRegister,
  operation: "add" | "subtract", withCarry = false) {
  const stored = "kind" in register, width = stored ? register.width : register.source.width;
  return operandFamily(cpu, mnemonic, width, ({ memory, word, reads, source }) => ({
    explanation: (memory ? "Entry is after successful address resolution. Read the operand at that address. " : "Fetch the immediate operand. ")
      + (word ? "Read high byte then low byte, wrapping at FFFF. " : "")
      + `Only then read ${stored ? register.field.toUpperCase() : register.source.name}. `
      + (withCarry ? `Capture C as the incoming ${operation === "add" ? "carry" : "borrow"}. ` : "Ignore incoming C. ")
      + `Apply N/Z/V/C from ${operation === "add" ? "addition" : "subtraction"}; C means ${operation === "add" ? "carry" : "borrow"}. `
      + (operation === "add" && !word ? "Set H from the low-nibble carry. " : "Preserve H. ")
      + `Preserve control flags. ${stored ? `Write ${register.field.toUpperCase()}` : register.explanation} after flags. `
      + "A failed read prevents arithmetic and writeback; completed fetches and addressing effects remain.",
    steps: [...reads, "kind" in source ? capture("right", source) : readSource("right", source),
      stored ? readRegister("left", register) : readSource("left", register.source),
      ...motorolaArithmetic(cpu, operation, width, withCarry),
      ...(stored ? [writeRegister(register, value("result"))] : register.write)],
  }));
}

/** A/B share SUB, SBC, ADC, and ADD; CPU opcode bindings supply their addressing modes. */
export function motorolaByteArithmetic(cpu: MotorolaCpu) {
  return Object.fromEntries((["a", "b"] as const).flatMap(register => ([
    ["SUB", "subtract", false], ["SBC", "subtract", true], ["ADC", "add", true], ["ADD", "add", false],
  ] as const).flatMap(([mnemonic, operation, withCarry]) =>
    Object.entries(motorolaArithmeticFamily(cpu, `${mnemonic}${register.toUpperCase()}`, cpu.register(register), operation, withCarry)))));
}
