/** Arithmetic facts from byte addition; each CPU decides how they affect its flags. */
export interface Add8Result {
  readonly result: number;
  readonly carry: boolean;
  readonly halfCarry: boolean;
  readonly overflow: boolean;
}

/** Binary addition of two unsigned bytes and an optional carry bit. Inputs must already be in range. */
export function add8(left: number, right: number, carryIn: 0 | 1 = 0): Add8Result {
  const sum = left + right + carryIn;
  const result = sum & 0xff;
  return {
    result,
    carry: sum > 0xff,
    // Half carry crosses the boundary between bits 3 and 4.
    halfCarry: (left & 0x0f) + (right & 0x0f) + carryIn > 0x0f,
    // Like-signed operands producing an opposite-signed result indicate overflow.
    overflow: (~(left ^ right) & (left ^ result) & 0x80) !== 0,
  };
}

/** Whether an unsigned byte has an even number of set bits, including zero. */
export function evenParity8(byte: number): boolean {
  let setBits = 0;
  for (let bit = 0; bit < 8; bit++) {
    setBits += (byte >>> bit) & 1;
  }
  return setBits % 2 === 0;
}
