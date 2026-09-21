import { and, flagValue, flagLiteral, not, readFlag, xor } from "./model.ts";
import type { Flag } from "./model.ts";
import type { Condition } from "./control-flow.ts";

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
