import { cpu6809StateDescription, cpu6809Status } from "../../state/6809.ts";
import { addWrap, bitAnd, bitOr, capture, concat, extend, fetchByte, flagLiteral, flagValue, literal, cpuSymbols, highByte, lowByte, multiply, negative, not, readRegister, readSource, signExtend, testChoice, updateFlags, value, when, writeChoice, writeLatch, writeRegister, zero } from "../model.ts";
import type { InstructionDefinition, NumberExpression, Statement, ValueSource } from "../model.ts";
import { registerSource, registerView } from "../builders.ts";
import { motorolaBranches, motorolaByteArithmetic, motorolaArithmeticFamily, motorolaTransfers, motorolaComparison, motorolaLogic, motorolaSubroutines, motorolaUnary } from "../motorola.ts";
import { choose, flagCondition, loadVector, resolvedJump } from "../control-flow.ts";
import { motorolaBranchNames, motorola6809TransferForms } from "../../motorola.ts";
import { flagPolicy, packedStatus, restoreStatus } from "../status.ts";
import { byteStack, maskedStack, stackFrame } from "../stack.ts";
import { decimalAdjust } from "../decimal.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("6809", cpu6809StateDescription);

// D is a view, not an extra stored register. Read A then B only when the instruction reaches its register source.
const d: ValueSource = {
  name: "D from A:B", width: 16,
  steps: [readRegister("high", cpu.register("a")), readRegister("low", cpu.register("b"))],
  result: concat(value("high"), value("low")),
};

const writeD = (contents: NumberExpression) => [
  writeRegister(cpu.register("a"), highByte(contents)), writeRegister(cpu.register("b"), lowByte(contents)),
];
const writableD = { source: d, write: writeD(value("result")), explanation: "Write D as A then B" };
const armNmi = writeLatch(cpu.latch("nmiArmed"), true);
const views = {
  d: { source: d, write: writeD },
  x: registerView(cpu.register("x")), y: registerView(cpu.register("y")), u: registerView(cpu.register("u")),
  s: registerView(cpu.register("s"), [armNmi]), pc: registerView(cpu.register("pc")),
  a: registerView(cpu.register("a")), b: registerView(cpu.register("b")), dp: registerView(cpu.register("dp")),
  cc: { source: packedStatus(cpu, cpu6809Status), write: (contents: NumberExpression) => [restoreStatus(cpu, cpu6809Status, contents)] },
};

function registerTransfers(exchange: boolean) {
  const mnemonic = exchange ? "EXG" : "TFR";
  return Object.fromEntries(motorola6809TransferForms.map(([, { source, target }]) => [
    `${mnemonic.toLowerCase()}_${source}_${target}`, defineInstruction({ cpu: cpu.declaration, name: `${mnemonic} ${source.toUpperCase()},${target.toUpperCase()}`,
      explanation: "Entry follows a fetched, validated same-width register postbyte. Read both original values before any write, including on TFR. "
        + `Write the destination${exchange ? ", then the original destination into the source" : ""}. `
        + "D reads and writes A then B; CC writes replace all flags; each S write arms NMI. PC is the post-fetch value. No memory access occurs in the body.",
      steps: [readSource("source", views[source].source), readSource("target", views[target].source),
        ...views[target].write(value("source")), ...(exchange ? views[source].write(value("target")) : [])],
    }),
  ]));
}

function registerStack(stack: "s" | "u", pull: boolean, frame = false): InstructionDefinition {
  const name = `${pull ? "PUL" : "PSH"}${stack.toUpperCase()}`;
  const registers = [views.cc, views.a, views.b, views.dp, views.x, views.y, views[stack === "s" ? "u" : "s"], views.pc];
  return defineInstruction({ cpu: cpu.declaration, name: frame ? `${name} supplied frame mask` : name,
    ...(frame ? { inputs: { mask: 8 as const } } : {}),
    explanation: (frame ? "Use the captured frame mask without fetching. " : "Fetch the register mask before any stack effects. ")
      + "Bits 7..0 select PC, the other stack pointer, Y, X, DP, B, A, CC. "
      + (pull ? "Pull in ascending bit order; read words high then low and commit each register only after its complete read. "
        : "Push in descending bit order; capture each selected register at its turn, then write words low then high. ")
      + "The selected pointer wraps at 16 bits, decrements before each write, and increments after each successful read. "
      + "CC pulls replace the flag object; pulling S through U arms NMI immediately. "
      + (!frame && stack === "s" ? "A nonempty mask arms NMI only after the whole instruction succeeds. " : "Do not otherwise change NMI arming. ")
      + "An empty mask has no stack effects. A failed access retains completed transfers and pointer updates; later effects do not run.",
    steps: [...(frame ? [] : [fetchByte("mask")]),
      ...maskedStack(registers, byteStack(cpu.register(stack), "occupied"), "big-endian", value("mask"), pull),
      ...(!frame && stack === "s" ? [when(not(zero(value("mask"))), [armNmi])] : [])],
  });
}

const interruptStack = byteStack(cpu.register("s"), "occupied");
const interruptFrame = [views.cc, views.a, views.b, views.dp, views.x, views.y, views.u, views.pc];
function saveInterruptFrame(): readonly Statement[] {
  return [updateFlags(flagPolicy(cpu, "entire interrupt frame", {}, { e: flagLiteral(true) }), {}),
    ...stackFrame(interruptFrame, interruptStack, "big-endian", false)];
}
function softwareInterrupt(name: string, vector: number, masks: number) {
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: "Unless CWAI already saved a frame, set E and push the full frame in PC/U/Y/X/DP/B/A/CC order. "
      + "Then repack and replace CC with the instruction's interrupt masks, leave waiting, and fetch the complete high-first vector. " + interruptStack.explanation,
    steps: [testChoice("waiting", cpu.choice("waitMode"), "cwai"), when(not(flagValue("waiting")), saveInterruptFrame()),
      readSource("status", packedStatus(cpu, cpu6809Status)), restoreStatus(cpu, cpu6809Status, bitOr(value("status"), literal(8, masks))),
      writeChoice(cpu.choice("waitMode"), "none"), ...loadVector(cpu.register("pc"), literal(16, vector), "big-endian")],
  });
}

export const instructions6809: Readonly<Record<string, InstructionDefinition>> = {
  // Base/page 10/page 11 opcode 0011 1111: SWI masks I/F; SWI2 and SWI3 preserve them.
  swi: softwareInterrupt("SWI", 0xfffa, 0x50), swi2: softwareInterrupt("SWI2", 0xfff4, 0), swi3: softwareInterrupt("SWI3", 0xfff2, 0),
  sync: defineInstruction({ cpu: cpu.declaration, name: "SYNC", explanation: "Enter SYNC without accessing registers, flags, or memory.",
    steps: [writeChoice(cpu.choice("waitMode"), "sync")] }),
  cwai: defineInstruction({ cpu: cpu.declaration, name: "CWAI",
    explanation: "Capture CC before fetching the mask, replace flags with their masked values, set E, and save the complete frame. Enter CWAI only after every push succeeds. " + interruptStack.explanation,
    steps: [readSource("status", packedStatus(cpu, cpu6809Status)), fetchByte("mask"), restoreStatus(cpu, cpu6809Status, bitAnd(value("status"), value("mask"))),
      ...saveInterruptFrame(), writeChoice(cpu.choice("waitMode"), "cwai")] }),
  rti: defineInstruction({ cpu: cpu.declaration, name: "RTI",
    explanation: "Pull and replace CC first. Restored E selects the remaining full frame or PC alone; only complete each field after all its reads. Arm NMI after all transfers succeed. " + interruptStack.explanation,
    steps: [...stackFrame([views.cc], interruptStack, "big-endian", true), ...choose(flagCondition(cpu.flag("e"), true),
      stackFrame(interruptFrame.slice(1), interruptStack, "big-endian", true, "rest"), stackFrame([views.pc], interruptStack, "big-endian", true, "rest")), armNmi] }),
  nop: defineInstruction({ cpu: cpu.declaration, name: "NOP", explanation: "No effects after opcode fetching.", steps: [] }),
  sex: defineInstruction({ cpu: cpu.declaration, name: "SEX",
    explanation: "Sign-extend B into A, leaving B unchanged. Then set N/Z from B and preserve every other flag, including V.",
    steps: [readRegister("byte", cpu.register("b")), writeRegister(cpu.register("a"), highByte(signExtend(value("byte"), 16))),
      updateFlags(flagPolicy(cpu, "SEX N/Z", { byte: 8 }, { n: negative(value("byte")), z: zero(value("byte")) }), { byte: value("byte") })],
  }),
  abx: defineInstruction({ cpu: cpu.declaration, name: "ABX",
    explanation: "Read X then unsigned B; add with word wrapping and write X. Preserve all flags without reading them.",
    steps: [readRegister("index", cpu.register("x")), readRegister("byte", cpu.register("b")),
      writeRegister(cpu.register("x"), addWrap(value("index"), extend(value("byte"), 16)))],
  }),
  mul: defineInstruction({ cpu: cpu.declaration, name: "MUL",
    explanation: "Multiply unsigned A by unsigned B. Write the complete product into D as A then B, then update Z and C. C is product bit 7 for rounding, not overflow; preserve all other flags.",
    steps: [readRegister("left", cpu.register("a")), readRegister("right", cpu.register("b")),
      capture("product", multiply(value("left"), value("right"))), ...writeD(value("product")),
      updateFlags(flagPolicy(cpu, "MUL Z/C", { product: 16 }, { z: zero(value("product")), c: negative(lowByte(value("product"))) }), { product: value("product") })],
  }),
  ...Object.fromEntries((["x", "y", "s", "u"] as const).map(register => [`lea${register}`, defineInstruction({ cpu: cpu.declaration,
    name: `LEA${register.toUpperCase()}`, inputs: { address: 16 },
    explanation: "Entry follows successful indexed address resolution, including auto-updates and indirect reads. Write the captured effective address over any earlier update of the destination. "
      + (register === "s" ? "Arm NMI. Preserve every flag." : register === "u" ? "Preserve every flag." : "Update only Z from the written address."),
    steps: [...views[register].write(value("address")), ...(register === "x" || register === "y"
      ? [updateFlags(flagPolicy(cpu, "LEA Z", { address: 16 }, { z: zero(value("address")) }), { address: value("address") })] : [])],
  })])),
  ...registerTransfers(false), ...registerTransfers(true),
  pshs: registerStack("s", false), puls: registerStack("s", true),
  pshu: registerStack("u", false), pulu: registerStack("u", true),
  // Reuse mask construction in external interrupt entry without ordinary PSHS arming.
  pushFrame: registerStack("s", false, true),
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
