import { add, subtract, evenParity8 } from "../../src/components/cpus/alu.js";
import type { AdditionResult, SubtractionResult, ArithmeticWidth } from "../../src/components/cpus/alu.js";

// Compiled, never called: arithmetic facts are readonly and the carry input is a bit.
export function checkAlu(left: number, right: number, carryIn: 0 | 1, width: ArithmeticWidth): void {
  const addition: AdditionResult = add(8, left, right, carryIn);
  const result: number = addition.result;
  const carry: boolean = addition.carry;
  const halfCarry: boolean = addition.halfCarry;
  const overflow: boolean = addition.overflow;
  const parity: boolean = evenParity8(result);
  add(8, left, right);
  add(16, left, right, carryIn);
  add(32, left, right, carryIn);
  add(width, left, right, carryIn);
  const subtraction: SubtractionResult = subtract(width, left, right, carryIn);
  const borrow: boolean = subtraction.borrow;
  const halfBorrow: boolean = subtraction.halfBorrow;
  const difference: number = subtraction.result;
  const subtractionOverflow: boolean = subtraction.overflow;
  subtract(8, left, right);
  subtract(16, left, right);
  subtract(32, left, right);
  // @ts-expect-error Returned arithmetic facts are readonly.
  addition.result = 0;
  // @ts-expect-error Returned carry facts are readonly too.
  addition.carry = true;
  // @ts-expect-error CPU flags are not part of an arithmetic result.
  addition.flags;
  // @ts-expect-error Carry input must be zero or one.
  add(8, left, right, 2);
  // @ts-expect-error Callers explicitly convert Boolean flags to carry bits.
  add(8, left, right, true);
  // @ts-expect-error Borrow input must be zero or one.
  subtract(width, left, right, -1);
  // @ts-expect-error Boolean flags must be converted to borrow bits.
  subtract(width, left, right, true);
  // @ts-expect-error Arithmetic supports only the declared widths.
  add(24, left, right);
  // @ts-expect-error A word width is expressed in bits, not bytes.
  subtract(2, left, right);
  // @ts-expect-error Subtraction facts are readonly too.
  subtraction.result = 0;
  // @ts-expect-error Borrow facts are readonly.
  subtraction.borrow = false;
  // @ts-expect-error Carry and borrow have distinct meanings and names.
  subtraction.carry;
  // @ts-expect-error Addition does not report a borrow.
  addition.borrow;
}
