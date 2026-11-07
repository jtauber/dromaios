import assert from "node:assert/strict";
import { test } from "node:test";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { createExecutionController } from "../../site/interactive/execution-controller.js";
import { editApple2Register } from "../../site/interactive/apple2-register-edit.js";

test("Step, scheduled Run batches, pause and checkpoint replay reach identical Apple II clocks and state", () => {
  function setup() {
    const session = createApple2Session();
    // INC $10; JMP $0200: eight clocks per loop, independent of host batching.
    [0xe6, 0x10, 0x4c, 0x00, 0x02].forEach((byte, i) => session.machine.ram.write(0x200 + i, byte));
    editApple2Register(session.machine, "pc", "0200");
    return session;
  }
  const single = setup();
  const manual = createExecutionController({ step: () => single.machine.step(), canStep: () => true,
    onChange() {}, schedule: () => { throw new Error("Manual Step cannot schedule a batch"); } });
  for (let i = 0; i < 42; i++) manual.step();
  assert.equal(single.machine.clock.ticks, 168);

  for (const batchSize of [1, 3, 7]) {
    const session = setup(), jobs: (() => void)[] = [];
    const controller = createExecutionController({ step: () => session.machine.step(), canStep: () => true,
      onChange() {}, batchSize, schedule(callback) { jobs.push(callback); return () => {}; } });
    controller.run();
    for (let i = 0; i < 21 / batchSize; i++) jobs.shift()!();
    controller.stop(); const saved = session.snapshot();
    for (const stale of jobs.splice(0)) stale();
    assert.deepEqual(session.snapshot(), saved, "A queued callback after Pause cannot advance time");
    const finish = () => {
      controller.run();
      for (let i = 0; i < 21 / batchSize; i++) jobs.shift()!();
      controller.stop(); jobs.length = 0;
      assert.equal(controller.error, undefined);
      assert.deepEqual(session.snapshot(), single.snapshot());
    };
    finish();
    session.restore(saved); controller.reset(); finish();
    editApple2Register(session.machine, "a", "42");
    assert.equal(session.machine.clock.ticks, 168, "Host register edits preserve elapsed time");
    session.powerOn(); assert.equal(session.machine.clock.ticks, 0);
  }
});
