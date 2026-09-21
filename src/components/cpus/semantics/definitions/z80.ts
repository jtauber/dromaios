import { cpuZ80StateDescription } from "../../state/z80.ts";
import { cpuSymbols, perform, readMemory, readSource, value } from "../model.ts";
import type { InstructionDefinition } from "../model.ts";
import { instructionSet, registerSource } from "../builders.ts";
import type { RegisterView } from "../builders.ts";
import { intelByteTransfer, intelStackTransfer, intelStackExchange, intelWordAdjustment, intelWordArithmetic, intelWordTransfer } from "../intel.ts";
import { defineInstruction } from "../validate.ts";
import { jump } from "../control-flow.ts";
import { actions, views, policies, families, operands } from "../generated/z80.ts";

const cpu = cpuSymbols("z80", cpuZ80StateDescription);
export { actions as actionsZ80, views as viewsZ80, pages as pagesZ80 } from "../generated/z80.ts";
export const chapterZ80 = instructionSet(Object.values(families).flat(), 16);

// Native prefixed forms reuse the chapter's pair reads and split writes.
function pairView(name: "BC" | "DE" | "HL"): RegisterView {
  return { source: views[name], write: word => [perform(actions[`write${name}`], { word })] };
}
const bc = pairView("BC"), de = pairView("DE"), hl = pairView("HL");
function wordRegister(name: "bc" | "de" | "hl" | "sp") {
  if (name === "sp") return cpu.register("sp");
  const pair = { bc, de, hl }[name];
  return { source: pair.source, write: pair.write(value("result")) };
}

function wordTransferName(register: string, operation: "immediate" | "load" | "store" | "copy"): string {
  const name = register.toUpperCase();
  return { immediate: `LD ${name},nn`, load: `LD ${name},(nn)`, store: `LD (nn),${name}`, copy: `LD SP,${name}` }[operation];
}

const wordAdditionFlags = policies.WORDADD;

// Indexed CB still resolves its displacement in the core; masks and effects belong to the chapter.
function indexedBits(operation: "bit" | "res" | "set") {
  return Object.fromEntries(operands.bitMasks.map((operand, code) => {
    if (operand.kind !== "value") throw new Error("Z80 bit masks must be readable values.");
    return [`${operation}${code}Memory`, defineInstruction({ cpu: cpu.declaration,
      name: `${operation.toUpperCase()} ${code},memory`, inputs: { address: 16 },
      explanation: "Use the chapter's mask and action at the resolved index address.",
      steps: [readSource("mask", operand.read), perform(actions[`${operation}Memory`], { address: value("address"), mask: value("mask") })],
    })];
  }));
}

// Indexed ALU forms resolve their address in the decoder, then reuse the chapter's byte action.
function indexedArithmetic(operation: "add" | "adc" | "sub" | "sbc" | "and" | "xor" | "or" | "cp") {
  return defineInstruction({ cpu: cpu.declaration, name: `${operation.toUpperCase()} memory`, inputs: { address: 16 },
    explanation: "Read once at the resolved index address, then perform the chapter's accumulator action. A failed read prevents its effects.",
    steps: [readMemory("right", value("address")), perform(actions[`${operation}Accumulator`], { right: value("right") })],
  });
}

export const instructionsZ80 = {
  ...Object.fromEntries((["ix", "iy"] as const).flatMap(register => (["push", "pop"] as const).map(operation =>
    [`${operation}${register.toUpperCase()}`, intelStackTransfer(cpu, cpu.register(register), operation, `${operation.toUpperCase()} ${register.toUpperCase()}`)]))),
  ...Object.fromEntries((["ix", "iy"] as const).map(index =>
    [`jump${index.toUpperCase()}`, jump(cpu, `JP (${index.toUpperCase()})`, registerSource(cpu.register(index)))])),
  // DD/FD 00 pp 1 001 replaces both destination HL and pp=10 with IX/IY; 00 10 q 011 adjusts the index.
  ...Object.fromEntries((["ix", "iy"] as const).flatMap(index => [
    ...(["bc", "de", index, "sp"] as const).map((register): readonly [string, InstructionDefinition] => [`add${index.toUpperCase()}${register.toUpperCase()}`,
      intelWordArithmetic(cpu, cpu.register(index), register === "ix" || register === "iy" ? cpu.register(register) : wordRegister(register),
        "add", wordAdditionFlags, `ADD ${index.toUpperCase()},${register.toUpperCase()}`)]),
    ...(["INC", "DEC"] as const).map((mnemonic): readonly [string, InstructionDefinition] => [`${mnemonic.toLowerCase()}${index.toUpperCase()}Word`,
      intelWordAdjustment(cpu, cpu.register(index), mnemonic === "INC" ? 1 : -1, `${mnemonic} ${index.toUpperCase()}`)]),
  ])),
  // DD/FD replace HL with IX/IY for immediate, absolute-memory, and SP loads.
  ...Object.fromEntries((["ix", "iy"] as const).flatMap(register => (["immediate", "load", "store", "copy"] as const).map(operation =>
    [`${operation}${register.toUpperCase()}Word`, intelWordTransfer(cpu, cpu.register(register), operation, wordTransferName(register, operation))]))),
  // DD/FD 11 100 011: exchange IX/IY with the word at SP, without a displacement or SP update.
  ...Object.fromEntries((["ix", "iy"] as const).map(register =>
    [`exchange${register.toUpperCase()}Word`, intelStackExchange(cpu, cpu.register(register), `EX (SP),${register.toUpperCase()}`)])),
  // DD/FD 01 rrr 110 / 01 110 rrr: use real H/L with a resolved IX/IY address; rrr=110 is excluded.
  ...Object.fromEntries((["b", "c", "d", "e", "h", "l", "a"] as const).flatMap(register => [
    [`load${register.toUpperCase()}Memory`, intelByteTransfer(cpu, register, "m", `LD ${register.toUpperCase()},memory`)],
    [`store${register.toUpperCase()}Memory`, intelByteTransfer(cpu, "m", register, `LD memory,${register.toUpperCase()}`)],
  ])),
  // DD/FD 00 110 110: the decoder fetches d and resolves the address before the body fetches n.
  storeImmediateMemory: intelByteTransfer(cpu, "m", "immediate", "LD memory,n"),
  // Resolved indexed operands reuse the chapter's read/modify/write actions.
  incMemory: actions.incMemory, decMemory: actions.decMemory,
  rlcMemory: actions.rlcMemory, rrcMemory: actions.rrcMemory, rlMemory: actions.rlMemory, rrMemory: actions.rrMemory,
  slaMemory: actions.slaMemory, sraMemory: actions.sraMemory, srlMemory: actions.srlMemory,
  ...indexedBits("bit"), ...indexedBits("res"), ...indexedBits("set"),
  // DD/FD 10 ooo 110: the same eight byte operations after displacement resolution.
  ...Object.fromEntries((["add", "adc", "sub", "sbc", "and", "xor", "or", "cp"] as const).map(operation =>
    [`${operation}Memory`, indexedArithmetic(operation)])),
};
