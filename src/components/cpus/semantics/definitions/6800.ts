import { cpu6800StateDescription } from "../../state/6800.ts";
import { cpuSymbols } from "../model.ts";
import { motorolaUnary } from "../motorola.ts";

export const instructions6800 = motorolaUnary(cpuSymbols("6800", cpu6800StateDescription), {
  clearReadsOperand: false, testClearsCarry: true, rightShiftSetsOverflow: true,
});
