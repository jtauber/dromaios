import assert from "node:assert/strict";
import { test } from "node:test";
import { Mc6850Polling } from "../../../src/components/devices/generated/mc6850-polling.js";

const reset = { control: 3, rx: 0, tx: 0, full: false };
// MITS 2SIO manual pp. 5–6: 8N2/8N1, RTS low, interrupts off; divide by 1, 16, or 64.
const configurations = [0x10, 0x11, 0x12, 0x14, 0x15, 0x16];

test("MC6850 polling control writes implement the independently transcribed mode table", () => {
  for (let control = 0; control < 256; control++) {
    const output: number[] = [], device = new Mc6850Polling(byte => { output.push(byte); });
    assert.equal(device.size, 2);
    assert.deepEqual(device.snapshot(), reset);
    assert.equal(device.read(0), 0);
    assert.equal(device.offer(42), false);
    assert.throws(() => device.write(1, 42), /Unsupported/);
    device.write(0, 0x15); device.offer(0xa5); device.write(1, 0x42);
    const before = device.snapshot();
    if (control % 4 === 3) {
      device.write(0, control);
      assert.deepEqual(device.snapshot(), reset);
      assert.equal(device.read(0), 0);
    } else if (configurations.includes(control)) {
      device.write(0, control);
      assert.deepEqual(device.snapshot(), { ...before, control });
      assert.equal(device.read(0), 3);
    } else {
      assert.throws(() => device.write(0, control), /Unsupported/);
      assert.deepEqual(device.snapshot(), before);
    }
    assert.deepEqual(output, [0x42]);
  }
});

test("MC6850 polling receives and transmits all bytes without conflating zero with empty", () => {
  for (const control of configurations) {
    const output: number[] = [], device = new Mc6850Polling(byte => { output.push(byte); });
    device.write(0, control);
    assert.equal(device.read(0), 2);
    assert.equal(device.read(1), 0);
    for (let byte = 0; byte < 256; byte++) {
      assert.equal(device.offer(byte), true);
      for (let sample = 0; sample < 3; sample++) assert.equal(device.read(0), 3);
      assert.equal(device.offer(byte ^ 255), false);
      assert.deepEqual(device.snapshot(), { control, rx: byte, tx: byte ? byte - 1 : 0, full: true });
      assert.equal(device.read(1), byte);
      assert.equal(device.read(0), 2);
      assert.equal(device.read(1), byte); // Empty reads retain the previous register contents.
      device.write(1, byte); device.write(1, byte);
      assert.equal(device.read(0), 2);
      assert.deepEqual(output.slice(-2), [byte, byte]);
      assert.equal(device.snapshot().tx, byte);
    }
    assert.equal(output.length, 512);
    device.reset(); assert.deepEqual(device.snapshot(), reset);
  }
});

test("serial snapshots restore independent state and reject invalid fields and profile invariants", () => {
  const state = { control: 0x15, rx: 0xff, tx: 0x80, full: true };
  const first = new Mc6850Polling(() => {}, state), second = new Mc6850Polling(() => {}, first.snapshot());
  state.rx = 1;
  assert.equal(first.read(1), 255);
  assert.equal(second.read(0), 3);
  assert.equal(second.read(1), 255);
  const snapshot = { ...second.snapshot() }; snapshot.control = 3;
  assert.equal(second.read(0), 2);
  for (const invalid of [{ control: 0 }, { control: 0x95 }, { control: 3, full: true },
    { control: 256 }, { rx: -1 }, { tx: 0.5 }, { full: 1 }]) {
    assert.throws(() => new Mc6850Polling(() => {}, { ...state, ...invalid } as never));
  }
  assert.throws(() => new Mc6850Polling(null as never), TypeError);
  assert.throws(() => new Mc6850Polling(() => {}, null as never), TypeError);
});

test("invalid host accesses have no effects; output commits before a throwing observer", () => {
  const error = new Error("host output failed"); let calls = 0;
  const device = new Mc6850Polling(byte => {
    calls++;
    assert.equal(device.snapshot().tx, byte);
    assert.equal(device.read(0), 2);
    throw error;
  });
  device.write(0, 0x15);
  for (const value of [-1, 256, 1.5, NaN, Infinity]) {
    assert.throws(() => device.offer(value), RangeError);
    assert.throws(() => device.write(1, value), RangeError);
    assert.throws(() => device.read(value), RangeError);
    assert.throws(() => device.write(value, 42), RangeError);
  }
  assert.deepEqual(device.snapshot(), { ...reset, control: 0x15 });
  assert.throws(() => device.read(2), RangeError);
  assert.throws(() => device.write(2, 42), RangeError);
  assert.throws(() => device.write(1, 42), candidate => candidate === error);
  assert.equal(device.snapshot().tx, 42);
  assert.equal(calls, 1);
  device.reset(); assert.equal(calls, 1);
});
