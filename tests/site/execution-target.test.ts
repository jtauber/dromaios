import assert from "node:assert/strict";
import { test } from "node:test";
import { createExecutionController } from "../../site/interactive/execution-controller.js";
import { createExecutionTarget } from "../../site/interactive/execution-target.js";

test("Run to stops inside a batch before its target and never executes an already-current target", () => {
  const target = createExecutionTarget(10); let pc = 0x2000, tick = () => {};
  const execution = createExecutionController({
    step: () => pc++, canStep: () => true, pauseBeforeStep: (): boolean => target.beforeStep(pc, execution.steps),
    schedule(callback) { tick = callback; return () => {}; }, onChange() {}, batchSize: 10_000,
  });
  target.start(0x2003, execution.steps); execution.run(); tick();
  assert.equal(execution.steps, 3); assert.equal(pc, 0x2003); assert.equal(execution.running, false);
  assert.equal(target.stopped, "reached");
  target.start(pc, execution.steps); execution.run(); tick(); assert.equal(execution.steps, 3);
  target.cancel(); execution.step(); assert.equal(pc, 0x2004); assert.equal(target.stopped, undefined);
  target.start(0x3000, execution.steps); execution.run(); tick();
  assert.equal(execution.steps, 14); assert.equal(target.stopped, "limit"); assert.equal(execution.running, false);
  target.cancel(); assert.equal(target.address, undefined); assert.equal(target.beforeStep(pc, execution.steps), false);
});

test("targets validate addresses, stop on the last allowed boundary, and can be replaced", () => {
  assert.throws(() => createExecutionTarget(0));
  const target = createExecutionTarget(2);
  for (const address of [-1, 0x10000, NaN, 1.5]) assert.throws(() => target.start(address, 0));
  target.start(0xffff, 10); assert.equal(target.beforeStep(0xfffe, 11), false);
  assert.equal(target.beforeStep(0xffff, 12), true); assert.equal(target.stopped, "reached");
  target.start(0, 12); assert.equal(target.stopped, undefined); assert.equal(target.beforeStep(0, 12), true);
});
