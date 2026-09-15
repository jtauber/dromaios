import { checkUnsigned } from "../validation.ts";

/** A packed flag register: each named Boolean owns one bit; other bits have fixed output values. */
export function flagRegister<const Bits extends Readonly<Record<string, number>>>(bits: Bits, fixed = 0) {
  checkUnsigned("Fixed flag bits", fixed, 0xffffffff);
  type Flags = { -readonly [Name in keyof Bits]: boolean };
  const fields = Object.entries(bits).map(([name, bit]) => {
    if (!Number.isInteger(bit) || bit < 0 || bit > 31) throw new RangeError("Flag bit must be in 0–31.");
    return [name as keyof Bits, 2 ** bit] as const;
  });
  const mask = fields.reduce((value, [, bit]) => value | bit, 0);
  if (new Set(fields.map(([, bit]) => bit)).size !== fields.length || (fixed & mask) !== 0) {
    throw new Error("Flag bits must be distinct and must not overlap fixed bits.");
  }
  return {
    encode(flags: Readonly<Flags>): number {
      return fields.reduce((value, [name, bit]) => flags[name] ? value | bit : value, fixed) >>> 0;
    },
    decode(value: number): Flags {
      // Every declared bit produces exactly one Boolean; unmodeled input bits are ignored.
      return Object.fromEntries(fields.map(([name, bit]) => [name, (value & bit) !== 0])) as Flags;
    },
  };
}
