import { addWrap, bitOr, concat, extend, highByte, literal, lowByte, projectAddress, readMemory, readRegister, readSource, subtract, value, writeMemory, writeRegister } from "./model.ts";
import type { CpuDeclaration, FlagPolicy, NumberExpression, Register, Statement, ValueSource } from "./model.ts";
import { readWord, transfer, writeWord } from "./builders.ts";
import { defineInstruction } from "./validate.ts";

export interface Stack {
  readonly push: (contents: NumberExpression, name?: string) => readonly Statement[];
  readonly pop: ValueSource;
  readonly explanation: string;
}

/** A descending byte stack. The pointer names either the top occupied byte or the next free byte. */
export function byteStack(pointer: Register, position: "occupied" | "free", page = 0) {
  if ((pointer.width === 16 && page !== 0) || !Number.isInteger(page) || page < 0 || page > 0xff00 || page % 256 !== 0) {
    throw new Error("A fixed stack page must be an aligned word address used with a byte pointer.");
  }
  const address = (name: string) => pointer.width === 8 ? bitOr(literal(16, page), extend(value(name), 16)) : value(name);
  const adjust = (name: string, delta: -1 | 1): readonly Statement[] => [readRegister(name, pointer),
    writeRegister(pointer, (delta === 1 ? addWrap : subtract)(value(name), literal(pointer.width, 1)))];
  const push = (contents: NumberExpression, name = "byte"): readonly Statement[] => [
    ...(position === "occupied" ? adjust(`${name}Pointer`, -1) : []),
    readRegister(`${name}Address`, pointer), writeMemory(address(`${name}Address`), contents),
    ...(position === "free" ? adjust(`${name}Pointer`, -1) : []),
  ];
  const pop: ValueSource = { name: `pop byte through ${pointer.field.toUpperCase()}`, width: 8,
    steps: [...(position === "free" ? adjust("pointer", 1) : []),
      readRegister("address", pointer), readMemory("byte", address("address")),
      ...(position === "occupied" ? adjust("pointer", 1) : [])], result: value("byte"),
  };
  return { push, pop, explanation: `${pointer.field.toUpperCase()} wraps at ${pointer.width} bits`
    + (pointer.width === 8 ? ` within page ${page.toString(16).toUpperCase().padStart(4, "0")}. ` : ". ")
    + (position === "occupied" ? "Push decrements before each write; pop increments after each successful read. "
      : "Push decrements after each successful write; pop increments before each read. ")
    + "Each adjustment reads the live pointer; failed accesses retain only completed effects." };
}

/** Word order describes the memory layout; pushes reverse the low-address-first pop order. */
export function wordStack(bytes: ReturnType<typeof byteStack>, order: "little-endian" | "big-endian"): Stack {
  const first = order === "little-endian" ? "low" : "high", second = first === "low" ? "high" : "low";
  return { explanation: `${bytes.explanation} Words are ${order}.`,
    push: (contents, name) => [
      ...bytes.push((second === "high" ? highByte : lowByte)(contents), name === undefined ? "first" : name + "First"),
      ...bytes.push((first === "high" ? highByte : lowByte)(contents), name === undefined ? "second" : name + "Second"),
    ],
    pop: { name: `pop ${order} word`, width: 16,
      steps: [readSource(first, bytes.pop), readSource(second, bytes.pop)], result: concat(value("high"), value("low")) },
  };
}

/** 8088 word stack: adjust once per word; capture SS:SP before transferring low then high. */
export function segmentedWordStack(segment: Register, pointer: Register) {
  if (segment.width !== 16 || pointer.width !== 16) throw new Error("A segmented word stack requires word registers.");
  const address = (segment: string, offset: string, high: boolean) =>
    projectAddress(value(segment), high ? addWrap(value(offset), literal(16, 1)) : value(offset), 4, 20);
  const word = readWord("low-first", address("segment", "offset", false), address("segment", "offset", true));
  return {
    explanation: "Push decrements SP by two before capturing SS:SP; pop captures SS:SP before reading, then increments the live SP after both reads. "
      + "Transfer low then high with each logical offset wrapped before physical projection. Failed accesses retain completed pointer changes and byte transfers.",
    push: (contents, name = "stack") => [
      readRegister(name + "Pointer", pointer), writeRegister(pointer, subtract(value(name + "Pointer"), literal(16, 2))),
      readRegister(name + "Segment", segment), readRegister(name + "Offset", pointer),
      ...writeWord("low-first", address(name + "Segment", name + "Offset", false), address(name + "Segment", name + "Offset", true), contents),
    ],
    pop: { name: "pop segmented word", width: 16,
      steps: [readRegister("segment", segment), readRegister("offset", pointer),
        ...word.steps,
        readRegister("pointer", pointer), writeRegister(pointer, addWrap(value("pointer"), literal(16, 2)))],
      result: word.result,
    },
  } satisfies Stack;
}

/** Capture the whole source before the first stack access. */
export function stackPush(cpu: CpuDeclaration, name: string, stack: Stack, source: ValueSource) {
  return defineInstruction({ cpu, name,
    explanation: "Capture the complete source, then push it. Preserve flags and other registers. " + stack.explanation,
    steps: [readSource("original", source), ...stack.push(value("original"))],
  });
}

/** Do not replace the destination or apply its flags until the complete pop succeeds. */
export function stackPop(cpu: CpuDeclaration, name: string, stack: Stack, destination: Register | readonly Statement[], flags?: FlagPolicy) {
  return defineInstruction({ cpu, name,
    explanation: "Pop the complete value before writing the destination. "
      + (flags ? `Then apply ${flags.name}, preserving unlisted flags. ` : "Preserve all flags. ")
      + "Preserve other registers and control state. " + stack.explanation,
    steps: transfer(destination, stack.pop, flags),
  });
}
