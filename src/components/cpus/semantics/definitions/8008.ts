import { cpu8008StateDescription } from "../../state/8008.ts";
import { bitAnd, borrow, carry, concat, cpuSymbols, evenParity, flagLiteral, flagValue, literal, negative, readMemory, readRegister, readSource, value, zero } from "../model.ts";
import type { FlagPolicy, ValueSource } from "../model.ts";
import { immediateByte, registerSource } from "../builders.ts";
import { intelByteAlu } from "../intel.ts";
import type { IntelByteOperation } from "../intel.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("8008", cpu8008StateDescription);
const throughHL: ValueSource = { name: "memory through low 14 bits of HL", width: 8, steps: [
  readRegister("high", cpu.register("h")), readRegister("low", cpu.register("l")),
  readMemory("byte", bitAnd(concat(value("high"), value("low")), literal(16, 0x3fff))),
], result: value("byte") };
// The 8008's sss order is A/B/C/D/E/H/L/M, unlike the 8080/Z80. Immediate is a separate encoding.
const sources = [
  ...(["a", "b", "c", "d", "e", "h", "l"] as const).map(name => [name.toUpperCase(), registerSource(cpu.register(name))] as const),
  ["M", throughHL], ["byte", immediateByte],
] as const;

function family(mnemonic: string, operation: IntelByteOperation, withCarry = false) {
  const adding = operation === "add", subtracting = operation === "subtract" || operation === "compare";
  const left = value("left"), right = value("right"), result = value("result"), incoming = withCarry ? flagValue("carry") : undefined;
  const flags: FlagPolicy = { name: `8008 ${mnemonic}`, parameters: { left: 8, right: 8, result: 8, ...(withCarry ? { carry: "flag" as const } : {}) }, unlisted: "preserve",
    updates: [
      { flag: cpu.flag("s"), value: negative(result) }, { flag: cpu.flag("z"), value: zero(result) },
      { flag: cpu.flag("p"), value: evenParity(result) },
      { flag: cpu.flag("c"), value: adding ? carry(left, right, incoming) : subtracting ? borrow(left, right, incoming) : flagLiteral(false) },
    ],
  };
  return Object.fromEntries(sources.map(([suffix, source]) => [
    suffix === "byte" ? `${mnemonic.toLowerCase()}i` : `${mnemonic.toLowerCase()}${suffix}`,
    defineInstruction({ cpu: cpu.declaration, name: suffix === "byte" ? `${mnemonic}I byte` : `${mnemonic}${suffix}`,
      explanation: "Read the operand, using only H:L's low 14 bits for memory. "
        + (withCarry ? "Capture incoming C, then read A. " : "Read A without reading incoming flags. ")
        + `S/Z describe the byte result; P is even parity. ${adding ? "C reports carry" : subtracting ? "C reports borrow" : "Clear C"}. `
        + `Apply flags, then ${operation === "compare" ? "retain A without a write" : "write A"}. `
        + "Ordinary fetching advances only the selected address slot; supplied bytes preserve it. The selector and STOPPED are untouched by the body. "
        + "A failed read prevents arithmetic and writeback; completed fetches remain.",
      steps: [readSource("right", source), ...intelByteAlu(cpu.register("a"), operation, flags, withCarry ? cpu.flag("c") : undefined)],
    }),
  ]));
}

// ooo in 10 ooo sss / 00 ooo 100 selects the family; the native two-letter stems retain Intel's mnemonics.
export const instructions8008 = {
  ...family("AD", "add"), // 000 ADr / ADI
  ...family("AC", "add", true), // 001 ACr / ACI
  ...family("SU", "subtract"), // 010 SUr / SUI
  ...family("SB", "subtract", true), // 011 SBr / SBI
  ...family("ND", "and"), // 100 NDr / NDI
  ...family("XR", "xor"), // 101 XRr / XRI
  ...family("OR", "or"), // 110 ORr / ORI
  ...family("CP", "compare"), // 111 CPr / CPI
};
