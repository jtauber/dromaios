import { cpu6800StateDescription } from "../../state/6800.ts";
import { addWrap, cpuSymbols, flagLiteral, flagValue, literal, not, readLatch, readRegister, replaceFlags, updateFlags, writeRegister, subtract, value, when, writeLatch, zero } from "../model.ts";
import type { NumberExpression, Statement } from "../model.ts";
import { instructionSet, registerSource, registerView, transfer } from "../builders.ts";
import { motorolaArithmetic, motorolaBranches, motorolaByteArithmetic, motorolaSubroutines, motorolaUnary } from "../motorola.ts";
import { defineInstruction } from "../validate.ts";
import { loadVector, resolvedJump } from "../control-flow.ts";
import { motorolaBranchNames } from "../../motorola.ts";
import { byteStack, stackFrame, stackPop, stackPush } from "../stack.ts";
import { flagInstruction, flagPolicy } from "../status.ts";
import { decimalAdjust } from "../decimal.ts";
import { families, views, policies } from "../generated/6800.ts";

const cpu = cpuSymbols("6800", cpu6800StateDescription);

const interruptStack = byteStack(cpu.register("sp"), "free");
const frame = [{ source: views.CC, write: (contents: NumberExpression) => [replaceFlags(policies.CCFLAGS, { status: contents })] },
  ...(["b", "a", "x", "pc"] as const).map(field => registerView(cpu.register(field)))];
const saveFrame = () => stackFrame(frame, interruptStack, "big-endian", false);
function interruptEntry(vector: NumberExpression): readonly Statement[] {
  return [readLatch("waiting", cpu.latch("waiting")), when(not(flagValue("waiting")), saveFrame()),
    writeLatch(cpu.latch("waiting"), false), updateFlags(flagPolicy(cpu, "mask IRQ", {}, { i: flagLiteral(true) }), {}),
    ...loadVector(cpu.register("pc"), vector, "big-endian")];
}
const entryExplanation = "Unless WAI already saved the frame, push PC, X, A, B, then CC with old I. Capture each field at its turn; words push low/high. Release WAI, set I, then read the complete high-first vector before writing PC. " + interruptStack.explanation;

export const chapter6800 = instructionSet(Object.values(families).flat());

export const instructions6800 = {
  ...chapter6800,
  enterInterrupt: defineInstruction({ cpu: cpu.declaration, name: "external interrupt entry", inputs: { vector: 16 },
    explanation: entryExplanation, steps: interruptEntry(value("vector")) }),
  swi: defineInstruction({ cpu: cpu.declaration, name: "SWI", explanation: entryExplanation, steps: interruptEntry(literal(16, 0xfffa)) }),
  wai: defineInstruction({ cpu: cpu.declaration, name: "WAI",
    explanation: "Save the complete interrupt frame before entering WAI; preserve I until wake-up. A failed push prevents waiting. " + interruptStack.explanation,
    steps: [...saveFrame(), writeLatch(cpu.latch("waiting"), true)] }),
  rti: defineInstruction({ cpu: cpu.declaration, name: "RTI",
    explanation: "Pull CC, B, A, X, then PC. Replace flags immediately after CC; commit each later field only after its complete read. Preserve waiting. " + interruptStack.explanation,
    steps: stackFrame(frame, interruptStack, "big-endian", true) }),
  nop: defineInstruction({ cpu: cpu.declaration, name: "NOP", explanation: "No effects after opcode fetching.", steps: [] }),
  daa: decimalAdjust(cpu, "motorola"),
  ...Object.fromEntries((["v", "c", "i"] as const).flatMap(flag => [false, true].map(set => {
    const name = `${set ? "se" : "cl"}${flag}`; return [name, flagInstruction(cpu, name.toUpperCase(), flag, set)];
  }))),
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
};
