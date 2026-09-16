import { cpu6800StateDescription } from "../../state/6800.ts";
import { cpuSymbols, highByte, negative, overflow, subtract, value, zero } from "../model.ts";
import type { FlagPolicy } from "../model.ts";
import { compare, registerSource } from "../builders.ts";
import { motorolaComparison, motorolaComparisonFlags, motorolaUnary } from "../motorola.ts";
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
  ...motorolaComparison(cpu, "CMPA", cpu.register("a")),
  ...motorolaComparison(cpu, "CMPB", cpu.register("b")),
  ...motorolaComparison(cpu, "CPX", cpu.register("x"), indexComparison,
    "N/V describe high-byte subtraction without low-byte borrow; Z tests whole-word equality. Preserve H/I/C."),
  cba: defineInstruction({ cpu: cpu.declaration, name: "CBA", explanation: "Compare A with B without writing either register. "
    + "Set N/Z/V/C from byte subtraction, with C meaning borrow; preserve H/I. No data-memory access occurs.",
    steps: compare(cpu.register("a"), registerSource(cpu.register("b")), motorolaComparisonFlags(cpu, 8)),
  }),
};
