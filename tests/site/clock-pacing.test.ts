import assert from "node:assert/strict";
import { test } from "node:test";
import { createClockPacing } from "../../site/interactive/clock-pacing.js";
import { createExecutionController } from "../../site/interactive/execution-controller.js";
import { create6502Apple2 } from "../../src/machines/generated/6502/apple2.js";
import { editApple2Register } from "../../site/interactive/apple2-register-edit.js";

function example({ hostCost = 0, batchSize = 10000 } = {}) {
  let time = 0, ticks = 0, stopAt = Infinity;
  const jobs: { callback: () => void; cancelled: boolean }[] = [];
  const pacing = createClockPacing({ ticks: () => ticks, hertz: 1000, now: () => time });
  const execution = createExecutionController({
    step() { ticks += 3; time += hostCost; return ticks; }, canStep: () => true,
    pauseBeforeStep: () => ticks >= stopAt, onChange() {}, batchSize, batchTimeMs: 8, now: () => time,
    schedule(callback) { const job = { callback, cancelled: false }; jobs.push(job); return () => { job.cancelled = true; }; },
  });
  execution.setDelay(1); execution.setPacing(pacing);
  return {
    execution, pacing, jobs,
    get ticks() { return ticks; }, set ticks(value: number) { ticks = value; },
    stopAt(value: number) { stopAt = value; },
    elapse(ms: number) { time += ms; },
    batch(ms = 1) {
      time += ms;
      const job = jobs.find(job => !job.cancelled);
      assert.ok(job, "Run should have a pending batch"); job.cancelled = true; job.callback();
    },
  };
}

test("Normal uses elapsed host time and carries instruction overshoot instead of rounding every batch up", () => {
  const p = example(); p.execution.run();
  p.batch(0); assert.equal(p.ticks, 0);
  p.batch(1); assert.equal(p.ticks, 3);
  p.batch(1); assert.equal(p.ticks, 3);
  p.batch(1); assert.equal(p.ticks, 3);
  p.batch(7); assert.equal(p.ticks, 12);
  // An hour's stalled timer supplies only one bounded 16 ms budget.
  p.batch(3_600_000); assert.equal(p.ticks, 30);
  p.batch(1); assert.equal(p.ticks, 30);
  p.batch(2); assert.equal(p.ticks, 33);
  assert.equal(p.execution.error, undefined);
});

test("Pause/resume, speed changes, and restored clocks start fresh and reject queued callbacks", () => {
  const p = example({ batchSize: 4 }); p.execution.run(); p.batch();
  const paused = p.jobs.at(-1)!;
  p.execution.stop(); p.elapse(5000); p.execution.run();
  paused.callback(); assert.equal(p.ticks, 3);
  p.batch(); assert.equal(p.ticks, 6);
  const normal = p.jobs.at(-1)!;
  p.execution.setPacing(undefined);
  normal.callback(); assert.equal(p.ticks, 6);
  p.batch(0); assert.equal(p.ticks, 18, "Unlimited ignores the clock budget");
  const unlimited = p.jobs.at(-1)!;
  p.elapse(5000); p.execution.setPacing(p.pacing);
  unlimited.callback(); assert.equal(p.ticks, 18);
  p.batch(0); assert.equal(p.ticks, 18);
  p.batch(); assert.equal(p.ticks, 21);
  for (const restored of [0, 100000]) {
    const stale = p.jobs.at(-1)!;
    p.execution.reset(); p.ticks = restored; p.elapse(5000);
    p.execution.run(); stale.callback(); assert.equal(p.ticks, restored);
    p.batch(0); assert.equal(p.ticks, restored);
    p.batch(); assert.equal(p.ticks, restored + 3);
  }
});

test("manual Step is immediate, and debugger stops are checked even after the clock budget is spent", () => {
  const p = example(); p.execution.step(); assert.equal(p.ticks, 3);
  assert.equal(p.jobs.length, 0);
  p.stopAt(6); p.execution.run(); p.batch();
  assert.equal(p.ticks, 6); assert.equal(p.execution.running, false);
  assert.ok(p.jobs.every(job => job.cancelled));
});

test("Normal and Unlimited yield on host time as well as instruction count", () => {
  for (const normal of [true, false]) {
    const p = example({ hostCost: 3 });
    p.execution.setPacing(normal ? p.pacing : undefined);
    p.execution.run(); p.batch(16);
    assert.equal(p.execution.steps, 3, "Three 3 ms steps finish before the 8 ms slice yields");
    const pending = p.jobs.at(-1)!;
    p.execution.stop(); pending.callback(); assert.equal(p.execution.steps, 3);
  }
  const p = example({ batchSize: 2 }); p.execution.run(); p.batch(16);
  assert.equal(p.execution.steps, 2);
});

test("Normal, Unlimited and manual Apple II execution produce identical hardware and clock totals", () => {
  function program() {
    const machine = create6502Apple2({ firmware: null });
    // INC $10; JMP $0200: 5 + 3 clocks, deliberately different instruction lengths.
    [0xe6, 0x10, 0x4c, 0x00, 0x02].forEach((byte, i) => machine.ram.write(0x200 + i, byte));
    editApple2Register(machine, "pc", "0200");
    return machine;
  }
  const single = program();
  for (let i = 0; i < 400; i++) single.step();
  assert.equal(single.clock.ticks, 1600);
  for (const normal of [true, false]) {
    for (const batchSize of [1, 7, 10000]) {
      const machine = program(), jobs: (() => void)[] = [];
      let time = 0;
      const execution = createExecutionController({ step: () => machine.step(),
        canStep: () => machine.clock.ticks < 1600, onChange() {}, batchSize,
        schedule(callback) { jobs.push(callback); return () => {}; },
      });
      if (normal) execution.setPacing(createClockPacing({
        ticks: () => machine.clock.ticks, hertz: machine.clock.hertz!, now: () => time,
      }));
      execution.run();
      for (let batches = 0; execution.running; batches++) {
        assert.ok(batches < 1000); time += 0.01; jobs.shift()!();
      }
      assert.equal(execution.error, undefined); assert.equal(execution.steps, 400);
      assert.deepEqual(machine.snapshot(), single.snapshot());
    }
  }
});

test("invalid pacing rates and host batch limits are rejected", () => {
  for (const hertz of [0, -1, NaN, Infinity]) {
    assert.throws(() => createClockPacing({ ticks: () => 0, now: () => 0, hertz }), /frequency/);
  }
  for (const batchTimeMs of [0, -1, NaN, Infinity]) {
    assert.throws(() => createExecutionController({ step() {}, canStep: () => true,
      onChange() {}, schedule: () => () => {}, batchTimeMs }), /time limit/);
  }
});
