import { addWrap, bitAnd, bitOr, bitXor, borrow, capture, concat, fetchByte, flagLiteral, literal, negative, overflow, readMemory, readRegister, subtract, updateFlags, value, writeMemory, writeRegister, xor, zero } from "./model.ts";
import type { CpuDeclaration, Flag, FlagPolicy, NumberExpression, Register, Statement, ValueSource, Width } from "./model.ts";
import { compare, immediateByte, logical, negativeZeroPolicy, shift } from "./builders.ts";
import { defineInstruction } from "./validate.ts";

interface MotorolaCpu {
  readonly declaration: CpuDeclaration;
  register(field: "a" | "b"): Register;
  flag(field: "n" | "z" | "v" | "c"): Flag;
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

/** Two bodies per comparison: immediate fetching, or data reads after CPU-owned address resolution. */
export function motorolaComparison(cpu: MotorolaCpu, mnemonic: string, left: Register | ValueSource,
  flags = motorolaComparisonFlags(cpu, left.width),
  explanation = "Apply N/Z/V/C from subtraction, preserving H and control flags. C means borrow.") {
  const word = left.width === 16;
  return Object.fromEntries((["Immediate", "Memory"] as const).map(mode => {
    const memory = mode === "Memory";
    const reads = word ? [readMemory("high", value("address")), readMemory("low", addWrap(value("address"), literal(16, 1)))]
      : [readMemory("byte", value("address"))];
    const right = memory ? (word ? concat(value("high"), value("low")) : value("byte")) : (word ? immediateWord : immediateByte);
    return [`${mnemonic.toLowerCase()}${mode}`, defineInstruction({
      cpu: cpu.declaration, name: `${mnemonic} ${memory ? "memory" : word ? "#word" : "#byte"}`,
      ...(memory ? { inputs: { address: 16 as const } } : {}),
      explanation: (memory ? "Entry is after successful address resolution. Read the operand at that captured address. " : "Fetch the immediate operand. ")
        + (word ? "Read high byte then low byte, wrapping at FFFF. " : "")
        + `Only then read ${"kind" in left ? left.field.toUpperCase() : left.name}. ${explanation} Do not write a result. `
        + "A failed read leaves flags unchanged; completed fetches and addressing effects remain.",
      steps: [...(memory ? reads : []), ...compare(left, right, flags)],
    })];
  }));
}

/** Shared A/B logical families: N/Z describe the result, V clears, and BIT omits register writeback. */
export function motorolaLogic(cpu: MotorolaCpu, orMnemonic: "OR" | "ORA" = "OR") {
  const nz = negativeZeroPolicy(`${cpu.declaration.name} logic`, cpu.flag("n"), cpu.flag("z"), 8);
  const flags: FlagPolicy = { ...nz, updates: [...nz.updates, { flag: cpu.flag("v"), value: flagLiteral(false) }] };
  return Object.fromEntries(([
    ["and", "AND", bitAnd, true], ["bit", "BIT", bitAnd, false],
    ["eor", "EOR", bitXor, true], ["or", orMnemonic, bitOr, true],
  ] as const).flatMap(([key, mnemonic, operation, writeBack]) => (["a", "b"] as const).flatMap(register =>
    (["Immediate", "Memory"] as const).map(mode => {
      const memory = mode === "Memory", name = `${mnemonic}${register.toUpperCase()}`;
      return [`${key}${register}${mode}`, defineInstruction({
        cpu: cpu.declaration, name: `${name} ${memory ? "memory" : "#byte"}`,
        ...(memory ? { inputs: { address: 16 as const } } : {}),
        explanation: (memory ? "Entry is after successful address resolution. Read the byte at that address. " : "Fetch the immediate byte. ")
          + `Only then read ${register.toUpperCase()} and combine the captured bytes. `
          + (writeBack ? "Write the result before applying flags. " : "Do not write a result. ")
          + "Set N/Z from the result and clear V, preserving C, H, and control flags. "
          + "A failed read prevents register and flag updates; completed fetches and addressing effects remain.",
        steps: [...(memory ? [readMemory("byte", value("address"))] : []),
          ...logical(cpu.register(register), memory ? value("byte") : immediateByte, operation, flags, writeBack)],
      })];
    }))));
}
