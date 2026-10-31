import assert from "node:assert/strict";
import { test } from "node:test";
import { XtClock, xtOscillatorHz } from "../../../../src/machines/8088/pc-xt/clock.js";
import { XtIo } from "../../../../src/machines/8088/pc-xt/io.js";

function initPic(io: XtIo, mask = 0xfe) {
  io.write(0x20, 0x13); io.write(0x21, 8); io.write(0x21, 9); io.write(0x21, mask);
}

function timedBoard() {
  const io = new XtIo();
  io.write(0x63, 0x99); io.write(0x61, 0x0b); // Hold keyboard clock low; speaker/gate on.
  for (const [channel, count, mode] of [[0, 5, 3], [1, 18, 2], [2, 7, 3]]) {
    io.write(0x43, channel! * 64 + 0x30 + mode! * 2); io.write(0x40 + channel!, count!); io.write(0x40 + channel!, 0);
  }
  initPic(io, 0xfc); // Configure after OUT0 initially goes high: no fabricated initial edge.
  return io;
}

test("the XT clock preserves PIT and microsecond phases across arbitrary batches and saved state", () => {
  let pulses = 0, microseconds = 0;
  const clock = new XtClock();
  clock.advance(11, (us, edge) => { microseconds += us; pulses += Number(edge); });
  assert.equal(pulses, 0); assert.equal(microseconds, 0);
  clock.advance(1, (us, edge) => { microseconds += us; pulses += Number(edge); });
  assert.equal(pulses, 1); assert.equal(microseconds, 0);
  const restored = new XtClock(clock.snapshot());
  const originalEvents: unknown[] = [], replayEvents: unknown[] = [];
  clock.advance(33, (us, edge) => originalEvents.push([clock.snapshot().ticks, us, edge]));
  restored.advance(33, (us, edge) => replayEvents.push([restored.snapshot().ticks, us, edge]));
  assert.deepEqual(replayEvents, originalEvents);
  assert.deepEqual(originalEvents, [[24, 1, true], [36, 1, true], [45, 1, false]]);
  // Cross a whole-second boundary, far beyond the range where ticks * 1e6 is exact.
  const start = xtOscillatorHz * 1000000 - 6, old = new XtClock({ ticks: start });
  let elapsed = 0;
  old.advance(1000, us => { elapsed += us; });
  const expected = (BigInt(start + 1000) * 1000000n) / BigInt(xtOscillatorHz)
    - (BigInt(start) * 1000000n) / BigInt(xtOscillatorHz);
  assert.equal(elapsed, Number(expected));
});

test("clock errors reject before advancement and zero intervals have no effects", () => {
  const clock = new XtClock({ ticks: 11 }); let calls = 0;
  for (const bad of [-1, NaN, 1.5, 0x100000000]) assert.throws(() => clock.advance(bad, () => calls++), RangeError);
  clock.advance(0, () => calls++); assert.equal(calls, 0); assert.deepEqual(clock.snapshot(), { ticks: 11 });
  const limit = new XtClock({ ticks: Number.MAX_SAFE_INTEGER });
  assert.throws(() => limit.advance(1, () => calls++), /exact range/); assert.equal(calls, 0);
  for (const ticks of [-1, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => new XtClock({ ticks }), RangeError);
  clock.reset(); assert.deepEqual(clock.snapshot(), { ticks: 0 });
});

test("mode 0 requests exactly one IRQ0 while continued counting and inspection stay harmless", () => {
  const io = new XtIo(); initPic(io);
  io.write(0x43, 0x10); io.write(0x40, 4);
  io.advanceOscillatorTicks(59); assert.equal(io.irq, false);
  io.advanceOscillatorTicks(1); assert.equal(io.irq, true); assert.equal(io.acknowledge(), 8);
  io.write(0x20, 0x20); io.advanceOscillatorTicks(12 * 65540); assert.equal(io.irq, false);
  const before = io.snapshot();
  void io.refreshOutput; void io.speakerLevel; void io.irq; io.read(0x20); io.read(0x62);
  assert.deepEqual(io.snapshot(), before);
});

test("periodic edges within a single interval reach the PIC even when the final OUT level matches", () => {
  const io = timedBoard();
  assert.equal(io.irq, false); io.advanceOscillatorTicks(12 * 16);
  assert.equal(io.snapshot().pit.channels[0].out, true); assert.equal(io.irq, true);
  assert.equal(io.acknowledge(), 8); io.advanceOscillatorTicks(12 * 15);
  assert.equal(io.irq, false); assert.equal(io.snapshot().pic.irr, 1);
  io.write(0x20, 0x20); assert.equal(io.irq, true); // A pending edge survives service.
});

test("timer 2 gate, PPI status, speaker control, and channel-1 refresh output follow real counters", () => {
  const io = timedBoard();
  io.advanceOscillatorTicks(12); assert.equal(io.speakerLevel, true); assert.equal(io.read(0x62) & 0x20, 0x20);
  io.advanceOscillatorTicks(12 * 4); assert.equal(io.speakerLevel, false); assert.equal(io.read(0x62) & 0x20, 0);
  io.write(0x61, 0x0a); assert.equal(io.timer2Gate, false); assert.equal(io.speakerLevel, true);
  io.advanceOscillatorTicks(12 * 13); assert.equal(io.refreshOutput, false);
  io.advanceOscillatorTicks(12); assert.equal(io.refreshOutput, true);
  io.write(0x61, 0x08); assert.equal(io.speakerLevel, false);
  io.write(0x61, 0x0b); io.advanceOscillatorTicks(12);
  assert.equal(io.snapshot().pit.channels[2].count, 7);
});

test("board batches and partial-phase restores retain pending latches, timer edges, and keyboard duration", () => {
  const whole = timedBoard(), split = timedBoard();
  whole.advanceOscillatorTicks(50003);
  for (let ticks = 0; ticks < 50003;) {
    const count = Math.min(17, 50003 - ticks); split.advanceOscillatorTicks(count); ticks += count;
  }
  assert.deepEqual(split.snapshot(), whole.snapshot());
  whole.write(0x43, 0); whole.read(0x40); whole.write(0x42, 9); // Half-read latch and half-written divisor.
  const saved = whole.snapshot(), restored = new XtIo(saved);
  for (const board of [whole, restored]) {
    board.read(0x40); board.write(0x42, 0); board.advanceOscillatorTicks(236361);
    board.write(0x61, 0xcb); board.write(0x61, 0x4b);
    assert.equal(board.keyboardPending, false); board.advanceOscillatorTicks(114546);
    assert.equal(board.keyboardData, 0xaa); assert.equal(board.keyboardPending, true);
  }
  assert.deepEqual(restored.snapshot(), whole.snapshot()); assert.equal(saved.clock.ticks, 50003);
});

test("snapshot validation rejects broken PIT wiring and CPU-independent board reset resets time", () => {
  const io = timedBoard(); io.advanceOscillatorTicks(100);
  const saved = io.snapshot();
  assert.throws(() => new XtIo({ ...saved, pic: { ...saved.pic, levels: saved.pic.levels ^ 1 } }), /wiring/);
  assert.throws(() => new XtIo({ ...saved, pit: { channels: [{ ...saved.pit.channels[0], gate: false },
    saved.pit.channels[1], saved.pit.channels[2]] } }), /wiring/);
  for (const line of [0, 1, 6]) assert.throws(() => io.setInterruptLine(line, true), /belong/);
  assert.throws(() => io.advanceOscillatorTicks(-1), RangeError); assert.deepEqual(io.snapshot(), saved);
  io.reset(); assert.equal(io.snapshot().clock.ticks, 0); assert.equal(io.irq, false);
  assert.ok(io.snapshot().pit.channels.every(counter => counter.rw === 0));
});
