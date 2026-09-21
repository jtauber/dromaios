import { views as chapterViews, actions as chapterActions, policies, families, sources } from "../generated/6809.ts";
import { cpu6809StateDescription } from "../../state/6809.ts";
import { bitAnd, bitOr, fetchByte, flagLiteral, flagValue, literal, cpuSymbols, not, perform, replaceFlags, readSource, testChoice, updateFlags, value, when, writeChoice, writeLatch, writeRegister, zero } from "../model.ts";
import type { InstructionDefinition, NumberExpression, Statement } from "../model.ts";
import { instructionSet, registerSource, registerView } from "../builders.ts";
import { motorolaLongBranches, motorolaTransfers, motorolaComparison } from "../motorola.ts";
import { choose, flagCondition, loadVector } from "../control-flow.ts";
import { motorola6809TransferForms } from "../../motorola.ts";
import { flagPolicy } from "../status.ts";
import { byteStack, maskedStack, stackFrame } from "../stack.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("6809", cpu6809StateDescription);

// Remaining indexed/prefixed bodies share the chapter's views and complete write rules.
const d = chapterViews.D;
const writeD = (word: NumberExpression) => [perform(chapterActions.writeD, { word })];
const restoreCC = (status: NumberExpression) => replaceFlags(policies.CCFLAGS, { status });
export const chapter6809 = instructionSet(Object.values(families).flat());
export { chapterActions as actions6809, chapterViews as views6809 };
export const addresses6809 = { indexed: sources.indexed };

const armNmi = writeLatch(cpu.latch("nmiArmed"), true);
const views = {
  d: { source: d, write: writeD },
  x: registerView(cpu.register("x")), y: registerView(cpu.register("y")), u: registerView(cpu.register("u")),
  s: registerView(cpu.register("s"), [armNmi]), pc: registerView(cpu.register("pc")),
  a: registerView(cpu.register("a")), b: registerView(cpu.register("b")), dp: registerView(cpu.register("dp")),
  cc: { source: chapterViews.CC, write: (contents: NumberExpression) => [restoreCC(contents)] },
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
      readSource("status", chapterViews.CC), restoreCC(bitOr(value("status"), literal(8, masks))),
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
    steps: [readSource("status", chapterViews.CC), fetchByte("mask"), restoreCC(bitAnd(value("status"), value("mask"))),
      ...saveInterruptFrame(), writeChoice(cpu.choice("waitMode"), "cwai")] }),
  rti: defineInstruction({ cpu: cpu.declaration, name: "RTI",
    explanation: "Pull and replace CC first. Restored E selects the remaining full frame or PC alone; only complete each field after all its reads. Arm NMI after all transfers succeed. " + interruptStack.explanation,
    steps: [...stackFrame([views.cc], interruptStack, "big-endian", true), ...choose(flagCondition(cpu.flag("e"), true),
      stackFrame(interruptFrame.slice(1), interruptStack, "big-endian", true, "rest"), stackFrame([views.pc], interruptStack, "big-endian", true, "rest")), armNmi] }),
  ...registerTransfers(false), ...registerTransfers(true),
  pshs: registerStack("s", false), puls: registerStack("s", true),
  pshu: registerStack("u", false), pulu: registerStack("u", true),
  // Reuse mask construction in external interrupt entry without ordinary PSHS arming.
  pushFrame: registerStack("s", false, true),
  ...motorolaLongBranches(cpu),
  ...motorolaTransfers(cpu, "Y", cpu.register("y")),
  ...motorolaTransfers(cpu, "S", { source: registerSource(cpu.register("s")),
    write: [writeRegister(cpu.register("s"), value("result")), writeLatch(cpu.latch("nmiArmed"), true)],
    explanation: "Write S and arm NMI",
  }),
  // Prefixed comparisons retain native opcode bindings; indexed addresses come from the chapter.
  ...Object.fromEntries((["d", "y", "u", "s"] as const).flatMap(register =>
    Object.entries(motorolaComparison(cpu, `CMP${register.toUpperCase()}`, register === "d" ? d : cpu.register(register))))),
};
