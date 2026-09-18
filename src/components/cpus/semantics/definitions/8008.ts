import { cpu8008StateDescription } from "../../state/8008.ts";
import { addWrap, bitAnd, borrow, capture, carry, concat, cpuSymbols, evenParity, extend, fetchByte, flagLiteral, flagValue, literal, negative,
  readMemory, readRegister, readSource, subtract, truncate, updateFlags, value, writeElement, writeLatch, writeRegister, zero } from "../model.ts";
import type { FlagPolicy, InstructionDefinition, Statement, ValueSource } from "../model.ts";
import { immediateByte, instructionSet, registerSource } from "../builders.ts";
import { intelAccumulatorRotate, intelByteAlu, intelByteTransfer } from "../intel.ts";
import type { IntelByteOperation } from "../intel.ts";
import { intel8008ByteTransferForms, intel8008ControlForms as controlForms } from "../../intel-encodings.ts";
import { conditional, flagCondition } from "../control-flow.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("8008", cpu8008StateDescription);
const addressStack = cpu.array("addressStack"), stackIndex = cpu.register("stackIndex");
const targetAddress: ValueSource = { name: "14-bit target, low byte first", width: 14,
  steps: [fetchByte("low"), fetchByte("high")], result: truncate(concat(value("high"), value("low")), 14) };

const throughHL: ValueSource = { name: "memory through low 14 bits of HL", width: 8, steps: [
  readRegister("high", cpu.register("h")), readRegister("low", cpu.register("l")),
  readMemory("byte", bitAnd(concat(value("high"), value("low")), literal(16, 0x3fff))),
], result: value("byte") };
// The 8008's sss order is A/B/C/D/E/H/L/M, unlike the 8080/Z80. Immediate is a separate encoding.
const sources = [
  ...(["a", "b", "c", "d", "e", "h", "l"] as const).map(name => [name.toUpperCase(), registerSource(cpu.register(name))] as const),
  ["M", throughHL], ["byte", immediateByte],
] as const;

const resultFlags: FlagPolicy = { name: "8008 result S/Z/P", parameters: { result: 8 }, unlisted: "preserve", updates: [
  { flag: cpu.flag("s"), value: negative(value("result")) }, { flag: cpu.flag("z"), value: zero(value("result")) },
  { flag: cpu.flag("p"), value: evenParity(value("result")) },
] };

function adjustment(mnemonic: "IN" | "DC") {
  return Object.fromEntries((["b", "c", "d", "e", "h", "l"] as const).map(register => [
    `${mnemonic.toLowerCase()}${register}`, defineInstruction({ cpu: cpu.declaration, name: `${mnemonic}${register.toUpperCase()}`,
      explanation: `Read ${register.toUpperCase()}, ${mnemonic === "IN" ? "add" : "subtract"} one with byte wraparound, `
        + "then set S/Z and even parity P before writing the register. Preserve C without reading it. No data-memory access occurs.",
      steps: [readRegister("original", cpu.register(register)),
        capture("result", (mnemonic === "IN" ? addWrap : subtract)(value("original"), literal(8, 1))),
        updateFlags(resultFlags, { result: value("result") }), writeRegister(cpu.register(register), value("result"))],
    }),
  ]));
}

function rotation(name: string, direction: "left" | "right", circular: boolean): InstructionDefinition {
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: `Capture A and rotate ${direction}, inserting ${circular ? "the outgoing bit" : "the captured incoming C"}. `
      + "Write A before replacing C with the outgoing bit. Preserve S, Z, and P; no data-memory access occurs.",
    steps: intelAccumulatorRotate(cpu.register("a"), cpu.flag("c"), direction, circular),
  });
}

function family(mnemonic: string, operation: IntelByteOperation, withCarry = false) {
  const adding = operation === "add", subtracting = operation === "subtract" || operation === "compare";
  const left = value("left"), right = value("right"), incoming = withCarry ? flagValue("carry") : undefined;
  const flags: FlagPolicy = { name: `8008 ${mnemonic}`, parameters: { left: 8, right: 8, result: 8, ...(withCarry ? { carry: "flag" as const } : {}) }, unlisted: "preserve",
    updates: [
      ...resultFlags.updates,
      { flag: cpu.flag("c"), value: adding ? carry(left, right, incoming) : subtracting ? borrow(left, right, incoming) : flagLiteral(false) },
    ],
  };
  return Object.fromEntries(sources.map(([suffix, source]) => [
    suffix === "byte" ? `${mnemonic.toLowerCase()}i` : `${mnemonic.toLowerCase()}${suffix}`,
    defineInstruction({ cpu: cpu.declaration, name: suffix === "byte" ? `${mnemonic}I byte` : `${mnemonic}${suffix}`,
      explanation: "Read the operand, using only H:L's low 14 bits for memory. "
        + (withCarry ? "Capture incoming C, then read A. " : "Read A without reading incoming flags. ")
        + `S/Z describe the byte result; P is even parity. ${adding ? "C reports carry" : subtracting ? "C reports borrow" : "Clear C"}. `
        + `Apply flags, then ${operation === "compare" ? "retain A without a write" : "write A"}. `
        + "Ordinary fetching advances only the selected address slot; supplied bytes preserve it. The selector and STOPPED are untouched by the body. "
        + "A failed read prevents arithmetic and writeback; completed fetches remain.",
      steps: [readSource("right", source), ...intelByteAlu(cpu.register("a"), operation, flags, withCarry ? cpu.flag("c") : undefined)],
    }),
  ]));
}

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

const controlInstructions = instructionSet([
  ...[...controlForms.conditionalJumps, ...controlForms.jump].map(([opcode, condition]) => [opcode, controlFlow("jump", condition)] as const),
  ...[...controlForms.conditionalCalls, ...controlForms.call].map(([opcode, condition]) => [opcode, controlFlow("call", condition)] as const),
  ...[...controlForms.conditionalReturns, ...controlForms.return].map(([opcode, condition]) => [opcode, controlFlow("return", condition)] as const),
  ...controlForms.restarts.map(([opcode, address]) => [opcode, controlFlow("call", undefined, address)] as const),
  ...controlForms.halt.map(([opcode]) => [opcode, defineInstruction({ cpu: cpu.declaration, name: "HLT",
    explanation: "Set STOPPED without reading flags, registers, or memory. Opcode fetching belongs to the caller and alone determines whether PC advances.",
    steps: [writeLatch(cpu.latch("halted"), true)],
  })] as const),
]);

export const instructions8008 = {
  ...controlInstructions,
  ...instructionSet([...intel8008ByteTransferForms.immediate, ...intel8008ByteTransferForms.matrix].map(([opcode, { destination, source }]) =>
    [opcode, intelByteTransfer(cpu, destination, source, `L${destination.toUpperCase()}${source === "immediate" ? "I n" : source.toUpperCase()}`, { mask: 0x3fff })])),
  // 00 rrr 00d: rrr=001..110 selects B/C/D/E/H/L; d=0 increments, d=1 decrements.
  ...adjustment("IN"), ...adjustment("DC"),
  // 00 0td 010: t=0 circular, t=1 through carry; d=0 left, d=1 right.
  rlc: rotation("RLC", "left", true), rrc: rotation("RRC", "right", true),
  ral: rotation("RAL", "left", false), rar: rotation("RAR", "right", false),
  // ooo in 10 ooo sss / 00 ooo 100 selects the family; retain Intel's native mnemonic stems.
  ...family("AD", "add"), // 000 ADr / ADI
  ...family("AC", "add", true), // 001 ACr / ACI
  ...family("SU", "subtract"), // 010 SUr / SUI
  ...family("SB", "subtract", true), // 011 SBr / SBI
  ...family("ND", "and"), // 100 NDr / NDI
  ...family("XR", "xor"), // 101 XRr / XRI
  ...family("OR", "or"), // 110 ORr / ORI
  ...family("CP", "compare"), // 111 CPr / CPI
};
