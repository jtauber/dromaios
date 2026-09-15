import { add, subtract } from "./alu.ts";
import type { ShiftResult } from "./alu.ts";

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

function setNZ(flags: ConditionCodes, value: number, width: 8 | 16 = 8): void {
  flags.n = value >= 2 ** (width - 1);
  flags.z = value === 0;
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
      const { result, carry, halfCarry, overflow } = add(8, left, right, carryIn);
      setNZ(flags, result);
      flags.h = halfCarry;
      flags.c = carry;
      flags.v = overflow;
      return result;
    },
    subtract(left: number, right: number, borrowIn: 0 | 1 = 0): number {
      const flags = readFlags();
      const { result, borrow, overflow } = subtract(8, left, right, borrowIn);
      setNZ(flags, result);
      flags.c = borrow;
      flags.v = overflow;
      return result;
    },
    decimalAdjust(value: number): number {
      const flags = readFlags();
      // Both corrections use the original byte and flags, before either nibble changes.
      const low = (value & 0x0f) > 9 || flags.h ? 0x06 : 0;
      const high = value > 0x99 || flags.c ? 0x60 : 0;
      const { result, carry } = add(8, value, low + high);
      setNZ(flags, result);
      flags.v = false; // Explicit model policy for the hardware-undefined V; preserve H.
      flags.c = flags.c || carry;
      return result;
    },
    complement(value: number): number {
      const flags = readFlags(), result = value ^ 0xff;
      setNZ(flags, result);
      flags.v = false;
      flags.c = true;
      return result;
    },
    adjust(value: number, delta: -1 | 1): number {
      const flags = readFlags(), result = (value + delta) & 0xff;
      setNZ(flags, result);
      flags.v = value === (delta === 1 ? 0x7f : 0x80);
      return result;
    },
    shift({ result, carry }: ShiftResult): number {
      const flags = readFlags();
      setNZ(flags, result);
      flags.c = carry;
      return result; // V is preserved here; each CPU selects the instructions that replace it.
    },
    test(value: number, width: 8 | 16 = 8): void {
      const flags = readFlags();
      setNZ(flags, value, width);
      flags.v = false; // 6800 TST additionally clears C; 6809 TST preserves it.
    },
    clear(): number {
      const flags = readFlags();
      setNZ(flags, 0);
      flags.v = flags.c = false;
      return 0;
    },
  };
}
