import assert from "node:assert/strict";
import { test } from "node:test";
import { add, subtract } from "../../../src/components/cpus/alu.js";
import { motorolaAccumulatorOperations, motorolaByteAlu, motorolaConditions, motorolaArithmeticFlags } from "../../../src/components/cpus/motorola.js";

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

test("shared Motorola accumulator operations bind lazily and read current registers and restored carry", () => {
  let state = { a: 0x7f, b: 0x80, flags: { h: false, n: false, z: true, v: false, c: false, i: true } };
  let ready = false;
  const readState = () => { assert.ok(ready, "construction must not inspect state"); return state; };
  const operations = motorolaAccumulatorOperations(readState, motorolaByteAlu(() => readState().flags));
  ready = true;
  const adc = operations.find(({ bits }) => bits === "1001")!.apply;
  adc("a", 1);
  assert.deepEqual(state, { a: 0x80, b: 0x80, flags: { h: true, n: true, z: false, v: true, c: false, i: true } });
  const oldState = state, preserved = structuredClone(state);
  state = { a: 0x12, b: 0xff, flags: { h: false, n: true, z: false, v: true, c: true, i: false } };
  adc("b", 0);
  assert.deepEqual(state, { a: 0x12, b: 0, flags: { h: true, n: false, z: true, v: false, c: true, i: false } });
  assert.deepEqual(oldState, preserved);
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
