import { add8, evenParity8 } from "../../src/components/cpus/alu.js";
import type { Add8Result } from "../../src/components/cpus/alu.js";

// Compiled, never called: arithmetic facts are readonly and the carry input is a bit.
export function checkAlu(left: number, right: number, carryIn: 0 | 1): void {
  const addition: Add8Result = add8(left, right, carryIn);
  const result: number = addition.result;
  const carry: boolean = addition.carry;
  const halfCarry: boolean = addition.halfCarry;
  const overflow: boolean = addition.overflow;
  const parity: boolean = evenParity8(result);
  add8(left, right);
  // @ts-expect-error Returned arithmetic facts are readonly.
  addition.result = 0;
  // @ts-expect-error Returned carry facts are readonly too.
  addition.carry = true;
  // @ts-expect-error CPU flags are not part of an arithmetic result.
  addition.flags;
  // @ts-expect-error Carry input must be zero or one.
  add8(left, right, 2);
  // @ts-expect-error Callers explicitly convert Boolean flags to carry bits.
  add8(left, right, true);
}
