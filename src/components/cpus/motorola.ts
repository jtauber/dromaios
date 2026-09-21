import { negativeZero } from "./flags.ts";
import type { ArithmeticWidth, AdditionResult, SubtractionResult } from "./alu.ts";

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
