export type ArithmeticWidth = 8 | 16 | 32;

/** Arithmetic facts from binary addition; each CPU decides how they affect its flags. */
export interface AdditionResult {
  readonly result: number;
  readonly carry: boolean;
  readonly halfCarry: boolean;
  readonly overflow: boolean;
}

/** Arithmetic facts from left - right - borrowIn; borrow flags report underflow. */
export interface SubtractionResult {
  readonly result: number;
  readonly borrow: boolean;
  readonly halfBorrow: boolean;
  readonly overflow: boolean;
}

/** Shifted value and the bit shifted out; flag interpretation belongs to the CPU. */
export interface ShiftResult {
  readonly result: number;
  readonly carry: boolean;
}

/**
 * Binary addition of unsigned operands and an optional carry bit. Inputs must already fit the width.
 * Half carry always describes the low nibble (bit 3 to bit 4), independently of operand width.
 */
export function add(width: ArithmeticWidth, left: number, right: number, carryIn: 0 | 1 = 0): AdditionResult {
  const mask = 2 ** width - 1;
  const signBit = 2 ** (width - 1);
  const sum = left + right + carryIn;
  // Bitwise operations use signed 32-bit values; >>> 0 restores an unsigned result, including at width 32.
  const result = (sum & mask) >>> 0;
  return {
    result,
    carry: sum > mask,
    halfCarry: (left & 0x0f) + (right & 0x0f) + carryIn > 0x0f,
    // Like-signed operands producing an opposite-signed result indicate overflow.
    overflow: (~(left ^ right) & (left ^ result) & signBit) !== 0,
  };
}

/**
 * Binary subtraction of unsigned operands and an optional borrow bit. Inputs must already fit the width.
 * Half borrow always describes a borrow into the low nibble (from bit 4).
 */
export function subtract(width: ArithmeticWidth, left: number, right: number, borrowIn: 0 | 1 = 0): SubtractionResult {
  const mask = 2 ** width - 1;
  const signBit = 2 ** (width - 1);
  const difference = left - right - borrowIn;
  const result = (difference & mask) >>> 0;
  return {
    result,
    borrow: difference < 0,
    halfBorrow: (left & 0x0f) < (right & 0x0f) + borrowIn,
    // Subtracting opposite-signed operands overflows if the result changes the left operand's sign.
    overflow: ((left ^ right) & (left ^ result) & signBit) !== 0,
  };
}

/** Shift an unsigned operand left once, inserting incomingBit into bit 0. */
export function shiftLeft(width: ArithmeticWidth, value: number, incomingBit: 0 | 1): ShiftResult {
  return { result: (((value << 1) | incomingBit) & (2 ** width - 1)) >>> 0,
    carry: (value & 2 ** (width - 1)) !== 0 };
}

/** Shift an unsigned operand right once, inserting incomingBit into the high bit. */
export function shiftRight(width: ArithmeticWidth, value: number, incomingBit: 0 | 1): ShiftResult {
  return { result: ((value >>> 1) | (incomingBit << (width - 1))) >>> 0, carry: (value & 1) !== 0 };
}

/** Whether an unsigned byte has an even number of set bits, including zero. */
export function evenParity8(byte: number): boolean {
  let setBits = 0;
  for (let bit = 0; bit < 8; bit++) {
    setBits += (byte >>> bit) & 1;
  }
  return setBits % 2 === 0;
}
