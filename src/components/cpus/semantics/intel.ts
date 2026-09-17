import { addWrap, bitAnd, bitOr, bitXor, capture, concat, fetchByte, flagValue, highByte, literal, lowByte, readFlag, readMemory, readRegister, readSource, subtract, updateFlags, value, writeMemory, writeRegister } from "./model.ts";
import type { CpuDeclaration, Flag, FlagPolicy, InstructionDefinition, Register, Statement, ValueSource } from "./model.ts";
import { arithmetic, immediateByte, instructionSet, registerSource, shift, transfer } from "./builders.ts";
import { defineInstruction } from "./validate.ts";
import { intelByteTransferForms, intelWordTransferForms } from "../intel-transfers.ts";
import type { IntelByteOperand } from "../intel-transfers.ts";
import { pairBytes } from "../register-pairs.ts";
import type { RegisterPair } from "../register-pairs.ts";

interface IntelByteCpu {
  readonly declaration: CpuDeclaration;
  register(field: "a" | "b" | "c" | "d" | "e" | "h" | "l"): Register;
}

interface IntelWordCpu extends IntelByteCpu {
  register(field: "a" | "b" | "c" | "d" | "e" | "h" | "l" | "sp"): Register;
}
type WordRegister = Register | { readonly source: ValueSource; readonly write: readonly Statement[] };
type WordTransfer = "immediate" | "load" | "store" | "copy";

/** Pairs are views of two stored bytes, read and written high byte first. */
export function intelWordRegister(cpu: IntelWordCpu, pair: RegisterPair | "sp"): WordRegister {
  if (pair === "sp") return cpu.register("sp");
  const [highField, lowField] = pairBytes[pair], high = cpu.register(highField), low = cpu.register(lowField);
  return { source: { name: pair.toUpperCase(), width: 16,
    steps: [readRegister("high", high), readRegister("low", low)], result: concat(value("high"), value("low")) },
    write: [writeRegister(high, highByte(value("result"))), writeRegister(low, lowByte(value("result")))],
  };
}

const immediateWord: ValueSource = { name: "immediate word, low byte first", width: 16,
  steps: [fetchByte("low"), fetchByte("high")], result: concat(value("high"), value("low")) };

/** Complete word transfers own operand fetching, source capture, and ordered writes; flags are never accessed. */
export function intelWordTransfer(cpu: IntelWordCpu, register: WordRegister, operation: WordTransfer, name: string): InstructionDefinition {
  const stored = "kind" in register, memory = operation === "load" || operation === "store";
  const address = value("address"), next = addWrap(address, literal(16, 1));
  const source: ValueSource = operation === "immediate" ? immediateWord : operation === "load"
    ? { name: "memory word, low byte first", width: 16,
      steps: [readSource("address", immediateWord), readMemory("low", address), readMemory("high", next)], result: concat(value("high"), value("low")) }
    : stored ? registerSource(register) : register.source;
  const destination = operation === "copy" ? cpu.register("sp") : operation === "store"
    ? [writeMemory(address, lowByte(value("result"))), writeMemory(next, highByte(value("result")))]
    : stored ? register : register.write;
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: (memory ? "Fetch the complete address low byte first, then " : operation === "immediate" ? "Fetch the immediate low byte then high byte; " : "")
      + (operation === "store" ? "capture the complete source before writing memory low byte then high byte, wrapping at FFFF. Never read the destination; a failed second write retains the first. "
        : operation === "load" ? "read memory low byte then high byte, wrapping at FFFF. Only after both reads succeed, write the destination. "
        : operation === "copy" ? "Capture the complete source, then write SP without memory access. " : "write the destination only after both fetches succeed. ")
      + "Register pairs use explicit high-then-low byte reads and writes. Preserve flags, alternate banks, and control state without accessing them. Completed accesses remain on failure.",
    steps: [...(operation === "store" ? [readSource("address", immediateWord)] : []), ...transfer(destination, source)],
  });
}

/** The shared base inventory binds LXI/LHLD/SHLD/SPHL or their Z80 LD counterparts. */
export function intelWordTransfers(cpu: IntelWordCpu, names: (register: RegisterPair | "sp", operation: WordTransfer) => string) {
  return instructionSet(Object.values(intelWordTransferForms).flat().map(([opcode, { register, operation }]) =>
    [opcode, intelWordTransfer(cpu, intelWordRegister(cpu, register), operation, names(register, operation))]));
}

/** Capture the source before writing; ordinary stores read HL after the source, indexed forms take one resolved address. */
export function intelByteTransfer(cpu: IntelByteCpu, destination: IntelByteOperand, source: IntelByteOperand | "immediate",
  name: string, addressing: "hl" | "resolved" | { readonly mask: number } = "hl"): InstructionDefinition {
  if (destination === "m" && source === "m") throw new Error("The memory-to-memory slot belongs to HALT.");
  const resolved = addressing === "resolved";
  const hl = [readRegister("high", cpu.register("h")), readRegister("low", cpu.register("l"))];
  const pair = concat(value("high"), value("low"));
  const address = resolved ? value("address") : typeof addressing === "object" ? bitAnd(pair, literal(16, addressing.mask)) : pair;
  return defineInstruction({ cpu: cpu.declaration, name,
    ...(resolved ? { inputs: { address: 16 as const } } : {}),
    explanation: (resolved ? "Entry follows indexed address resolution; use that captured address. " : "Use the selected byte registers; memory uses H then L at the access point. ")
      + (typeof addressing === "object" ? `Mask the memory address to ${addressing.mask.toString(16).toUpperCase()}, preserving the full H and L registers. ` : "")
      + "Capture the source before writing the destination, including self-transfers and unchanged writes. "
      + "Stores never read the destination. Do not access flags or control state. A failed source read or fetch prevents writeback.",
    steps: [
      ...(source === "immediate" ? [fetchByte("result")] : source === "m"
        ? [...(resolved ? [] : hl), readMemory("result", address)] : [readRegister("result", cpu.register(source))]),
      ...(destination === "m" ? [...(resolved ? [] : hl), writeMemory(address, value("result"))] : [writeRegister(cpu.register(destination), value("result"))]),
    ],
  });
}

/** MOV/MVI and LD share encodings and behavior while retaining their native mnemonics. */
export function intelByteTransfers(cpu: IntelByteCpu, move: string, immediate: string, memory: string) {
  const operand = (name: IntelByteOperand | "immediate") => name === "m" ? memory : name === "immediate" ? "n" : name.toUpperCase();
  return instructionSet([...intelByteTransferForms.immediate, ...intelByteTransferForms.matrix].map(([opcode, { destination, source }]) =>
    [opcode, intelByteTransfer(cpu, destination, source, `${source === "immediate" ? immediate : move} ${operand(destination)},${operand(source)}`)]));
}

/** Byte adjustments preserve carry and apply each CPU's flags before register or resolved-memory writeback. */
export function intelByteAdjustment(cpu: IntelByteCpu, mnemonic: string, delta: -1 | 1, flags: FlagPolicy, explanation: string) {
  return Object.fromEntries((["b", "c", "d", "e", "h", "l", "a", "memory"] as const).map(target => {
    const memory = target === "memory";
    return [`${mnemonic.toLowerCase()}${memory ? "Memory" : target.toUpperCase()}`, defineInstruction({
      cpu: cpu.declaration, name: `${mnemonic} ${memory ? "memory" : target.toUpperCase()}`,
      ...(memory ? { inputs: { address: 16 as const } } : {}),
      explanation: (memory ? "Read once at the resolved address. " : "Read the selected byte register. ") + explanation
        + " Apply flags before writing the result; preserve carry without reading it. A failed read prevents later effects; a failed write retains calculated flags.",
      steps: [memory ? readMemory("original", value("address")) : readRegister("original", cpu.register(target)),
        capture("result", (delta === 1 ? addWrap : subtract)(value("original"), literal(8, 1))),
        updateFlags(flags, { original: value("original"), result: value("result") }),
        memory ? writeMemory(value("address"), value("result")) : writeRegister(cpu.register(target), value("result"))],
    })];
  }));
}

/** 8080/Z80 register-code order. Each source captures its own reads; M denotes memory through HL. */
export function intelByteSources(register: (name: "a" | "b" | "c" | "d" | "e" | "h" | "l") => Register) {
  const memory: ValueSource = { name: "memory through HL", width: 8, steps: [
    readRegister("high", register("h")), readRegister("low", register("l")),
    readMemory("byte", concat(value("high"), value("low"))),
  ], result: value("byte") };
  return [
    ...(["b", "c", "d", "e", "h", "l"] as const).map(name => [name.toUpperCase(), registerSource(register(name))] as const),
    ["M", memory], ["A", registerSource(register("a"))], ["byte", immediateByte],
  ] as const;
}

export type IntelByteOperation = "add" | "subtract" | "and" | "xor" | "or" | "compare";

/** Consume captured right, read optional carry before A, then apply flags before writeback. Compare never writes. */
export function intelByteAlu(accumulator: Register, operation: IntelByteOperation, policy: FlagPolicy, incoming?: Flag): readonly Statement[] {
  const carry = incoming === undefined ? undefined : flagValue("carry");
  const left = value("left"), right = value("right"), result = value("result");
  return [
    ...(incoming === undefined ? [] : [readFlag("carry", incoming)]), readRegister("left", accumulator),
    ...(operation === "add" || operation === "subtract" || operation === "compare"
      ? arithmetic(operation === "compare" ? "subtract" : operation, policy, carry)
      : [capture("result", { and: bitAnd, xor: bitXor, or: bitOr }[operation](left, right)), updateFlags(policy, { left, right, result })]),
    ...(operation === "compare" ? [] : [writeRegister(accumulator, result)]),
  ];
}

/** Accumulator rotates write A before carry; callers may append other flag updates. */
export function intelAccumulatorRotate(accumulator: Register, carry: Flag, direction: "left" | "right", circular: boolean): readonly Statement[] {
  const operation = shift(direction, circular ? "outgoing" : carry);
  return [
    readRegister("original", accumulator), ...operation.steps,
    writeRegister(accumulator, value("result")),
    updateFlags({ name: `${accumulator.cpu} rotate carry`, parameters: { original: 8 }, unlisted: "preserve",
      updates: [{ flag: carry, value: operation.carry }],
    }, { original: value("original") }),
  ];
}
