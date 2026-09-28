import assert from "node:assert/strict";
import { test } from "node:test";
import { createExecutionController } from "../../site/interactive/execution-controller.js";
import { createAltairProgram } from "../../site/interactive/altair-program.js";

function clock() {
  const jobs: { callback: () => void; delay: number; cancelled: boolean }[] = [];
  return {
    jobs,
    get pending() { return jobs.filter(job => !job.cancelled); },
    schedule(callback: () => void, delay: number) {
      const job = { callback, delay, cancelled: false };
      jobs.push(job);
      return () => { job.cancelled = true; };
    },
    tick() {
      const job = jobs.find(job => !job.cancelled);
      assert.ok(job, "An instruction should be scheduled");
      job.cancelled = true;
      job.callback();
    },
  };
}

test("RUN schedules one instruction at a time, ignores duplicate RUN and STEP, and stops at completion", () => {
  const timer = clock();
  let value = 0;
  const observations: number[] = [];
  const execution = createExecutionController({
    step: () => ++value, canStep: () => value < 3,
    onChange: () => { observations.push(value); }, schedule: timer.schedule,
  });
  execution.run(); execution.run(); execution.step();
  assert.equal(value, 0); // The first instruction waits too; STOP can prevent it.
  assert.deepEqual(timer.pending.map(job => job.delay), [1000]);
  for (let i = 1; i <= 3; i++) {
    timer.tick();
    assert.equal(value, i);
    assert.equal(timer.pending.length, i < 3 ? 1 : 0);
    assert.equal(execution.running, i < 3);
  }
  assert.deepEqual(observations, [0, 1, 2, 3]);
  assert.deepEqual(execution.records, [1, 2, 3]);
  execution.run(); execution.step();
  assert.equal(value, 3);
  assert.equal(timer.pending.length, 0);
});

test("STOP cancels queued work without changing state or history; RUN resumes from that state", () => {
  const timer = clock();
  let value = 0;
  const execution = createExecutionController({ step: () => ++value, canStep: () => true, onChange() {}, schedule: timer.schedule });
  execution.run();
  const first = timer.pending[0]!;
  execution.stop();
  first.callback(); // A callback already dispatched by the host must be harmless.
  assert.equal(value, 0);
  execution.step();
  assert.equal(value, 1);
  assert.equal(timer.pending.length, 0);
  execution.run();
  first.callback(); // Still stale even though a new run is active.
  assert.equal(value, 1);
  timer.tick();
  const next = timer.pending[0]!;
  execution.stop();
  next.callback();
  assert.equal(value, 2);
  assert.deepEqual(execution.records, [1, 2]);
  execution.run(); timer.tick(); execution.stop();
  assert.equal(value, 3);
});

test("changing pace replaces the pending callback and never catches up missed instructions", () => {
  const timer = clock();
  let value = 0;
  const execution = createExecutionController({ step: () => ++value, canStep: () => true, onChange() {}, schedule: timer.schedule });
  execution.run();
  const old = timer.pending[0]!;
  execution.setDelay(50);
  assert.deepEqual(timer.pending.map(job => job.delay), [50]);
  old.callback();
  assert.equal(value, 0);
  timer.tick();
  assert.equal(value, 1);
  assert.deepEqual(timer.pending.map(job => job.delay), [50]);
  for (const invalid of [0, -1, NaN, Infinity, 0.5]) assert.throws(() => execution.setDelay(invalid), RangeError);
  assert.deepEqual(timer.pending.map(job => job.delay), [50]);
  execution.stop();
  execution.setDelay(250);
  assert.equal(timer.pending.length, 0);
  execution.run();
  assert.deepEqual(timer.pending.map(job => job.delay), [250]);
});

test("execution rechecks readiness before a scheduled step and refuses blocked manual steps", () => {
  const timer = clock();
  let ready = false;
  let steps = 0;
  const execution = createExecutionController({ step: () => ++steps, canStep: () => ready, onChange() {}, schedule: timer.schedule });
  execution.run(); execution.step();
  assert.equal(timer.pending.length, 0);
  ready = true;
  execution.run();
  ready = false;
  timer.tick();
  assert.equal(steps, 0);
  assert.equal(execution.running, false);
  assert.equal(timer.pending.length, 0);
});

test("failed steps preserve partial effects and earlier records, stop scheduling, and require reset", () => {
  const timer = clock();
  let value = 0;
  let fail = false;
  const execution = createExecutionController({
    step() { value++; if (fail) throw new Error("Access failed"); return value; },
    canStep: () => true, onChange() {}, schedule: timer.schedule,
  });
  execution.step();
  fail = true;
  execution.run(); timer.tick();
  assert.deepEqual([value, execution.running, execution.error, execution.steps], [2, false, "Access failed", 1]);
  assert.deepEqual(execution.records, [1]);
  assert.equal(timer.pending.length, 0);
  execution.run(); execution.step(); execution.stop();
  assert.equal(value, 2);
  assert.equal(execution.error, "Access failed");
  execution.reset();
  fail = false;
  assert.equal(execution.error, undefined);
  assert.deepEqual(execution.records, []);
  assert.equal(execution.steps, 0);
  execution.step();
  assert.deepEqual(execution.records, [3]);
});

test("restart rejects old callbacks even after a new run and preserves the selected pace", () => {
  const timer = clock();
  let value = 0;
  const execution = createExecutionController({ step: () => ++value, canStep: () => true, onChange() {}, schedule: timer.schedule });
  execution.setDelay(250);
  execution.run(); timer.tick();
  const old = timer.pending[0]!;
  execution.reset();
  value = 0;
  assert.equal(execution.running, false);
  assert.equal(timer.pending.length, 0);
  assert.deepEqual(execution.records, []);
  assert.equal(execution.steps, 0);
  execution.run(); old.callback();
  assert.equal(value, 0);
  assert.deepEqual(timer.pending.map(job => job.delay), [250]);
  timer.tick();
  assert.equal(value, 1);
});

test("history retains only the last twelve original records while the execution count continues", () => {
  const timer = clock();
  const records: { number: number }[] = [];
  const execution = createExecutionController({
    step() { const record = { number: records.length + 1 }; records.push(record); return record; },
    canStep: () => records.length < 100, onChange() {}, schedule: timer.schedule,
  });
  execution.run();
  for (let i = 0; i < 100; i++) timer.tick();
  assert.equal(execution.steps, 100);
  assert.equal(execution.records.length, 12);
  assert.deepEqual(execution.records.map(record => record.number), Array.from({ length: 12 }, (_, i) => i + 89));
  for (let i = 0; i < 12; i++) assert.equal(execution.records[i], records[i + 88]);
});

test("paced countdown, STOP/STEP/RUN, and manual execution yield the same CPU records and RAM", () => {
  const timer = clock();
  const lesson = createAltairProgram("countdown");
  const manual = createAltairProgram("countdown");
  const execution = createExecutionController({
    step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
    onChange() {}, schedule: timer.schedule,
  });
  execution.run();
  for (let i = 0; i < 3; i++) timer.tick();
  assert.deepEqual([lesson.snapshot().a, lesson.snapshot().pc, lesson.ram.read(4)], [2, 0x108, 2]);
  const paused = lesson.snapshot();
  const old = timer.pending[0]!;
  execution.stop(); old.callback();
  assert.deepEqual(lesson.snapshot(), paused);
  execution.step(); // JNZ, from the paused PC; no second load.
  assert.equal(lesson.snapshot().pc, 0x103);
  execution.run();
  for (let i = 0; i < 6; i++) timer.tick();
  const expected = Array.from({ length: 10 }, () => manual.step());
  assert.deepEqual(execution.records, expected);
  assert.deepEqual(lesson.snapshot(), manual.snapshot());
  assert.deepEqual([lesson.snapshot().a, lesson.snapshot().pc, lesson.snapshot().flags.z, lesson.snapshot().halted, lesson.ram.read(4)], [0, 0x10b, true, false, 0]);
  assert.equal(execution.steps, 10);
  assert.equal(execution.running, false);
  assert.equal(timer.pending.length, 0);
  for (let address = 0; address < lesson.ram.size; address++) assert.equal(lesson.ram.read(address), manual.ram.read(address));
});

test("the longer zero-start countdown yields after every instruction and keeps bounded history", () => {
  const timer = clock();
  const lesson = createAltairProgram("countdown");
  lesson.ram.write(3, 0);
  const execution = createExecutionController({
    step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
    onChange() {}, schedule: timer.schedule,
  });
  execution.run();
  for (let i = 0; i < 769; i++) {
    assert.equal(timer.pending.length, 1);
    timer.tick();
    assert.ok(execution.records.length <= 12);
  }
  assert.equal(execution.steps, 769);
  assert.equal(execution.running, false);
  assert.equal(lesson.snapshot().pc, 0x10b);
  assert.equal(lesson.snapshot().a, 0);
  assert.equal(lesson.ram.read(4), 0);
});
