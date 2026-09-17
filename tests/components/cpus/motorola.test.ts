import assert from "node:assert/strict";
import { test } from "node:test";
import { add, subtract } from "../../../src/components/cpus/alu.js";
import { motorolaDecimalAdjust, motorolaConditions, motorolaArithmeticFlags } from "../../../src/components/cpus/motorola.js";

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

test("Motorola decimal correction updates the supplied flags and preserves H and control flags", () => {
  for (const incoming of [false, true]) {
    const flags = { h: incoming, c: incoming, n: true, z: true, v: true, i: !incoming, f: incoming };
    const result = motorolaDecimalAdjust(0x9a, flags);
    assert.equal(result, 0);
    assert.deepEqual(flags, { h: incoming, c: true, n: false, z: true, v: false, i: !incoming, f: incoming });
  }
});

test("Motorola arithmetic flag policies are pure and leave H/X and control flags to the instruction", () => {
  for (const width of [8, 16, 32] as const) {
    const modulus = 2 ** width, half = modulus / 2;
    for (const left of [0, 1, half - 1, half, modulus - 1]) for (const right of [0, 1, half - 1, half, modulus - 1]) {
      for (const adding of [false, true]) for (const incoming of [0, 1] as const) {
        const total = adding ? left + right + incoming : left - right - incoming;
        const normalized = (total % modulus + modulus) % modulus;
        const signed = (value: number) => value < half ? value : value - modulus;
        const signedTotal = adding ? signed(left) + signed(right) + incoming : signed(left) - signed(right) - incoming;
        const facts = Object.freeze((adding ? add : subtract)(width, left, right, incoming));
        const original = { ...facts };
        const changes = motorolaArithmeticFlags(width, facts);
        assert.deepEqual(changes, { n: normalized >= half, z: normalized === 0,
          v: signedTotal < -half || signedTotal >= half, c: adding ? total >= modulus : total < 0 });
        assert.deepEqual(facts, original);
        const otherFlags = { h: true, x: true, f: false, i: true, n: false, z: true, v: false, c: true };
        assert.deepEqual({ ...otherFlags, ...changes }, { ...changes, h: true, x: true, f: false, i: true });
      }
    }
  }
});
