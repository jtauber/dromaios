import { cpu6800StateDescription, cpu6800Status } from "../../state/6800.ts";
import { addWrap, cpuSymbols, highByte, literal, negative, overflow, readRegister, readSource, updateFlags, writeRegister, subtract, value, zero } from "../model.ts";
import type { FlagPolicy } from "../model.ts";
import { compare, registerSource, transfer } from "../builders.ts";
import { motorolaArithmetic, motorolaBranches, motorolaByteArithmetic, motorolaResultFlags, motorolaSubroutines, motorolaTransfers, motorolaComparison, motorolaComparisonFlags, motorolaLogic, motorolaUnary } from "../motorola.ts";
import { defineInstruction } from "../validate.ts";
import { resolvedJump } from "../control-flow.ts";
import { motorolaBranchNames } from "../../motorola.ts";
import { byteStack, stackPop, stackPush } from "../stack.ts";
import { flagInstruction, flagPolicy, packedStatus, restoreStatus } from "../status.ts";
import { decimalAdjust } from "../decimal.ts";

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
  nop: defineInstruction({ cpu: cpu.declaration, name: "NOP", explanation: "No effects after opcode fetching.", steps: [] }),
  daa: decimalAdjust(cpu, "motorola"),
  ...Object.fromEntries((["v", "c", "i"] as const).flatMap(flag => [false, true].map(set => {
    const name = `${set ? "se" : "cl"}${flag}`; return [name, flagInstruction(cpu, name.toUpperCase(), flag, set)];
  }))),
  tap: defineInstruction({ cpu: cpu.declaration, name: "TAP", explanation: "Capture A and replace all six flags, ignoring bits 7/6.",
    steps: [readRegister("status", cpu.register("a")), restoreStatus(cpu, cpu6800Status, value("status"))] }),
  tpa: defineInstruction({ cpu: cpu.declaration, name: "TPA", explanation: "Capture all six flags and write A, setting reserved bits 7/6.",
    steps: [readSource("status", packedStatus(cpu, cpu6800Status)), writeRegister(cpu.register("a"), value("status"))] }),
  ...Object.fromEntries(([
    ["inx", "x", "x", 1], ["dex", "x", "x", -1], ["ins", "sp", "sp", 1], ["des", "sp", "sp", -1],
    ["tsx", "sp", "x", 1], ["txs", "x", "sp", -1],
  ] as const).map(([name, from, to, delta]) => [name, defineInstruction({ cpu: cpu.declaration, name: name.toUpperCase(),
    explanation: `Capture ${from.toUpperCase()}, ${delta === 1 ? "add" : "subtract"} one with word wrap, and write ${to.toUpperCase()}. `
      + (from === "x" && to === "x" ? "Then update Z only." : "Preserve all flags."),
    steps: [...transfer(cpu.register(to), { name: "adjusted word", width: 16, steps: [readRegister("original", cpu.register(from))],
        result: (delta === 1 ? addWrap : subtract)(value("original"), literal(16, 1)) }),
      ...(from === "x" && to === "x" ? [readRegister("adjusted", cpu.register("x")),
        updateFlags(flagPolicy(cpu, "index Z", { result: 16 }, { z: zero(value("result")) }), { result: value("adjusted") })] : [])],
  })])),
  ...motorolaSubroutines(cpu, cpu.register("sp"), "free"),
  ...Object.fromEntries((["a", "b"] as const).flatMap(register => {
    const stack = byteStack(cpu.register("sp"), "free"), suffix = register.toUpperCase();
    return [[`psh${suffix}`, stackPush(cpu.declaration, `PSH${suffix}`, stack, registerSource(cpu.register(register)))],
      [`pul${suffix}`, stackPop(cpu.declaration, `PUL${suffix}`, stack, cpu.register(register))]];
  })),
  ...motorolaBranches(cpu, motorolaBranchNames.filter(name => name !== "brn")),
  jump: resolvedJump(cpu),
  ...motorolaUnary(cpu, { clearReadsOperand: false, testClearsCarry: true, rightShiftSetsOverflow: true }),
  ...motorolaByteArithmetic(cpu),
  ...motorolaLogic(cpu, "ORA"), // The original 6800 spells these ORAA/ORAB.
  ...Object.fromEntries((["a", "b"] as const).flatMap(register =>
    Object.entries(motorolaTransfers(cpu, register.toUpperCase(), cpu.register(register), ["LDA", "STA"])))),
  ...motorolaTransfers(cpu, "S", cpu.register("sp")),
  ...motorolaTransfers(cpu, "X", cpu.register("x")),
  ...Object.fromEntries((["a", "b"] as const).map(source => {
    const destination = source === "a" ? "b" : "a", name = `T${source.toUpperCase()}${destination.toUpperCase()}`;
    return [name.toLowerCase(), defineInstruction({ cpu: cpu.declaration, name,
      explanation: `Capture ${source.toUpperCase()} and write ${destination.toUpperCase()}, then set N/Z from that byte and clear V. `
        + "Preserve other flags. No data-memory access occurs.",
      steps: transfer(cpu.register(destination), registerSource(cpu.register(source)), motorolaResultFlags(cpu, "transfer")),
    })];
  })),
  ...motorolaComparison(cpu, "CMPA", cpu.register("a")),
  ...motorolaComparison(cpu, "CMPB", cpu.register("b")),
  ...motorolaComparison(cpu, "CPX", cpu.register("x"), indexComparison,
    "N/V describe high-byte subtraction without low-byte borrow; Z tests whole-word equality. Preserve H/I/C."),
  ...Object.fromEntries((["add", "subtract"] as const).map(operation => {
    const name = operation === "add" ? "ABA" : "SBA";
    return [name.toLowerCase(), defineInstruction({ cpu: cpu.declaration, name,
      explanation: "Read A then B and ignore incoming C. Set N/Z/V/C from the binary result, with C meaning "
        + (operation === "add" ? "carry; set H from the low-nibble carry. " : "borrow; preserve H. ")
        + "Preserve I. Write A after flags; B is unchanged. No data-memory access occurs.",
      steps: [readRegister("left", cpu.register("a")), readRegister("right", cpu.register("b")),
        ...motorolaArithmetic(cpu, operation, 8), writeRegister(cpu.register("a"), value("result"))],
    })];
  })),
  cba: defineInstruction({ cpu: cpu.declaration, name: "CBA", explanation: "Compare A with B without writing either register. "
    + "Set N/Z/V/C from byte subtraction, with C meaning borrow; preserve H/I. No data-memory access occurs.",
    steps: compare(cpu.register("a"), registerSource(cpu.register("b")), motorolaComparisonFlags(cpu, 8)),
  }),
};
