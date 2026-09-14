import assert from "node:assert/strict";
import { test } from "node:test";
import { add8, evenParity8 } from "../../../src/components/cpus/alu.js";

test("add8 matches independent range calculations for every byte pair and carry input", () => {
  for (let left = 0; left < 256; left++) {
    for (let right = 0; right < 256; right++) {
      for (const carryIn of [0, 1] as const) {
        // Use unsigned and signed ranges, rather than the helper's bitwise formulas.
        const unsignedSum = left + right + carryIn;
        const signedSum = (left < 128 ? left : left - 256)
          + (right < 128 ? right : right - 256) + carryIn;
        const expected = {
          result: unsignedSum % 256,
          carry: unsignedSum >= 256,
          halfCarry: (left % 16) + (right % 16) + carryIn >= 16,
          overflow: signedSum < -128 || signedSum > 127,
        };
        assert.deepEqual(add8(left, right, carryIn), expected, `${left} + ${right} + ${carryIn}`);
        if (carryIn === 0) assert.deepEqual(add8(left, right), expected);
      }
    }
  }
});

test("addition results remain independent across calls and caller edits", () => {
  const first = add8(0x7f, 0, 1);
  const next = add8(0xff, 0, 1);
  assert.deepEqual(first, { result: 0x80, carry: false, halfCarry: true, overflow: true });
  // Deliberately bypass readonly typing: returned facts do not share mutable state.
  Reflect.set(first, "result", 0);
  Reflect.set(first, "carry", true);
  assert.deepEqual(next, { result: 0, carry: true, halfCarry: true, overflow: false });
  assert.deepEqual(add8(0x7f, 0, 1), { result: 0x80, carry: false, halfCarry: true, overflow: true });
});

test("evenParity8 matches a binary-string count for every byte, including zero", () => {
  for (let byte = 0; byte < 256; byte++) {
    const ones = [...byte.toString(2)].filter(digit => digit === "1").length;
    assert.equal(evenParity8(byte), ones % 2 === 0, `parity of ${byte}`);
  }
});
