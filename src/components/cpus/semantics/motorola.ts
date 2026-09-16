import { addWrap, borrow, capture, flagLiteral, literal, negative, overflow, readMemory, readRegister, subtract, updateFlags, value, writeMemory, writeRegister, xor, zero } from "./model.ts";
import type { CpuDeclaration, Flag, FlagPolicy, NumberExpression, Register, Statement } from "./model.ts";
import { negativeZeroPolicy, shift } from "./builders.ts";
import { defineInstruction } from "./validate.ts";

interface UnaryCpu {
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
export function motorolaUnary(cpu: UnaryCpu, rules: UnaryPolicy) {
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
