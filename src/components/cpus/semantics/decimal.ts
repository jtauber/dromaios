import { addWrap, bitAnd, bitOr, bitXor, capture, evenParity, flagLiteral, flagValue, literal,
  negative, not, or, readFlag, readRegister, replaceFlags, select, subtract, updateFlags, value, writeRegister, zero } from "./model.ts";
import type { FlagExpression, NumberExpression } from "./model.ts";
import { atLeast } from "./builders.ts";
import type { AccumulatorCpu } from "./builders.ts";
import { flagPolicy } from "./status.ts";
import { defineInstruction } from "./validate.ts";

/** Select both decimal corrections from the original byte and incoming half/full carry. */
function correction(a: NumberExpression, half: FlagExpression, carry: FlagExpression): NumberExpression {
  return bitOr(select(or(atLeast(bitAnd(a, literal(8, 0x0f)), literal(8, 10)), half), literal(8, 6), literal(8, 0)),
    select(carry, literal(8, 0x60), literal(8, 0)));
}

/** Z80 decimal adjustment; the Motorola counterparts are authored in their chapters. */
export function decimalAdjust(cpu: AccumulatorCpu) {
  const a = value("original"), result = value("result");
  const high = or(atLeast(a, literal(8, 0x9a)), flagValue("carry"));
  const sum = addWrap(a, value("correction"));
  const updates: Readonly<Record<string, FlagExpression>> = { s: negative(result), z: zero(result), h: not(zero(bitAnd(bitXor(a, result), literal(8, 0x10)))),
    pv: evenParity(result), n: flagLiteral(false), c: high };
  const policy = flagPolicy(cpu, "DAA", { original: 8, result: 8, correction: 8, carry: "flag" }, updates);
  return defineInstruction({ cpu: cpu.declaration, name: "DAA",
    explanation: "Choose low/high corrections from the original A and half/full carry, including invalid BCD inputs. "
      + "N selects subtract or add. Replace S/Z/H/PV/N/C, write A, then restore incoming N. "
      + "No instruction or data-memory access occurs.",
    steps: [readRegister("original", cpu.register("a")), readFlag("half", cpu.flag("h")), readFlag("carry", cpu.flag("c")),
      readFlag("subtract", cpu.flag("n")),
      capture("correction", correction(a, flagValue("half"), high)),
      capture("result", select(flagValue("subtract"), subtract(a, value("correction")), sum)),
      replaceFlags(policy, { original: a, result, correction: value("correction"), carry: flagValue("carry") }),
      writeRegister(cpu.register("a"), result),
      updateFlags(flagPolicy(cpu, "restore DAA N", { subtract: "flag" }, { n: flagValue("subtract") }), { subtract: flagValue("subtract") })],
  });
}
