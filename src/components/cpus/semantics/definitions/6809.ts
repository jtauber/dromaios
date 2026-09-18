import { cpu6809StateDescription, cpu6809Status } from "../../state/6809.ts";
import { bitAnd, bitOr, concat, fetchByte, cpuSymbols, highByte, lowByte, readRegister, readSource, value, writeLatch, writeRegister } from "../model.ts";
import type { InstructionDefinition, ValueSource } from "../model.ts";
import { registerSource } from "../builders.ts";
import { motorolaBranches, motorolaByteArithmetic, motorolaArithmeticFamily, motorolaTransfers, motorolaComparison, motorolaLogic, motorolaSubroutines, motorolaUnary } from "../motorola.ts";
import { resolvedJump } from "../control-flow.ts";
import { motorolaBranchNames } from "../../motorola.ts";
import { packedStatus, restoreStatus } from "../status.ts";
import { decimalAdjust } from "../decimal.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("6809", cpu6809StateDescription);

// D is a view, not an extra stored register. Read A then B only when the instruction reaches its register source.
const d: ValueSource = {
  name: "D from A:B", width: 16,
  steps: [readRegister("high", cpu.register("a")), readRegister("low", cpu.register("b"))],
  result: concat(value("high"), value("low")),
};

const writableD = { source: d,
  write: [writeRegister(cpu.register("a"), highByte(value("result"))), writeRegister(cpu.register("b"), lowByte(value("result")))],
  explanation: "Write D as A then B",
};

export const instructions6809: Readonly<Record<string, InstructionDefinition>> = {
  daa: decimalAdjust(cpu, "motorola"),
  ...Object.fromEntries((["or", "and"] as const).map(operation => [`${operation}cc`, defineInstruction({ cpu: cpu.declaration, name: `${operation.toUpperCase()}CC`,
    explanation: "Capture packed CC before fetching the mask, then combine and replace all flags. A failed fetch leaves flags unchanged.",
    steps: [readSource("status", packedStatus(cpu, cpu6809Status)), fetchByte("mask"),
      restoreStatus(cpu, cpu6809Status, (operation === "or" ? bitOr : bitAnd)(value("status"), value("mask")))],
  })])),
  ...motorolaSubroutines(cpu, cpu.register("s"), "occupied", true),
  ...motorolaBranches(cpu, motorolaBranchNames),
  ...motorolaBranches(cpu, motorolaBranchNames, true),
  jump: resolvedJump(cpu),
  ...motorolaUnary(cpu, { clearReadsOperand: true, testClearsCarry: false, rightShiftSetsOverflow: false }),
  ...motorolaLogic(cpu),
  ...motorolaByteArithmetic(cpu),
  ...motorolaArithmeticFamily(cpu, "SUBD", writableD, "subtract"),
  ...motorolaArithmeticFamily(cpu, "ADDD", writableD, "add"),
  ...Object.fromEntries((["a", "b", "x", "y", "u"] as const).flatMap(register =>
    Object.entries(motorolaTransfers(cpu, register.toUpperCase(), cpu.register(register))))),
  ...motorolaTransfers(cpu, "D", writableD),
  ...motorolaTransfers(cpu, "S", { source: registerSource(cpu.register("s")),
    write: [writeRegister(cpu.register("s"), value("result")), writeLatch(cpu.latch("nmiArmed"), true)],
    explanation: "Write S and arm NMI",
  }),
  // Each memory body serves all three address modes; opcode pages and patterns remain in the CPU.
  ...Object.fromEntries((["a", "b", "d", "x", "y", "u", "s"] as const).flatMap(register =>
    Object.entries(motorolaComparison(cpu, `CMP${register.toUpperCase()}`, register === "d" ? d : cpu.register(register))))),
};
