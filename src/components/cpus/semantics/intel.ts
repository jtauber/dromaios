import { bitAnd, bitOr, bitXor, capture, concat, flagValue, readFlag, readMemory, readRegister, updateFlags, value, writeRegister } from "./model.ts";
import type { Flag, FlagPolicy, Register, Statement, ValueSource } from "./model.ts";
import { arithmetic, immediateByte, registerSource, shift } from "./builders.ts";

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

/** 8008/8080 accumulator rotates write A before carry and preserve every other flag. */
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
