import assert from "node:assert/strict";
import { test } from "node:test";
import { motorolaByteAlu, motorolaConditions } from "../../../src/components/cpus/motorola.js";

test("Motorola condition encodings agree with unsigned and signed comparisons", () => {
  for (let left = 0; left < 256; left++) for (let right = 0; right < 256; right++) {
    const signedLeft = left < 128 ? left : left - 256, signedRight = right < 128 ? right : right - 256;
    const difference = signedLeft - signedRight;
    const byte = (left - right + 256) % 256;
    const flags = { n: byte >= 128, z: byte === 0, v: difference < -128 || difference > 127, c: left < right };
    assert.deepEqual(motorolaConditions.map(test => test(flags)), [
      true, false, left > right, left <= right, left >= right, left < right, left !== right, left === right,
      difference >= -128 && difference <= 127, difference < -128 || difference > 127,
      byte < 128, byte >= 128, signedLeft >= signedRight, signedLeft < signedRight,
      signedLeft > signedRight, signedLeft <= signedRight,
    ]);
  }
});

test("the shared Motorola ALU reads flags only during execution and follows replaced flag objects", () => {
  let current = { h: false, n: true, z: true, v: false, c: true, i: true, f: false };
  let reads = 0;
  const alu = motorolaByteAlu(() => { reads++; return current; });
  assert.equal(reads, 0);
  assert.equal(alu.add(0x7f, 1), 0x80);
  assert.deepEqual(current, { h: true, n: true, z: false, v: true, c: false, i: true, f: false });
  const previous = { ...current }, oldObject = current;
  current = { h: false, n: false, z: false, v: true, c: false, i: false, f: true };
  assert.equal(alu.subtract(0, 0xff, 1), 0);
  assert.deepEqual(current, { h: false, n: false, z: true, v: false, c: true, i: false, f: true });
  assert.deepEqual(oldObject, previous);
  assert.equal(reads, 2);
});

test("Motorola byte operations preserve unspecified flags and leave CPU-specific V/C rules to callers", () => {
  const flags = { h: true, n: false, z: true, v: true, c: true, i: true };
  const alu = motorolaByteAlu(() => flags);
  assert.equal(alu.adjust(0x7f, 1), 0x80);
  assert.deepEqual(flags, { h: true, n: true, z: false, v: true, c: true, i: true });
  assert.equal(alu.adjust(0x80, -1), 0x7f);
  assert.equal(flags.v, true);
  assert.equal(alu.shift({ result: 0, carry: false }), 0);
  assert.deepEqual(flags, { h: true, n: false, z: true, v: true, c: false, i: true });
  assert.equal(alu.complement(0), 0xff);
  assert.deepEqual(flags, { h: true, n: true, z: false, v: false, c: true, i: true });
  alu.test(0x80, 16);
  assert.deepEqual(flags, { h: true, n: false, z: false, v: false, c: true, i: true });
  assert.equal(alu.clear(), 0);
  assert.deepEqual(flags, { h: true, n: false, z: true, v: false, c: false, i: true });
});
