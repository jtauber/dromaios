import { negativeZero } from "./flags.ts";
import type { ArithmeticWidth, AdditionResult, SubtractionResult } from "./alu.ts";
import type { ByteMemory } from "./memory-access.ts";
import type { WordInstructionContext } from "./instruction-context.ts";
import { opcodePattern } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";

// 0010 ttt p: ttt selects T/HI/CC/NE/VC/PL/GE/GT; p selects the test or its inverse.
export const motorolaBranchNames = ["bra", "brn", "bhi", "bls", "bcc", "bcs", "bne", "beq",
  "bvc", "bvs", "bpl", "bmi", "bge", "blt", "bgt", "ble"] as const;

// 6809 TFR/EXG postbyte ssss dddd: 0000..0101 = D/X/Y/U/S/PC; 1000..1011 = A/B/CC/DP.
// Only same-width pairs are defined. This inventory drives both generated bodies and decoder bindings.
export const motorola6809TransferForms = ([
  { base: 0b0000, registers: ["d", "x", "y", "u", "s", "pc"] },
  { base: 0b1000, registers: ["a", "b", "cc", "dp"] },
] as const).flatMap(({ base, registers }) => registers.flatMap((source, s) => registers.map((target, d) =>
  [(base + s) << 4 | (base + d), { source, target }] as const)));

/** Ordinary Motorola arithmetic changes NZVC; callers separately schedule H, X, and writeback. */
export function motorolaArithmeticFlags(width: ArithmeticWidth, facts: AdditionResult | SubtractionResult) {
  return { ...negativeZero(width, facts.result), v: facts.overflow,
    c: "carry" in facts ? facts.carry : facts.borrow };
}

/** Bind mm=00 immediate (when supplied) and mm=01/10/11 resolved memory; construction reads no state. */
export function motorolaOperandBindings<State>(readState: () => State,
  modes: readonly { bits: string; address: (instruction: WordInstructionContext) => number | undefined }[]) {
  return (pattern: string, immediate: ((state: State, instruction: WordInstructionContext) => void) | undefined,
    memory: (state: State, address: number, instruction: ByteMemory) => void): readonly OpcodeEntry<(instruction: WordInstructionContext) => "unsupported" | void>[] => [
    ...(immediate ? opcodePattern(pattern.replace("mm", "00"), (instruction: WordInstructionContext) => immediate(readState(), instruction)) : []),
    ...modes.flatMap(({ bits, address: resolve }) => opcodePattern(pattern.replace("mm", bits), (instruction: WordInstructionContext) => {
      const address = resolve(instruction);
      if (address === undefined) return "unsupported";
      memory(readState(), address, instruction);
    })),
  ];
}
