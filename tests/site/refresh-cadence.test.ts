import assert from "node:assert/strict";
import { test } from "node:test";
import { createRefreshCadence } from "../../site/interactive/refresh-cadence.js";

test("live inspectors sample host time without accumulating a backlog", () => {
  const cadence = createRefreshCadence(100);
  assert.equal(cadence.due(0, true), true);
  for (const now of [1, 16, 99]) assert.equal(cadence.due(now, true), false);
  assert.equal(cadence.due(100, true), true);
  assert.equal(cadence.due(1000, true), true);
  assert.equal(cadence.due(1001, true), false, "a delayed frame does not cause catch-up redraws");
});

test("pause, step and restore refresh immediately; screen and inspectors have independent cadences", () => {
  const screen = createRefreshCadence(1000 / 60), inspector = createRefreshCadence(100);
  assert.equal(screen.due(0, true), true); assert.equal(inspector.due(0, true), true);
  assert.equal(screen.due(17, true), true); assert.equal(inspector.due(17, true), false);
  for (const now of [18, 18, 19]) assert.equal(inspector.due(now, false), true);
  assert.equal(inspector.due(20, true), false);
  assert.equal(inspector.due(119, true), true);
});
