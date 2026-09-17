import { cpu6809StateDescription } from "../../state/6809.ts";
import { concat, cpuSymbols, readRegister, value } from "../model.ts";
import type { ValueSource } from "../model.ts";
import { motorolaComparison, motorolaLogic, motorolaUnary } from "../motorola.ts";

const cpu = cpuSymbols("6809", cpu6809StateDescription);

// D is a view, not an extra stored register. Read A then B only when comparison reaches its left operand.
const d: ValueSource = {
  name: "D from A:B", width: 16,
  steps: [readRegister("high", cpu.register("a")), readRegister("low", cpu.register("b"))],
  result: concat(value("high"), value("low")),
};

export const instructions6809 = {
  ...motorolaUnary(cpu, { clearReadsOperand: true, testClearsCarry: false, rightShiftSetsOverflow: false }),
  ...motorolaLogic(cpu),
  // Each memory body serves all three address modes; opcode pages and patterns remain in the CPU.
  ...Object.fromEntries((["a", "b", "d", "x", "y", "u", "s"] as const).flatMap(register =>
    Object.entries(motorolaComparison(cpu, `CMP${register.toUpperCase()}`, register === "d" ? d : cpu.register(register))))),
};
