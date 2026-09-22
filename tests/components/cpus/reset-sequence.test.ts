import assert from "node:assert/strict";
import { test } from "node:test";
import { resetSequence } from "../../../src/components/cpus/reset-sequence.js";

test("reset sequences distinguish returned faults, classified failures, and host throws", () => {
  const fault = { address: 3 }, signal = Symbol("modeled fault");
  for (const result of [undefined, fault]) {
    const events: unknown[] = [];
    assert.equal(resetSequence(() => { events.push("attempt"); return result; },
      failed => { events.push(failed); }, () => { assert.fail("No error to classify"); }), result);
    assert.deepEqual(events, ["attempt", result !== undefined]);
  }
  const events: unknown[] = [];
  assert.equal(resetSequence(() => { throw signal; }, failed => { events.push(failed); },
    error => { assert.equal(error, signal); return fault; }), fault);
  assert.deepEqual(events, [true]);
  for (const thrown of [undefined, null, "bus-error", fault, Error("host failure")]) {
    let completed = false, caught = false;
    try {
      resetSequence(() => { throw thrown; }, () => { completed = true; }, () => undefined);
    } catch (error) { caught = true; assert.equal(error, thrown); }
    assert.equal(caught, true); assert.equal(completed, false);
  }
});

test("completion failures escape without reclassification or a second completion", () => {
  const error = Error("completion failed"), effects: string[] = [];
  assert.throws(() => resetSequence(() => { effects.push("attempt"); }, () => {
    effects.push("complete"); throw error;
  }, () => { assert.fail("Completion is outside fault classification"); }), thrown => thrown === error);
  assert.deepEqual(effects, ["attempt", "complete"]);
});
