import assert from "node:assert/strict";
import { test } from "node:test";
import { InstructionClock } from "../../src/machines/instruction-clock.js";

test("instruction clocks retain exact totals, own their snapshots, and reject invalid or overflowing time", () => {
  const clock = new InstructionClock();
  clock.advance(2); clock.advance(7); clock.advance(0);
  const saved = clock.snapshot(), restored = new InstructionClock(saved);
  assert.equal(clock.ticks, 9);
  clock.advance(3);
  assert.equal(restored.ticks, 9); assert.equal(saved.ticks, 9);
  for (const ticks of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2"] as const) {
    assert.throws(() => new InstructionClock({ ticks } as never), RangeError);
    assert.throws(() => clock.advance(ticks as number), RangeError);
    assert.equal(clock.ticks, 12);
  }
  for (const state of [null, {}, { ticks: 0, extra: 1 }, { ticks: undefined }]) {
    assert.throws(() => new InstructionClock(state as never), /snapshot/);
  }
  const full = new InstructionClock({ ticks: Number.MAX_SAFE_INTEGER });
  full.advance(0);
  assert.throws(() => full.advance(1), RangeError);
  assert.equal(full.ticks, Number.MAX_SAFE_INTEGER);
});
