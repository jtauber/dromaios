import { add, subtract } from "./alu.ts";
import { negativeZero } from "./flags.ts";
import type { ArithmeticWidth, AdditionResult, SubtractionResult, ShiftResult } from "./alu.ts";

interface ConditionCodes { n: boolean; z: boolean; v: boolean; c: boolean }
type Condition = (flags: Readonly<ConditionCodes>) => boolean;

// Motorola condition pairs: ttt selects a test, p selects that test or its inverse.
// The 6800 omits BRN; the 68000 gives condition 0001 a BSR meaning only in its branch family.
export const motorolaConditionPairs: readonly Condition[] = [
  () => true,                    // 000: T / F (BRA / BRN)
  ({ c, z }) => !c && !z,         // 001: HI / LS
  ({ c }) => !c,                 // 010: CC (HS) / CS (LO)
  ({ z }) => !z,                 // 011: NE / EQ
  ({ v }) => !v,                 // 100: VC / VS
  ({ n }) => !n,                 // 101: PL / MI
  ({ n, v }) => n === v,         // 110: GE / LT
  ({ n, v, z }) => !z && n === v, // 111: GT / LE
];
export const motorolaConditions: readonly Condition[] = motorolaConditionPairs.flatMap(test => [test, flags => !test(flags)]);

/** Ordinary Motorola arithmetic changes NZVC; callers separately schedule H, X, and writeback. */
export function motorolaArithmeticFlags(width: ArithmeticWidth, facts: AdditionResult | SubtractionResult) {
  return { ...negativeZero(width, facts.result), v: facts.overflow,
    c: "carry" in facts ? facts.carry : facts.borrow };
}

/**
 * Byte arithmetic shared by the 6800 and 6809. Read the current flag object at execution
 * so restoring CC cannot leave operations attached to the previous object. Construction reads nothing.
 * These operations preserve H except for addition, and preserve flags they do not name.
 */
export function motorolaByteAlu(readFlags: () => ConditionCodes & { h: boolean }) {
  return {
    add(left: number, right: number, carryIn: 0 | 1 = 0): number {
      const flags = readFlags();
      const facts = add(8, left, right, carryIn);
      Object.assign(flags, motorolaArithmeticFlags(8, facts), { h: facts.halfCarry });
      return facts.result;
    },
    subtract(left: number, right: number, borrowIn: 0 | 1 = 0): number {
      const flags = readFlags();
      const facts = subtract(8, left, right, borrowIn);
      Object.assign(flags, motorolaArithmeticFlags(8, facts));
      return facts.result;
    },
    decimalAdjust(value: number): number {
      const flags = readFlags();
      // Both corrections use the original byte and flags, before either nibble changes.
      const low = (value & 0x0f) > 9 || flags.h ? 0x06 : 0;
      const high = value > 0x99 || flags.c ? 0x60 : 0;
      const { result, carry } = add(8, value, low + high);
      Object.assign(flags, negativeZero(8, result));
      flags.v = false; // Explicit model policy for the hardware-undefined V; preserve H.
      flags.c = flags.c || carry;
      return result;
    },
    complement(value: number): number {
      const flags = readFlags(), result = value ^ 0xff;
      Object.assign(flags, negativeZero(8, result));
      flags.v = false;
      flags.c = true;
      return result;
    },
    adjust(value: number, delta: -1 | 1): number {
      const flags = readFlags(), result = (value + delta) & 0xff;
      Object.assign(flags, negativeZero(8, result));
      flags.v = value === (delta === 1 ? 0x7f : 0x80);
      return result;
    },
    shift({ result, carry }: ShiftResult): number {
      const flags = readFlags();
      Object.assign(flags, negativeZero(8, result));
      flags.c = carry;
      return result; // V is preserved here; each CPU selects the instructions that replace it.
    },
    test(value: number, width: 8 | 16 = 8): void {
      const flags = readFlags();
      Object.assign(flags, negativeZero(width, value));
      flags.v = false; // 6800 TST additionally clears C; 6809 TST preserves it.
    },
    clear(): number {
      const flags = readFlags();
      Object.assign(flags, negativeZero(8, 0));
      flags.v = flags.c = false;
      return 0;
    },
  };
}

type Accumulator = "a" | "b";
interface AccumulatorState { a: number; b: number; flags: { c: boolean } }
type AccumulatorOperation = { readonly bits: string; readonly apply: (register: Accumulator, value: number) => void };

/** Shared 6800/6809 byte-operation selectors; addressing and stores remain CPU-specific. */
export function motorolaAccumulatorOperations(readState: () => AccumulatorState, alu: ReturnType<typeof motorolaByteAlu>): readonly AccumulatorOperation[] {
  const load = (register: Accumulator, value: number): void => {
    readState()[register] = value;
    alu.test(value);
  };
  // 1 r mm oooo: r selects A/B, mm selects addressing, and these rows select oooo.
  // Construct only closures here: CPU state is not available until its constructor runs.
  return [
    { bits: "0000", apply: (r, value) => { readState()[r] = alu.subtract(readState()[r], value); } }, // SUBA/B
    { bits: "0001", apply: (r, value) => { alu.subtract(readState()[r], value); } }, // CMPA/B
    { bits: "0010", apply: (r, value) => { readState()[r] = alu.subtract(readState()[r], value, readState().flags.c ? 1 : 0); } }, // SBCA/B
    { bits: "0100", apply: (r, value) => load(r, readState()[r] & value) }, // ANDA/B
    { bits: "0101", apply: (r, value) => alu.test(readState()[r] & value) }, // BITA/B
    { bits: "0110", apply: (r, value) => load(r, value) }, // LDA/B (6800 LDAA/LDAB)
    { bits: "1000", apply: (r, value) => load(r, readState()[r] ^ value) }, // EORA/B
    { bits: "1001", apply: (r, value) => { readState()[r] = alu.add(readState()[r], value, readState().flags.c ? 1 : 0); } }, // ADCA/B
    { bits: "1010", apply: (r, value) => load(r, readState()[r] | value) }, // ORA/B (6800 ORAA/ORAB)
    { bits: "1011", apply: (r, value) => { readState()[r] = alu.add(readState()[r], value); } }, // ADDA/B
  ];
}
