import { cpu6502StateDescription } from "../../state/6502.ts";
import { cpuSymbols, flagLiteral, highByte, lowByte, readRegister, readSource, updateFlags, value } from "../model.ts";
import type { SourceDefinitions } from "../model.ts";
import { instructionSet } from "../builders.ts";
import { defineInstruction } from "../validate.ts";
import { loadVector } from "../control-flow.ts";
import { byteStack } from "../stack.ts";
import { sources, views, policies, operands, families } from "../generated/6502.ts";

const cpu = cpuSymbols("6502", cpu6502StateDescription);
const stack = byteStack(cpu.register("sp"), "free", 0x0100);

// Keep the original sixteen addressing probes; stack sources are instruction effects.
const addressNames = ["zeroPage", "zeroPageX", "zeroPageY", "absolute", "absoluteX", "absoluteY", "indexedIndirect", "indirectIndexed"] as const;
export const sources6502 = { cpu: cpu.declaration, groups: {
  addresses: Object.fromEntries(addressNames.map(name => [name, sources[name]])),
  operands: Object.fromEntries(operands.accumulator.map((operand, code) => [code, operand.read])),
} } satisfies SourceDefinitions;

// IRQ/NMI entry remains outside the chapter until the execution contract supports vectors.
export const interrupts6502 = { enter: defineInstruction({ cpu: cpu.declaration, name: "external interrupt entry", inputs: { vector: 16 },
  explanation: "After CPU-owned recognition, push PC high then live PC low, then packed status with B clear and old I. "
    + "Set I only after those writes; preserve NMOS D. Read the complete low-first vector before replacing PC. " + stack.explanation,
  steps: [readRegister("highPC", cpu.register("pc")), ...stack.push(highByte(value("highPC")), "high"),
    readRegister("lowPC", cpu.register("pc")), ...stack.push(lowByte(value("lowPC")), "low"),
    readSource("status", views.STATUS), ...stack.push(value("status"), "status"),
    updateFlags(policies.SETI, { value: flagLiteral(true) }),
    ...loadVector(cpu.register("pc"), value("vector"), "little-endian")],
}) };

export const instructions6502 = instructionSet(Object.values(families).flat());
