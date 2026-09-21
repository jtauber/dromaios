import { negativeZero } from "./flags.ts";
import type { ArithmeticWidth, AdditionResult, SubtractionResult } from "./alu.ts";

// 0010 ttt p: ttt selects T/HI/CC/NE/VC/PL/GE/GT; p selects the test or its inverse.
export const motorolaBranchNames = ["bra", "brn", "bhi", "bls", "bcc", "bcs", "bne", "beq",
  "bvc", "bvs", "bpl", "bmi", "bge", "blt", "bgt", "ble"] as const;

/** Ordinary Motorola arithmetic changes NZVC; callers separately schedule H, X, and writeback. */
export function motorolaArithmeticFlags(width: ArithmeticWidth, facts: AdditionResult | SubtractionResult) {
  return { ...negativeZero(width, facts.result), v: facts.overflow,
    c: "carry" in facts ? facts.carry : facts.borrow };
}
