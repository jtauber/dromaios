import { cpu6800StateDescription } from "../../state/6800.ts";
import { cpuSymbols, highByte, negative, overflow, readRegister, writeRegister, subtract, value, zero } from "../model.ts";
import type { FlagPolicy } from "../model.ts";
import { compare, registerSource, transfer } from "../builders.ts";
import { motorolaArithmetic, motorolaByteArithmetic, motorolaResultFlags, motorolaTransfers, motorolaComparison, motorolaComparisonFlags, motorolaLogic, motorolaUnary } from "../motorola.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("6800", cpu6800StateDescription);

// Original 6800 CPX: low-byte borrow never reaches the high-byte N/V calculation; C is untouched.
const indexComparison: FlagPolicy = {
  name: "6800 CPX high-byte N/V and whole-word Z", parameters: { left: 16, right: 16, result: 16 }, unlisted: "preserve",
  updates: [
    { flag: cpu.flag("n"), value: negative(subtract(highByte(value("left")), highByte(value("right")))) },
    { flag: cpu.flag("z"), value: zero(value("result")) },
    { flag: cpu.flag("v"), value: overflow(highByte(value("left")), highByte(value("right"))) },
  ],
};

export const instructions6800 = {
  ...motorolaUnary(cpu, { clearReadsOperand: false, testClearsCarry: true, rightShiftSetsOverflow: true }),
  ...motorolaByteArithmetic(cpu),
  ...motorolaLogic(cpu, "ORA"), // The original 6800 spells these ORAA/ORAB.
  ...Object.fromEntries((["a", "b"] as const).flatMap(register =>
    Object.entries(motorolaTransfers(cpu, register.toUpperCase(), cpu.register(register), ["LDA", "STA"])))),
  ...motorolaTransfers(cpu, "S", cpu.register("sp")),
  ...motorolaTransfers(cpu, "X", cpu.register("x")),
  ...Object.fromEntries((["a", "b"] as const).map(source => {
    const destination = source === "a" ? "b" : "a", name = `T${source.toUpperCase()}${destination.toUpperCase()}`;
    return [name.toLowerCase(), defineInstruction({ cpu: cpu.declaration, name,
      explanation: `Capture ${source.toUpperCase()} and write ${destination.toUpperCase()}, then set N/Z from that byte and clear V. `
        + "Preserve other flags. No data-memory access occurs.",
      steps: transfer(cpu.register(destination), registerSource(cpu.register(source)), motorolaResultFlags(cpu, "transfer")),
    })];
  })),
  ...motorolaComparison(cpu, "CMPA", cpu.register("a")),
  ...motorolaComparison(cpu, "CMPB", cpu.register("b")),
  ...motorolaComparison(cpu, "CPX", cpu.register("x"), indexComparison,
    "N/V describe high-byte subtraction without low-byte borrow; Z tests whole-word equality. Preserve H/I/C."),
  ...Object.fromEntries((["add", "subtract"] as const).map(operation => {
    const name = operation === "add" ? "ABA" : "SBA";
    return [name.toLowerCase(), defineInstruction({ cpu: cpu.declaration, name,
      explanation: "Read A then B and ignore incoming C. Set N/Z/V/C from the binary result, with C meaning "
        + (operation === "add" ? "carry; set H from the low-nibble carry. " : "borrow; preserve H. ")
        + "Preserve I. Write A after flags; B is unchanged. No data-memory access occurs.",
      steps: [readRegister("left", cpu.register("a")), readRegister("right", cpu.register("b")),
        ...motorolaArithmetic(cpu, operation, 8), writeRegister(cpu.register("a"), value("result"))],
    })];
  })),
  cba: defineInstruction({ cpu: cpu.declaration, name: "CBA", explanation: "Compare A with B without writing either register. "
    + "Set N/Z/V/C from byte subtraction, with C meaning borrow; preserve H/I. No data-memory access occurs.",
    steps: compare(cpu.register("a"), registerSource(cpu.register("b")), motorolaComparisonFlags(cpu, 8)),
  }),
};
