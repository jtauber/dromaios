import { cpuZ80StateDescription } from "../../state/z80.ts";
import { addOverflow, borrow, carry, cpuSymbols, evenParity, flagLiteral, flagValue, halfBorrow, halfCarry, negative, overflow,
  readMemory, readRegister, readSource, updateFlags, value, writeMemory, writeRegister, zero } from "../model.ts";
import type { FlagPolicy, InstructionDefinition } from "../model.ts";
import { shift } from "../builders.ts";
import type { ShiftInput } from "../builders.ts";
import { intelAccumulatorRotate, intelByteAlu, intelByteSources } from "../intel.ts";
import type { IntelByteOperation } from "../intel.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("z80", cpuZ80StateDescription);
const sources = intelByteSources(cpu.register);

function rotation(name: string, direction: "left" | "right", circular: boolean): InstructionDefinition {
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: `Capture A and rotate ${direction}, inserting ${circular ? "the outgoing bit" : "incoming C captured after A"}. `
      + "Write A before replacing C, then clear N/H. Preserve S/Z/PV, the alternate bank, and control state. No data-memory access occurs.",
    steps: [...intelAccumulatorRotate(cpu.register("a"), cpu.flag("c"), direction, circular),
      updateFlags({ name: "Z80 accumulator rotate N/H", parameters: {}, unlisted: "preserve", updates: [
        { flag: cpu.flag("n"), value: flagLiteral(false) }, { flag: cpu.flag("h"), value: flagLiteral(false) },
      ] }, {})],
  });
}

function shiftFamily(mnemonic: string, direction: "left" | "right", incoming: ShiftInput = "zero") {
  const operation = shift(direction, incoming);
  const flags: FlagPolicy = { name: `Z80 ${mnemonic}`, parameters: { original: 8, result: 8 }, unlisted: "preserve", updates: [
    { flag: cpu.flag("s"), value: negative(value("result")) }, { flag: cpu.flag("z"), value: zero(value("result")) },
    { flag: cpu.flag("h"), value: flagLiteral(false) }, { flag: cpu.flag("pv"), value: evenParity(value("result")) },
    { flag: cpu.flag("n"), value: flagLiteral(false) }, { flag: cpu.flag("c"), value: operation.carry },
  ] };
  return Object.fromEntries((["b", "c", "d", "e", "h", "l", "a", "memory"] as const).map(target => {
    const memory = target === "memory";
    return [`${mnemonic.toLowerCase()}${memory ? "Memory" : target.toUpperCase()}`, defineInstruction({
      cpu: cpu.declaration, name: `${mnemonic} ${memory ? "memory" : target.toUpperCase()}`,
      ...(memory ? { inputs: { address: 16 as const } } : {}),
      explanation: (memory ? "Use the resolved HL or indexed address for one read and one write, even if the byte is unchanged. " : "Read the selected byte register. ")
        + (typeof incoming === "string" ? `Shift ${direction}, inserting ${incoming === "outgoing" ? "the outgoing bit" : incoming === "sign" ? "the original sign bit" : "zero"}. `
          : `After the operand read, capture C and shift ${direction} through it. `)
        + "Set S/Z and even parity P/V, clear H/N, and copy the outgoing bit to C before writing the result. "
        + "Preserve the alternate bank and control state. A failed read prevents flag updates and writeback; a failed write retains the calculated flags.",
      steps: [memory ? readMemory("original", value("address")) : readRegister("original", cpu.register(target)),
        ...operation.steps, updateFlags(flags, { original: value("original"), result: value("result") }),
        memory ? writeMemory(value("address"), value("result")) : writeRegister(cpu.register(target), value("result"))],
    })];
  }));
}

// ooo selects ADD/ADC/SUB/SBC/AND/XOR/OR/CP in the unprefixed and DD/FD ALU families.
// Arithmetic P/V means signed overflow; logic uses parity. H reports carry/borrow, never its inverse.
function family(mnemonic: string, operation: IntelByteOperation, withCarry = false) {
  const adding = operation === "add", subtracting = operation === "subtract" || operation === "compare";
  const left = value("left"), right = value("right"), result = value("result"), incoming = withCarry ? flagValue("carry") : undefined;
  const flags: FlagPolicy = { name: `Z80 ${mnemonic}`, parameters: { left: 8, right: 8, result: 8, ...(withCarry ? { carry: "flag" as const } : {}) }, unlisted: "preserve",
    updates: [
      { flag: cpu.flag("s"), value: negative(result) }, { flag: cpu.flag("z"), value: zero(result) },
      { flag: cpu.flag("h"), value: adding ? halfCarry(left, right, incoming) : subtracting ? halfBorrow(left, right, incoming) : flagLiteral(operation === "and") },
      { flag: cpu.flag("pv"), value: adding ? addOverflow(left, right, incoming) : subtracting ? overflow(left, right, incoming) : evenParity(result) },
      { flag: cpu.flag("n"), value: flagLiteral(subtracting) },
      { flag: cpu.flag("c"), value: adding ? carry(left, right, incoming) : subtracting ? borrow(left, right, incoming) : flagLiteral(false) },
    ],
  };
  return Object.fromEntries([...sources, ["Memory", undefined] as const].map(([suffix, source]) => {
    const memory = source === undefined, operand = memory ? "memory" : suffix === "M" ? "(HL)" : suffix === "byte" ? "n" : suffix;
    return [`${mnemonic.toLowerCase()}${suffix === "byte" ? "Immediate" : suffix}`, defineInstruction({
      cpu: cpu.declaration, name: `${mnemonic} ${adding || withCarry ? "A," : ""}${operand}`,
      ...(memory ? { inputs: { address: 16 as const } } : {}),
      explanation: (memory ? "Entry follows indexed address resolution. Read the byte at that captured address. " : "Read the operand. ")
        + (withCarry ? "Capture incoming C, then read A. " : "Read A without reading incoming flags. ")
        + "S/Z describe the byte result. "
        + (adding || subtracting ? `P/V is signed overflow; H and C report low-nibble and byte ${adding ? "carry" : "borrow"}. `
          : `P/V is even parity; ${operation === "and" ? "set" : "clear"} H and clear C. `)
        + `${subtracting ? "Set" : "Clear"} N. Apply flags, then ${operation === "compare" ? "retain A without a write" : "write A"}. `
        + "Preserve the alternate bank and control state. A failed read prevents flag updates and writeback; completed decoding and fetching remain.",
      steps: [memory ? readMemory("right", value("address")) : readSource("right", source),
        ...intelByteAlu(cpu.register("a"), operation, flags, withCarry ? cpu.flag("c") : undefined)],
    })];
  }));
}

export const instructionsZ80 = {
  // 00 ooo 111: ooo=000/001 rotates A circularly; 010/011 rotates through C. Preserve S/Z/PV.
  rlca: rotation("RLCA", "left", true), rrca: rotation("RRCA", "right", true),
  rla: rotation("RLA", "left", false), rra: rotation("RRA", "right", false),
  // CB 00 yyy rrr: yyy selects the operation; rrr selects B/C/D/E/H/L/(HL)/A.
  // One resolved-memory body also serves DD/FD CB d 00 yyy 110. yyy=110 is undocumented SLL.
  ...shiftFamily("RLC", "left", "outgoing"), // 000
  ...shiftFamily("RRC", "right", "outgoing"), // 001
  ...shiftFamily("RL", "left", cpu.flag("c")), // 010
  ...shiftFamily("RR", "right", cpu.flag("c")), // 011
  ...shiftFamily("SLA", "left"), // 100
  ...shiftFamily("SRA", "right", "sign"), // 101
  ...shiftFamily("SRL", "right"), // 111
  // ooo in 10 ooo rrr / 11 ooo 110 selects the same byte ALU family.
  ...family("ADD", "add"), // 000
  ...family("ADC", "add", true), // 001
  ...family("SUB", "subtract"), // 010
  ...family("SBC", "subtract", true), // 011
  ...family("AND", "and"), // 100
  ...family("XOR", "xor"), // 101
  ...family("OR", "or"), // 110
  ...family("CP", "compare"), // 111
};
