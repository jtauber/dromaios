import assert from "node:assert/strict";
import { test } from "node:test";
import { flagRegister, negativeZero, signZeroParity8 } from "../../../src/components/cpus/flags.js";

test("packed flags round trip named bits, normalize constant bits, and ignore unused input bits", () => {
  const register = flagRegister({ negative: 7, zero: 6, carry: 0 }, 0x02);
  for (let value = 0; value < 256; value++) {
    const flags = register.decode(value);
    assert.deepEqual(flags, { negative: value >= 128, zero: Math.floor(value / 64) % 2 === 1, carry: value % 2 === 1 });
    assert.equal(register.encode(flags), Number(flags.negative) * 128 + Number(flags.zero) * 64 + 2 + Number(flags.carry));
    assert.deepEqual(register.decode(register.encode(flags)), flags);
  }
  const a = register.decode(0), b = register.decode(0);
  a.carry = true;
  assert.equal(b.carry, false);
});

test("flag layouts own their bit positions, read current values, and handle unsigned bit 31", () => {
  const positions = { high: 31, low: 0 };
  const register = flagRegister(positions);
  positions.high = 1;
  let high = true, reads = 0;
  const flags = { get high() { reads++; return high; }, low: true };
  assert.equal(register.encode(flags), 0x80000001);
  assert.equal(reads, 1);
  high = false;
  assert.equal(register.encode(flags), 1);
  assert.equal(reads, 2);
  assert.deepEqual(register.decode(0xffffffff), { high: true, low: true });
});

test("invalid flag layouts fail before encoding", () => {
  for (const bit of [-1, 32, 0.5, NaN, Infinity]) assert.throws(() => flagRegister({ a: bit }), RangeError);
  for (const fixed of [-1, 0x100000000, NaN, 0.5]) assert.throws(() => flagRegister({}, fixed), RangeError);
  assert.throws(() => flagRegister({ a: 1, b: 1 }), /distinct/);
  assert.throws(() => flagRegister({ a: 1 }, 2), /overlap/);
});

test("result flag calculations cover bytes, words, and unsigned long sign boundaries without storing state", () => {
  for (const width of [8, 16, 32] as const) {
    const values = width === 32 ? [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]
      : Array.from({ length: 2 ** width }, (_, value) => value);
    for (const value of values) {
      const signed = BigInt.asIntN(width, BigInt(value));
      assert.deepEqual(negativeZero(width, value), { n: signed < 0n, z: signed === 0n });
    }
  }
  for (let value = 0; value < 256; value++) {
    const ones = [...value.toString(2)].filter(bit => bit === "1").length;
    assert.deepEqual(signZeroParity8(value), { s: value >= 128, z: value === 0, p: ones % 2 === 0 });
  }
  const old = negativeZero(8, 0);
  negativeZero(8, 128).n = false;
  assert.deepEqual(old, { n: false, z: true });
});
