import assert from "node:assert/strict";
import { test } from "node:test";
import { ByteOutput } from "../../../src/components/devices/byte-output.js";
import type { ByteOutputSnapshot } from "../../../src/components/devices/byte-output.js";

test("byte output starts empty and inspection, reset, and bus reads never emit output", () => {
  const events: number[] = [];
  const output = new ByteOutput(value => { events.push(value); });
  assert.equal(output.size, 1);
  assert.deepEqual(output.snapshot(), { lastByte: null });
  assert.equal(output.read(0), "bus-error");
  output.reset();
  assert.deepEqual(output.snapshot(), { lastByte: null });
  assert.deepEqual(events, []);
});

test("byte output emits every byte and repeated writes exactly once after updating its latch", () => {
  const events: number[] = [];
  const output = new ByteOutput(value => {
    assert.deepEqual(output.snapshot(), { lastByte: value });
    events.push(value);
    return "bus-error"; // Notifications have no return protocol; only a throw is a host failure.
  });
  const values = [...Array.from({ length: 256 }, (_, value) => value), 0x4c, 0x4c, 0];
  for (const value of values) {
    assert.equal(output.write(0, value), undefined);
    assert.equal(output.read(0), "bus-error");
  }
  assert.deepEqual(events, values);
  assert.deepEqual(output.snapshot(), { lastByte: 0 });
});

test("byte output reset clears the latch without erasing or appending to the host stream", () => {
  const events: number[] = [];
  const output = new ByteOutput(value => { events.push(value); });
  output.write(0, 0x48);
  const before = output.snapshot();
  output.reset();
  assert.deepEqual(output.snapshot(), { lastByte: null });
  assert.deepEqual(before, { lastByte: 0x48 });
  assert.deepEqual(events, [0x48]);
  output.write(0, 0x48);
  assert.deepEqual(events, [0x48, 0x48]);
});

test("byte output owns detached state and restores its latch without replaying output", () => {
  const events: number[] = [];
  const initial = { lastByte: 0x41 };
  const output = new ByteOutput(value => { events.push(value); }, initial);
  initial.lastByte = 0;
  assert.deepEqual(output.snapshot(), { lastByte: 0x41 });
  const saved = output.snapshot();
  const restored = new ByteOutput(value => { events.push(value); }, saved);
  Reflect.set(saved, "lastByte", 0xff);
  assert.deepEqual(restored.snapshot(), { lastByte: 0x41 });
  assert.deepEqual(events, []);
  output.reset();
  restored.write(0, 0x42);
  assert.deepEqual(events, [0x42]);
  assert.deepEqual(output.snapshot(), { lastByte: null });
});

test("byte output rejects invalid connections, state, addresses, and bytes without notifying the host", () => {
  for (const callback of [undefined, null, 0, "write"]) {
    assert.throws(() => new ByteOutput(callback as unknown as (value: number) => void), TypeError);
  }
  const events: number[] = [];
  const callback = (value: number): void => { events.push(value); };
  for (const lastByte of [-1, 256, 0.5, NaN, Infinity, undefined, "41", false]) {
    assert.throws(() => new ByteOutput(callback, { lastByte } as ByteOutputSnapshot), RangeError);
  }
  const output = new ByteOutput(callback, { lastByte: 0x41 });
  for (const address of [-1, 1, 0.5, NaN, Infinity, 0x10000]) {
    assert.throws(() => output.read(address), RangeError);
    assert.throws(() => output.write(address, 0), RangeError);
  }
  for (const value of [-1, 256, 0.5, NaN, Infinity]) assert.throws(() => output.write(0, value), RangeError);
  assert.deepEqual(output.snapshot(), { lastByte: 0x41 });
  assert.deepEqual(events, []);
});

test("byte output propagates host throws unchanged, retains the written byte, and never retries", () => {
  for (const failure of [new Error("host output failed"), "bus-error", undefined]) {
    const events: number[] = [];
    let fail = true;
    const output = new ByteOutput(value => { events.push(value); if (fail) throw failure; });
    assert.throws(() => output.write(0, 0x41), error => error === failure);
    assert.deepEqual(output.snapshot(), { lastByte: 0x41 });
    assert.deepEqual(events, [0x41]);
    fail = false;
    output.write(0, 0x42);
    assert.deepEqual(events, [0x41, 0x42]);
  }
});
