import { cpu8080StateDescription } from "../../state/8080.ts";
import { borrow, concat, cpuSymbols, evenParity, halfBorrow, negative, not, readMemory, readRegister, updateFlags, value, writeRegister, zero } from "../model.ts";
import type { FlagPolicy, InstructionDefinition, ValueSource } from "../model.ts";
import { compare, immediateByte, registerSource, shift, transfer } from "../builders.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("8080", cpu8080StateDescription);

const throughHL: ValueSource = {
  name: "memory through HL", width: 8,
  steps: [
    readRegister("high", cpu.register("h")),
    readRegister("low", cpu.register("l")),
    readMemory("byte", concat(value("high"), value("low"))),
  ], result: value("byte"),
};

const comparisonFlags: FlagPolicy = {
  name: "8080 comparison", parameters: { left: 8, right: 8, result: 8 }, unlisted: "preserve",
  updates: [
    { flag: cpu.flag("s"), value: negative(value("result")) },
    { flag: cpu.flag("z"), value: zero(value("result")) },
    { flag: cpu.flag("p"), value: evenParity(value("result")) },
    { flag: cpu.flag("cy"), value: borrow(value("left"), value("right")) },
    { flag: cpu.flag("ac"), value: not(halfBorrow(value("left"), value("right"))) },
  ],
};

function comparison(source: ValueSource, name: string): InstructionDefinition {
  return defineInstruction({
    cpu: cpu.declaration, name,
    explanation: "Retain A without a destination write. S/Z describe the byte result, P its even parity, "
      + "CY the borrow, and AC the inverse borrow at the low-nibble boundary.",
    steps: compare(cpu.register("a"), source, comparisonFlags),
  });
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
  cpi: comparison(immediateByte, "CPI byte"),
  cmpB: comparison(registerSource(cpu.register("b")), "CMP B"),
  cmpC: comparison(registerSource(cpu.register("c")), "CMP C"),
  cmpD: comparison(registerSource(cpu.register("d")), "CMP D"),
  cmpE: comparison(registerSource(cpu.register("e")), "CMP E"),
  cmpH: comparison(registerSource(cpu.register("h")), "CMP H"),
  cmpL: comparison(registerSource(cpu.register("l")), "CMP L"),
  cmpM: comparison(throughHL, "CMP M"),
  cmpA: comparison(registerSource(cpu.register("a")), "CMP A"),
  movBA: defineInstruction({
    cpu: cpu.declaration, name: "MOV B,A",
    explanation: "Capture A and write B. No flag-update statement occurs, so every flag is preserved.",
    steps: transfer(cpu.register("b"), registerSource(cpu.register("a"))),
  }),
};
