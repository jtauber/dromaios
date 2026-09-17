import { addWrap, bitAnd, bitOr, bitXor, capture, concat, flagValue, literal, readFlag, readMemory, readRegister, subtract, updateFlags, value, writeMemory, writeRegister } from "./model.ts";
import type { CpuDeclaration, Flag, FlagPolicy, Register, Statement, ValueSource } from "./model.ts";
import { arithmetic, immediateByte, registerSource, shift } from "./builders.ts";
import { defineInstruction } from "./validate.ts";

interface IntelByteCpu {
  readonly declaration: CpuDeclaration;
  register(field: "a" | "b" | "c" | "d" | "e" | "h" | "l"): Register;
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
