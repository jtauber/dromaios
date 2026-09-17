import { cpu8080StateDescription } from "../../state/8080.ts";
import { bitAnd, bitOr, borrow, carry, cpuSymbols, evenParity, flagLiteral, flagValue, halfBorrow, halfCarry, literal, negative, not, readRegister, readSource, updateFlags, value, writeRegister, zero } from "../model.ts";
import type { FlagExpression, FlagPolicy, InstructionDefinition, Statement, ValueSource } from "../model.ts";
import { registerSource, shift, transfer } from "../builders.ts";
import { intelByteAlu, intelByteSources } from "../intel.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("8080", cpu8080StateDescription);

const sources = intelByteSources(cpu.register);

/** S/Z/P describe the captured result; every ALU operation supplies its own CY/AC meaning. */
function aluFlags(name: string, cy: FlagExpression, ac: FlagExpression, withCarry = false): FlagPolicy {
  return { name: `8080 ${name}`, parameters: { left: 8, right: 8, result: 8, ...(withCarry ? { carry: "flag" as const } : {}) }, unlisted: "preserve",
    updates: [
      { flag: cpu.flag("s"), value: negative(value("result")) }, { flag: cpu.flag("z"), value: zero(value("result")) },
      { flag: cpu.flag("p"), value: evenParity(value("result")) }, { flag: cpu.flag("cy"), value: cy }, { flag: cpu.flag("ac"), value: ac },
    ],
  };
}
const left = value("left"), right = value("right");
const comparisonFlags = aluFlags("comparison", borrow(left, right), not(halfBorrow(left, right)));

/** Expand a complete register/memory/immediate family; the resulting definitions contain only data. */
function aluFamily(mnemonic: string, immediate: string, steps: (source: ValueSource) => readonly Statement[], explanation: string) {
  return Object.fromEntries(sources.map(([name, source]) => [
    name === "byte" ? immediate.toLowerCase() : `${mnemonic.toLowerCase()}${name}`,
    defineInstruction({ cpu: cpu.declaration, name: `${name === "byte" ? immediate : mnemonic} ${name}`, explanation, steps: steps(source) }),
  ]));
}

function binaryArithmetic(mnemonic: string, immediate: string, operation: "add" | "subtract", withCarry = false) {
  const adding = operation === "add", incoming = withCarry ? flagValue("carry") : undefined;
  const flags = aluFlags(adding ? "addition" : "subtraction", (adding ? carry : borrow)(left, right, incoming),
    adding ? halfCarry(left, right, incoming) : not(halfBorrow(left, right, incoming)), withCarry);
  return aluFamily(mnemonic, immediate, source => [
    readSource("right", source), ...intelByteAlu(cpu.register("a"), operation, flags, withCarry ? cpu.flag("cy") : undefined),
  ], `Read the operand, ${withCarry ? "capture incoming CY, then read A" : "then read A without reading incoming flags"}. `
    + `S/Z describe the byte result and P its even parity. CY reports ${adding ? "carry" : "borrow"}; `
    + `AC reports ${adding ? "low-nibble carry" : "the inverse low-nibble borrow"}. `
    + "Apply flags before writing A. A failed operand read prevents flag updates and writeback; completed fetches remain.");
}

function logic(mnemonic: "ANA" | "XRA" | "ORA", immediate: string) {
  const operation = ({ ANA: "and", XRA: "xor", ORA: "or" } as const)[mnemonic];
  const auxiliary = mnemonic === "ANA" ? not(zero(bitAnd(bitOr(left, right), literal(8, 0x08)))) : flagLiteral(false);
  const flags = aluFlags(mnemonic, flagLiteral(false), auxiliary);
  return aluFamily(mnemonic, immediate, source => [
    readSource("right", source), ...intelByteAlu(cpu.register("a"), operation, flags),
  ], "Read the operand before A; do not read incoming flags. S/Z describe the byte result and P its even parity. "
    + (mnemonic === "ANA" ? "Clear CY; AC is bit 3 of the original A OR the operand. " : "Clear CY and AC. ")
    + "Apply flags before writing A. A failed operand read prevents flag updates and writeback; completed fetches remain.");
}

function rotation(name: string, direction: "left" | "right", circular: boolean): InstructionDefinition {
  const operation = shift(direction, circular ? "outgoing" : cpu.flag("cy"));
  return defineInstruction({
    cpu: cpu.declaration, name,
    explanation: `Capture A and rotate ${direction}, inserting ${circular ? "the outgoing bit" : "the captured incoming CY"}. `
      + "Write A before replacing CY with the outgoing bit. Preserve S, Z, AC, and P; no data-memory access occurs.",
    steps: [
      readRegister("original", cpu.register("a")), ...operation.steps,
      writeRegister(cpu.register("a"), value("result")),
      updateFlags({ name: "8080 rotate carry", parameters: { original: 8 }, unlisted: "preserve",
        updates: [{ flag: cpu.flag("cy"), value: operation.carry }],
      }, { original: value("original") }),
    ],
  });
}

export const instructions8080 = {
  // 00 ooo 111: ooo=000/001 selects circular left/right; 010/011 rotates through CY.
  rlc: rotation("RLC", "left", true), rrc: rotation("RRC", "right", true),
  ral: rotation("RAL", "left", false), rar: rotation("RAR", "right", false),
  // ooo in 10 ooo rrr / 11 ooo 110 selects these eight ALU families.
  ...binaryArithmetic("ADD", "ADI", "add"), // 000
  ...binaryArithmetic("ADC", "ACI", "add", true), // 001
  ...binaryArithmetic("SUB", "SUI", "subtract"), // 010
  ...binaryArithmetic("SBB", "SBI", "subtract", true), // 011
  ...logic("ANA", "ANI"), // 100
  ...logic("XRA", "XRI"), // 101
  ...logic("ORA", "ORI"), // 110
  ...aluFamily("CMP", "CPI", source => [readSource("right", source), ...intelByteAlu(cpu.register("a"), "compare", comparisonFlags)], // 111
    "Retain A without a destination write. S/Z describe the byte result, P its even parity, "
      + "CY the borrow, and AC the inverse borrow at the low-nibble boundary."),
  movBA: defineInstruction({
    cpu: cpu.declaration, name: "MOV B,A",
    explanation: "Capture A and write B. No flag-update statement occurs, so every flag is preserved.",
    steps: transfer(cpu.register("b"), registerSource(cpu.register("a"))),
  }),
};
