import assert from "node:assert/strict";
import { test } from "node:test";
import { add, subtract, evenParity8, shiftLeft8, shiftRight8 } from "../../../src/components/cpus/alu.js";
import type { ArithmeticWidth } from "../../../src/components/cpus/alu.js";

test("eight-bit addition matches independent range calculations for every byte pair and carry input", () => {
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
        assert.deepEqual(add(8, left, right, carryIn), expected, `${left} + ${right} + ${carryIn}`);
        if (carryIn === 0) assert.deepEqual(add(8, left, right), expected);
      }
    }
  }
});

test("eight-bit subtraction matches independent range calculations for every byte pair and borrow input", () => {
  for (let left = 0; left < 256; left++) {
    for (let right = 0; right < 256; right++) {
      for (const borrowIn of [0, 1] as const) {
        const difference = left - right - borrowIn;
        const signedDifference = (left < 128 ? left : left - 256)
          - (right < 128 ? right : right - 256) - borrowIn;
        const expected = {
          result: (difference + 256) % 256,
          borrow: difference < 0,
          halfBorrow: (left % 16) - (right % 16) - borrowIn < 0,
          overflow: signedDifference < -128 || signedDifference > 127,
        };
        assert.deepEqual(subtract(8, left, right, borrowIn), expected, `${left} - ${right} - ${borrowIn}`);
        if (borrowIn === 0) assert.deepEqual(subtract(8, left, right), expected);
      }
    }
  }
});

// Arbitrary-precision ranges provide an independent reference for unsigned wrapping and signed overflow.
function checkArithmetic(width: ArithmeticWidth, left: number, right: number, incoming: 0 | 1): void {
  const modulus = 2n ** BigInt(width);
  const sign = modulus / 2n;
  const a = BigInt(left), b = BigInt(right), bit = BigInt(incoming);
  const signedA = a < sign ? a : a - modulus;
  const signedB = b < sign ? b : b - modulus;
  const sum = a + b + bit, difference = a - b - bit;
  const signedSum = signedA + signedB + bit, signedDifference = signedA - signedB - bit;
  const context = `${width} bits: ${left}, ${right}, incoming ${incoming}`;
  const addition = {
    result: Number(sum % modulus),
    carry: sum >= modulus,
    halfCarry: a % 16n + b % 16n + bit >= 16n,
    overflow: signedSum < -sign || signedSum >= sign,
  };
  const subtraction = {
    result: Number((difference + modulus) % modulus),
    borrow: difference < 0,
    halfBorrow: a % 16n - b % 16n - bit < 0n,
    overflow: signedDifference < -sign || signedDifference >= sign,
  };
  assert.deepEqual(add(width, left, right, incoming), addition, context);
  assert.deepEqual(subtract(width, left, right, incoming), subtraction, context);
  if (incoming === 0) {
    assert.deepEqual(add(width, left, right), addition, context);
    assert.deepEqual(subtract(width, left, right), subtraction, context);
  }
}

for (const width of [16, 32] as const) {
  test(`${width}-bit arithmetic matches BigInt ranges around every bit boundary and across seeded operand pairs`, () => {
    const modulus = 2 ** width;
    const values = new Set([0, modulus - 1, 0x55555555 % modulus, 0xaaaaaaaa % modulus]);
    for (let bit = 0; bit < width; bit++) {
      for (const delta of [-1, 0, 1]) values.add(2 ** bit + delta);
    }
    for (const left of values) {
      for (const right of values) {
        for (const incoming of [0, 1] as const) checkArithmetic(width, left, right, incoming);
      }
    }
    let seed = 0x12345678;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % modulus;
    };
    for (let pair = 0; pair < 4096; pair++) {
      const left = next(), right = next();
      for (const incoming of [0, 1] as const) checkArithmetic(width, left, right, incoming);
    }
  });
}

test("32-bit results stay unsigned through sign changes, full carries, and full borrows", () => {
  assert.deepEqual(add(32, 0x7fffffff, 0, 1), {
    result: 0x80000000, carry: false, halfCarry: true, overflow: true,
  });
  assert.deepEqual(add(32, 0xffffffff, 0xffffffff, 1), {
    result: 0xffffffff, carry: true, halfCarry: true, overflow: false,
  });
  assert.deepEqual(subtract(32, 0, 0, 1), {
    result: 0xffffffff, borrow: true, halfBorrow: true, overflow: false,
  });
  assert.deepEqual(subtract(32, 0x80000000, 0x7fffffff, 1), {
    result: 0, borrow: false, halfBorrow: true, overflow: true,
  });
});

test("addition results remain independent across calls and caller edits", () => {
  const first = add(8, 0x7f, 0, 1);
  const next = add(8, 0xff, 0, 1);
  assert.deepEqual(first, { result: 0x80, carry: false, halfCarry: true, overflow: true });
  // Deliberately bypass readonly typing: returned facts do not share mutable state.
  Reflect.set(first, "result", 0);
  Reflect.set(first, "carry", true);
  assert.deepEqual(next, { result: 0, carry: true, halfCarry: true, overflow: false });
  assert.deepEqual(add(8, 0x7f, 0, 1), { result: 0x80, carry: false, halfCarry: true, overflow: true });
});

test("subtraction results remain independent across calls and caller edits", () => {
  const first = subtract(8, 0x80, 0, 1);
  const next = subtract(16, 0, 0, 1);
  assert.deepEqual(first, { result: 0x7f, borrow: false, halfBorrow: true, overflow: true });
  Reflect.set(first, "result", 0);
  Reflect.set(first, "borrow", true);
  assert.deepEqual(next, { result: 0xffff, borrow: true, halfBorrow: true, overflow: false });
  assert.deepEqual(subtract(8, 0x80, 0, 1), { result: 0x7f, borrow: false, halfBorrow: true, overflow: true });
});
test("evenParity8 matches a binary-string count for every byte, including zero", () => {
  for (let byte = 0; byte < 256; byte++) {
    const ones = [...byte.toString(2)].filter(digit => digit === "1").length;
    assert.equal(evenParity8(byte), ones % 2 === 0, `parity of ${byte}`);
  }
});


test("byte shifts match bit-string movement for every byte and incoming bit", () => {
  for (let value = 0; value < 256; value++) {
    const bits = value.toString(2).padStart(8, "0");
    for (const incoming of [0, 1] as const) {
      assert.deepEqual(shiftLeft8(value, incoming), {
        result: parseInt(bits.slice(1) + incoming, 2), carry: bits[0] === "1",
      });
      assert.deepEqual(shiftRight8(value, incoming), {
        result: parseInt(incoming + bits.slice(0, -1), 2), carry: bits.at(-1) === "1",
      });
    }
  }
});
