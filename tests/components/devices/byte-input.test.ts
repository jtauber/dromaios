import assert from "node:assert/strict";
import { test } from "node:test";
import { ByteInput } from "../../../src/components/devices/byte-input.js";
import type { ByteInputSnapshot } from "../../../src/components/devices/byte-input.js";

test("byte input starts empty; status and inspection are non-consuming, and empty data reads return zero", () => {
  const input = new ByteInput();
  assert.equal(input.size, 2);
  assert.deepEqual(input.snapshot(), { pendingByte: null });
  for (let index = 0; index < 3; index++) {
    assert.equal(input.read(0), 0);
    assert.equal(input.read(1), 0);
    assert.deepEqual(input.snapshot(), { pendingByte: null });
  }
});

test("byte input accepts and consumes every byte, distinguishing a pending zero from empty", () => {
  const input = new ByteInput();
  for (let value = 0; value < 256; value++) {
    assert.equal(input.offer(value), true);
    const saved = input.snapshot();
    assert.deepEqual(saved, { pendingByte: value });
    assert.equal(input.read(0), 1);
    assert.equal(input.read(0), 1);
    assert.equal(input.read(1), value);
    assert.equal(input.read(0), 0);
    assert.equal(input.read(1), 0);
    assert.deepEqual(input.snapshot(), { pendingByte: null });
    assert.deepEqual(saved, { pendingByte: value });
  }
});

test("byte input rejects a second offer without replacing data, including repeated bytes", () => {
  const input = new ByteInput();
  assert.equal(input.offer(0x4c), true);
  for (let value = 0; value < 256; value++) assert.equal(input.offer(value), false);
  assert.equal(input.read(1), 0x4c);
  assert.equal(input.offer(0x4c), true);
  assert.equal(input.read(1), 0x4c);
  assert.equal(input.read(0), 0);
});

test("byte input reset and restoration own detached pending state", () => {
  const initial = { pendingByte: 0 };
  const input = new ByteInput(initial);
  initial.pendingByte = 0xff;
  assert.deepEqual(input.snapshot(), { pendingByte: 0 });
  const saved = input.snapshot();
  const restored = new ByteInput(saved);
  Reflect.set(saved, "pendingByte", 0x41);
  input.reset();
  assert.deepEqual(input.snapshot(), { pendingByte: null });
  assert.equal(restored.read(0), 1);
  assert.equal(restored.read(1), 0);
  assert.equal(restored.offer(0x42), true);
  restored.reset();
  assert.equal(restored.read(0), 0);
  assert.equal(restored.read(1), 0);
});

test("byte input bus writes fail without consuming or replacing either empty or full state", () => {
  for (const pendingByte of [null, 0, 0xff]) {
    const input = new ByteInput({ pendingByte });
    for (const address of [0, 1]) {
      for (let value = 0; value < 256; value++) {
        assert.equal(input.write(address, value), "bus-error");
        assert.deepEqual(input.snapshot(), { pendingByte });
      }
    }
  }
});

test("byte input validates host values before any state change, even when an offer would be rejected", () => {
  const invalid = [-1, 256, 0.5, NaN, Infinity, undefined, "41", false];
  for (const pendingByte of invalid) {
    assert.throws(() => new ByteInput({ pendingByte } as ByteInputSnapshot), RangeError);
  }
  for (const pendingByte of [null, 0x41]) {
    const input = new ByteInput({ pendingByte });
    for (const value of invalid) {
      assert.throws(() => input.offer(value as number), RangeError);
      assert.throws(() => input.write(0, value as number), RangeError);
      assert.throws(() => input.write(1, value as number), RangeError);
    }
    for (const address of [-1, 2, 0.5, NaN, Infinity]) {
      assert.throws(() => input.read(address), RangeError);
      assert.throws(() => input.write(address, 0), RangeError);
    }
    assert.deepEqual(input.snapshot(), { pendingByte });
  }
});
