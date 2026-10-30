import assert from "node:assert/strict";
import { test } from "node:test";
import { I8253 } from "../../../src/components/devices/i8253.js";
import { I8253Counter } from "../../../src/components/devices/generated/i8253-counter.js";

function counter(mode: number, divisor: number, access = 3) {
  const counter = new I8253Counter(); counter.setGate(true);
  counter.write(1, access * 16 + mode * 2);
  if (access !== 2) counter.write(0, divisor & 0xff);
  if (access !== 1) counter.write(0, divisor >>> 8);
  return counter;
}

function trace(counter: I8253Counter, pulses: number) {
  return Array.from({ length: pulses }, () => { counter.clock(); return [counter.count(), Number(counter.output())]; });
}

test("8253 modes 0, 2, and 3 follow Intel's count and output waveforms", () => {
  assert.deepEqual(trace(counter(0, 4), 7), [[4, 0], [3, 0], [2, 0], [1, 0], [0, 1], [65535, 1], [65534, 1]]);
  assert.deepEqual(trace(counter(2, 4), 10), [[4, 1], [3, 1], [2, 1], [1, 0], [4, 1], [3, 1], [2, 1], [1, 0], [4, 1], [3, 1]]);
  assert.deepEqual(trace(counter(3, 4), 7), [[4, 1], [2, 1], [4, 0], [2, 0], [4, 1], [2, 1], [4, 0]]);
  assert.deepEqual(trace(counter(3, 5), 11), [[5, 1], [4, 1], [2, 1], [5, 0], [2, 0], [5, 1], [4, 1], [2, 1], [5, 0], [2, 0], [5, 1]]);
});

test("periodic output duration agrees with independent formulas across odd and even divisors", () => {
  for (const mode of [2, 3]) for (let divisor = 2; divisor <= 257; divisor++) {
    const device = counter(mode, divisor);
    device.clock(); // The first pulse loads, it does not count down.
    for (let elapsed = 0; elapsed < divisor * 3; elapsed++) {
      const phase = elapsed % divisor;
      const expectedHigh = mode === 2 ? phase !== divisor - 1 : phase < Math.ceil(divisor / 2);
      assert.equal(device.output(), expectedHigh, `mode ${mode}, divisor ${divisor}, pulse ${elapsed}`);
      device.clock();
    }
  }
});

test("zero is 65536 and single-byte programming clears the unused half", () => {
  for (const access of [1, 2, 3]) {
    const device = counter(0, 0, access); device.clock(); assert.equal(device.count(), 0);
    for (let pulse = 0; pulse < 65535; pulse++) device.clock();
    assert.equal(device.count(), 1); assert.equal(device.output(), false);
    device.clock(); assert.equal(device.count(), 0); assert.equal(device.output(), true);
  }
  const low = counter(0, 0xabcd, 1); low.clock(); assert.equal(low.count(), 0xcd);
  const high = counter(0, 0xabcd, 2); high.clock(); assert.equal(high.count(), 0xab00);
  for (const mode of [2, 3]) {
    const device = counter(mode, 0); device.clock();
    for (let pulse = 1; pulse < 65536; pulse++) {
      device.clock(); assert.equal(device.output(), mode === 2 ? pulse !== 65535 : pulse < 32768);
    }
    device.clock(); assert.equal(device.output(), true); assert.equal(device.count(), 0);
  }
});

test("mode 0 gate pauses; periodic gates force high and reload on the next pulse", () => {
  const oneShot = counter(0, 4); oneShot.clock(); oneShot.clock();
  oneShot.setGate(false); assert.deepEqual(trace(oneShot, 3), [[3, 0], [3, 0], [3, 0]]);
  oneShot.setGate(true); assert.deepEqual(trace(oneShot, 3), [[2, 0], [1, 0], [0, 1]]);
  for (const mode of [2, 3]) {
    const device = counter(mode, 4); trace(device, 4); assert.equal(device.output(), false);
    const paused = device.count(); device.setGate(false); assert.equal(device.output(), true);
    assert.deepEqual(trace(device, 2), [[paused, 1], [paused, 1]]);
    device.setGate(true); assert.deepEqual(trace(device, 2), [[4, 1], [mode === 2 ? 3 : 2, 1]]);
    device.setGate(false); device.setGate(true); device.setGate(false); device.clock();
    assert.equal(device.count(), 4); assert.equal(device.output(), true);
    device.clock(); assert.equal(device.count(), 4); // Loading is not inhibited by GATE.
  }
});

test("mode 0 stops at the first write; periodic rewrites wait for a reload boundary", () => {
  const oneShot = counter(0, 4); trace(oneShot, 2); oneShot.write(0, 2);
  assert.deepEqual(trace(oneShot, 3), [[3, 0], [3, 0], [3, 0]]);
  oneShot.write(0, 0); assert.deepEqual(trace(oneShot, 3), [[2, 0], [1, 0], [0, 1]]);
  const rate = counter(2, 4); trace(rate, 2); rate.write(0, 6); rate.write(0, 0);
  assert.deepEqual(trace(rate, 4), [[2, 1], [1, 0], [6, 1], [5, 1]]);
  const square = counter(3, 6); trace(square, 2); square.write(0, 5); square.write(0, 0);
  assert.deepEqual(trace(square, 6), [[2, 1], [5, 0], [2, 0], [5, 1], [4, 1], [2, 1]]);
});

test("latched counts survive clocks and repeated latches until both bytes have been read", () => {
  const device = counter(0, 0x1234); device.clock(); device.write(1, 0x0f); // Mode/BCD bits are ignored by latch commands.
  device.clock(); device.write(1, 0); assert.equal(device.read(0), 0x34);
  device.clock(); device.write(1, 0); const saved = device.snapshot();
  assert.equal(device.count(), 0x1232); assert.equal(device.output(), false);
  assert.deepEqual(device.snapshot(), saved);
  const restored = new I8253Counter(saved);
  for (const current of [device, restored]) {
    assert.equal(current.read(0), 0x12); current.write(1, 0);
    assert.equal(current.read(0), 0x32); assert.equal(current.read(0), 0x12);
    assert.equal(current.snapshot().count_latched, false);
  }
  assert.deepEqual(restored.snapshot(), device.snapshot());
});

test("byte sequences are independent and incomplete reads reject loading writes atomically", () => {
  const device = counter(0, 0x1234); device.clock();
  assert.equal(device.read(0), 0x34); const saved = device.snapshot();
  assert.throws(() => device.write(0, 0), /Unsupported/); assert.throws(() => device.write(1, 0x34), /Unsupported/);
  assert.deepEqual(device.snapshot(), saved); assert.equal(device.read(0), 0x12);
  device.write(0, 0x78); const restored = new I8253Counter(device.snapshot());
  for (const current of [device, restored]) { current.write(0, 0x56); current.clock(); assert.equal(current.count(), 0x5678); }
  assert.deepEqual(device.snapshot(), restored.snapshot());
  for (const access of [1, 2]) {
    const single = counter(0, 0x1234, access); single.clock(); single.write(1, 0);
    assert.equal(single.read(0), access === 1 ? 0x34 : 0x12); assert.equal(single.snapshot().count_latched, false);
  }
});

test("all reachable pulse/write/latch phases restore independently", () => {
  for (const mode of [0, 2, 3]) {
    const device = counter(mode, 5);
    for (let step = 0; step < 40; step++) {
      const saved = device.snapshot(), restored = new I8253Counter(saved);
      assert.deepEqual(trace(restored, 1), trace(device, 1));
      assert.deepEqual(restored.snapshot(), device.snapshot());
      const advanced = device.snapshot();
      restored.setGate(false); assert.deepEqual(device.snapshot(), advanced);
      if (step === 7) device.write(0, 7);
      if (step === 9) device.write(0, 0);
      if (step === 13) device.write(1, 0);
      if (step === 15 || step === 17) device.read(0);
    }
  }
});

test("the package selects independent channels, mode aliases, and preserves gates on reset", () => {
  const pit = new I8253(); assert.equal(pit.read(3), "bus-error");
  for (const channel of [0, 1, 2]) {
    pit.setGate(channel, true); pit.write(3, channel * 64 + 0x10 + [0, 6, 7][channel]! * 2);
    pit.write(channel, 4 + channel); pit.clock(channel);
    assert.equal(pit.count(channel), 4 + channel);
  }
  pit.clock(1); assert.equal(pit.count(0), 4); assert.equal(pit.count(1), 4); assert.equal(pit.count(2), 6);
  const saved = pit.snapshot(), restored = new I8253(saved);
  assert.deepEqual(restored.snapshot(), saved); restored.clock(2); assert.deepEqual(pit.snapshot(), saved);
  pit.reset(); assert.deepEqual(pit.snapshot().channels.map(ch => [ch.gate, ch.rw, ch.out]), [[true, 0, false], [true, 0, false], [true, 0, false]]);
});

test("unsupported operations and malformed snapshots fail without changing counters", () => {
  const pit = new I8253(); pit.write(3, 0x34); pit.write(0, 3); pit.write(0, 0); pit.clock(0);
  const saved = pit.snapshot();
  for (const command of [0x31, 0x32, 0x38, 0x3a, 0xc0, 0xff]) assert.throws(() => pit.write(3, command), RangeError);
  for (const bad of [-1, 4, NaN, 0.5]) assert.throws(() => pit.read(bad), RangeError);
  assert.throws(() => pit.write(0, 256), RangeError); assert.throws(() => pit.setGate(0, 1 as never), TypeError);
  assert.throws(() => pit.clock(3), RangeError); assert.deepEqual(pit.snapshot(), saved);
  assert.throws(() => new I8253({ channels: [] } as never), /three/);
  for (const changes of [{ mode: 1 }, { rw: 4 }, { reload: 1 }, { rw: 1, read_high: true }, { rw: 0, active: true }]) {
    assert.throws(() => new I8253Counter({ ...saved.channels[0], ...changes }), /Invalid/);
  }
  const counter = new I8253Counter(); counter.write(1, 0x36); counter.write(0, 1);
  const partial = counter.snapshot(); assert.throws(() => counter.write(0, 0), /Unsupported/);
  assert.deepEqual(counter.snapshot(), partial); counter.write(0, 1); counter.clock(); assert.equal(counter.count(), 257);
});
