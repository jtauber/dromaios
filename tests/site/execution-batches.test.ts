import assert from "node:assert/strict";
import { test } from "node:test";
import { createExecutionController } from "../../site/interactive/execution-controller.js";

function fixture(batchSize: number, limit = Infinity, failAt = Infinity) {
  let count = 0, changes = 0;
  const pending: (() => void)[] = [];
  const controller = createExecutionController({
    step() { if (count === failAt) throw new Error("device failed"); return ++count; },
    canStep: () => count < limit, onChange() { changes++; }, batchSize,
    // Retain cancelled callbacks to exercise a host callback already in flight.
    schedule(callback) { pending.push(callback); return () => {}; },
  });
  return { controller, pending, get count() { return count; }, get changes() { return changes; } };
}

test("run boundaries stop before side effects within a batch while leaving manual Step available", () => {
  let count = 0, boundary = 3;
  const pending: (() => void)[] = [];
  const controller = createExecutionController({
    step: () => ++count, canStep: () => true, pauseBeforeStep: () => count === boundary,
    onChange() {}, batchSize: 20, schedule(callback) { pending.push(callback); return () => {}; },
  });
  controller.run(); pending.shift()!();
  assert.equal(count, 3); assert.equal(controller.running, false);
  assert.equal(controller.error, undefined); assert.equal(pending.length, 0);
  controller.run(); pending.shift()!(); assert.equal(count, 3);
  controller.step(); assert.equal(count, 4);
  boundary = 6; controller.run(); pending.shift()!(); assert.equal(count, 6);
  boundary = 10; controller.run(); const stale = pending.shift()!;
  controller.reset(); stale(); assert.equal(count, 6); assert.equal(controller.steps, 0);
});

test("instruction batches yield once, retain bounded history, and keep manual Step singular", () => {
  const f = fixture(20);
  f.controller.step(); assert.equal(f.count, 1);
  f.controller.run(); f.pending.shift()!();
  assert.equal(f.count, 21); assert.equal(f.changes, 3);
  assert.deepEqual(f.controller.records, Array.from({ length: 12 }, (_, i) => i + 10));
  f.controller.stop(); f.pending.shift()!(); assert.equal(f.count, 21);
  f.controller.step(); assert.equal(f.count, 22);
  f.controller.run(); const stale = f.pending.shift()!; f.controller.reset(); stale();
  assert.equal(f.count, 22); assert.equal(f.controller.steps, 0);
  assert.deepEqual(f.controller.records, []);
});

test("a boundary or error ends a batch immediately", () => {
  for (const [limit, failAt] of [[3, Infinity], [Infinity, 3]]) {
    const f = fixture(20, limit, failAt);
    f.controller.run(); f.pending.shift()!();
    assert.equal(f.count, 3); assert.equal(f.controller.steps, 3);
    assert.equal(f.controller.running, false); assert.equal(f.pending.length, 0);
    assert.equal(f.controller.error, failAt === 3 ? "device failed" : undefined);
  }
  for (const size of [0, -1, 1.5, NaN, Infinity, 10001]) assert.throws(() => fixture(size), RangeError);
});
