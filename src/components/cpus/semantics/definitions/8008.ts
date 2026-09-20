import { cpu8008StateDescription } from "../../state/8008.ts";
import { addWrap, capture, concat, cpuSymbols, extend, fetchByte, literal,
  readRegister, readSource, subtract, truncate, value, writeElement, writeLatch, writeRegister } from "../model.ts";
import type { InstructionDefinition, Statement, ValueSource } from "../model.ts";
import { instructionSet, registerView } from "../builders.ts";
import { intel8008PortForms, intel8008ControlForms as controlForms } from "../../intel-encodings.ts";
import { conditional, flagCondition } from "../control-flow.ts";
import { defineInstruction } from "../validate.ts";
import { portTransfer } from "../ports.ts";
import { families } from "../generated/8008.ts";

const cpu = cpuSymbols("8008", cpu8008StateDescription);
const addressStack = cpu.array("addressStack"), stackIndex = cpu.register("stackIndex");
const targetAddress: ValueSource = { name: "14-bit target, low byte first", width: 14,
  steps: [fetchByte("low"), fetchByte("high")], result: truncate(concat(value("high"), value("low")), 14) };

// The caller's selected slot already holds the return PC. Calls advance the selector;
// returns move it back without reading, copying, or clearing either physical slot.
function controlFlow(operation: "jump" | "call" | "return", code?: number, restart?: number): InstructionDefinition {
  const flag = (["c", "z", "s", "p"] as const)[(code ?? 0) % 4]!;
  const condition = code === undefined ? undefined : flagCondition(cpu.flag(flag), code >= 4);
  const mnemonic = operation === "jump" ? "J" : operation === "call" ? "C" : "R";
  const name = restart !== undefined ? `RST ${restart.toString(16).toUpperCase().padStart(2, "0")}`
    : code === undefined ? { jump: "JMP", call: "CAL", return: "RET" }[operation] : `${mnemonic}${code >= 4 ? "T" : "F"}${flag.toUpperCase()}`;
  const steps: Statement[] = [readRegister("slot", stackIndex)];
  if (operation !== "jump") steps.push(
    capture("next", truncate((operation === "call" ? addWrap : subtract)(extend(value("slot"), 8), literal(8, 1)), 3)),
    writeRegister(stackIndex, value("next")),
  );
  if (operation !== "return") steps.push(writeElement(addressStack, value(operation === "call" ? "next" : "slot"), value("target")));
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: (operation === "return" ? "Test the condition, if present, before reading the selector. "
      : restart !== undefined ? "Capture the encoded restart vector without fetching operands. "
      : "Fetch both target bytes, low first, and discard the high two address bits before testing any condition. ")
      + (operation === "jump" ? "Only a taken path writes the selected address register. "
        : operation === "call" ? "Only a taken path advances the three-bit selector with wrapping, then writes the target into the new slot. An eighth nested call overwrites the oldest return. "
        : "Only a taken path decrements the three-bit selector with wrapping. Retain all physical address registers unchanged. ")
      + "RAM fetching advances the caller's slot; externally supplied bytes leave it unchanged. The body performs no data-memory accesses and preserves all flags and STOPPED. Failed fetches stop later effects; completed effects remain.",
    steps: [...(operation === "return" ? [] : restart === undefined ? [readSource("target", targetAddress)] : [capture("target", literal(14, restart))]),
      ...conditional(condition, steps)],
  });
}

const controlInstructions = [
  ...[...controlForms.conditionalJumps, ...controlForms.jump].map(([opcode, condition]) => [opcode, controlFlow("jump", condition)] as const),
  ...[...controlForms.conditionalCalls, ...controlForms.call].map(([opcode, condition]) => [opcode, controlFlow("call", condition)] as const),
  ...[...controlForms.conditionalReturns, ...controlForms.return].map(([opcode, condition]) => [opcode, controlFlow("return", condition)] as const),
  ...controlForms.restarts.map(([opcode, address]) => [opcode, controlFlow("call", undefined, address)] as const),
  ...controlForms.halt.map(([opcode]) => [opcode, defineInstruction({ cpu: cpu.declaration, name: "HLT",
    explanation: "Set STOPPED without reading flags, registers, or memory. Opcode fetching belongs to the caller and alone determines whether PC advances.",
    steps: [writeLatch(cpu.latch("halted"), true)],
  })] as const),
];

// Every opcode is defined once, across chapter-owned byte operations and the remaining TS families.
export const instructions8008 = instructionSet([
  ...Object.values(families).flat(),
  ...controlInstructions,
  ...intel8008PortForms.map(([opcode, port]) => [opcode,
    portTransfer(cpu.declaration, `${port < 8 ? "INP" : "OUT"} ${port}`, { name: "encoded port selector", width: 16,
      steps: [], result: literal(16, port) }, registerView(cpu.register("a")), port >= 8)] as const),
]);
