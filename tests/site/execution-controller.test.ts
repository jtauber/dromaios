import assert from "node:assert/strict";
import { test } from "node:test";
import { createExecutionController } from "../../site/interactive/execution-controller.js";
import { createTerminalLesson } from "../../site/interactive/terminal-lesson.js";
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

test("STOP before a buffer store preserves A and later input; resume stores once and reads RAM for playback", () => {
  const timer = clock();
  const lesson = createTerminalLesson("buffer");
  const execution = createExecutionController({
    step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
    onChange() {}, schedule: timer.schedule,
  });
  lesson.offerInput(72);
  execution.run();
  for (let i = 0; i < 8; i++) timer.tick();
  const queued = timer.pending[0]!;
  const state = lesson.snapshot();
  execution.stop(); lesson.offerInput(10); queued.callback();
  assert.deepEqual(lesson.snapshot(), state);
  assert.equal(lesson.ram.read(0x100), 0);
  assert.deepEqual(lesson.inputSnapshot(), { pendingByte: 10 });
  execution.run(); timer.tick(); execution.stop();
  assert.equal(lesson.ram.read(0x100), 72);
  assert.equal(lesson.outputSnapshot()!.writes, 0);
  lesson.ram.write(0x100, 74);
  execution.run();
  for (let i = 0; i < 22; i++) timer.tick();
  assert.deepEqual(lesson.terminalSnapshot(), { text: "J", retained: 1 });
  assert.equal(execution.steps, 31);
  assert.equal(execution.running, false);
  assert.equal(execution.error, undefined);
  assert.equal(timer.pending.length, 0);
});

test("buffer restart cancels queued polling, character and NUL stores, pointer rewind, reads, and output", () => {
  for (const completed of [0, 2, 5, 8, 9, 12, 18, 19, 20, 21, 22, 24, 25, 30]) {
    const timer = clock();
    let lesson = createTerminalLesson("buffer");
    const execution = createExecutionController({
      step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
      onChange() {}, schedule: timer.schedule,
    });
    lesson.offerInput(72); execution.run();
    for (let i = 0; i < completed; i++) {
      if (i === 12) lesson.offerInput(10);
      timer.tick();
    }
    const old = lesson;
    const state = old.snapshot();
    const input = old.inputSnapshot();
    const output = old.terminalSnapshot();
    const bytes = Array.from({ length: 9 }, (_, i) => old.ram.read(0x100 + i));
    const queued = timer.pending[0]!;
    execution.reset(); lesson = createTerminalLesson("buffer");
    assert.deepEqual(lesson.inputSnapshot(), { pendingByte: null });
    assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
    assert.deepEqual(Array.from({ length: 9 }, (_, i) => lesson.ram.read(0x100 + i)), Array(9).fill(0));
    lesson.offerInput(72); execution.run(); queued.callback();
    assert.equal(execution.steps, 0);
    for (let i = 0; i < 31; i++) {
      if (i === 12) lesson.offerInput(10);
      timer.tick();
    }
    assert.deepEqual(lesson.terminalSnapshot(), { text: "H", retained: 1 });
    assert.equal(execution.running, false);
    assert.equal(execution.error, undefined);
    assert.deepEqual(old.snapshot(), state);
    assert.deepEqual(old.inputSnapshot(), input);
    assert.deepEqual(old.terminalSnapshot(), output);
    assert.deepEqual(Array.from({ length: 9 }, (_, i) => old.ram.read(0x100 + i)), bytes);
  }
});

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

test("STOP before OUT preserves an empty device; resume sends once and restart rejects a queued transfer", () => {
  const timer = clock();
  let lesson = createAltairProgram("output");
  const execution = createExecutionController({
    step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
    onChange() {}, schedule: timer.schedule,
  });
  execution.run(); timer.tick(); timer.tick();
  const pendingOutput = timer.pending[0]!;
  execution.stop(); pendingOutput.callback();
  assert.deepEqual([lesson.snapshot().a, lesson.snapshot().pc], [42, 0x105]);
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: null, writes: 0 });
  execution.run(); pendingOutput.callback(); timer.tick();
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: 42, writes: 1 });
  assert.equal(execution.running, false);
  assert.equal(execution.steps, 3);

  execution.reset();
  lesson = createAltairProgram("output");
  execution.run(); timer.tick(); timer.tick();
  const old = lesson;
  const cancelledOutput = timer.pending[0]!;
  execution.reset();
  lesson = createAltairProgram("output");
  execution.run(); cancelledOutput.callback();
  assert.deepEqual(old.outputSnapshot(), { lastByte: null, writes: 0 });
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: null, writes: 0 });
  assert.equal(execution.steps, 0);
  timer.tick(); timer.tick(); timer.tick();
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: 42, writes: 1 });
  assert.deepEqual(old.outputSnapshot(), { lastByte: null, writes: 0 });
});

test("paced input waits for an offer, preserves pending bytes on STOP, and cancels IN and OUT on restart", () => {
  const timer = clock();
  let lesson = createAltairProgram("input");
  const execution = createExecutionController({
    step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
    onChange() {}, schedule: timer.schedule,
  });
  execution.run(); execution.step();
  assert.equal(timer.pending.length, 0);
  lesson.offerInput(42);
  assert.equal(execution.running, false); // Offering is not RUN.
  assert.equal(execution.steps, 0);
  execution.run();
  const cancelled = timer.pending[0]!;
  execution.stop(); cancelled.callback();
  assert.deepEqual(lesson.inputSnapshot(), { pendingByte: 42 });
  assert.equal(execution.steps, 0);
  execution.run(); timer.tick();
  execution.stop();
  lesson.offerInput(99);
  assert.equal(lesson.snapshot().a, 42);
  assert.deepEqual(lesson.inputSnapshot(), { pendingByte: 99 });
  execution.run(); timer.tick();
  assert.equal(execution.running, false);
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: 42, writes: 1 });
  assert.deepEqual(lesson.inputSnapshot(), { pendingByte: 99 });
  assert.equal(execution.steps, 2);

  for (const phase of ["before IN", "before OUT"]) {
    execution.reset();
    lesson = createAltairProgram("input");
    lesson.offerInput(255);
    execution.run();
    if (phase === "before OUT") timer.tick();
    const old = lesson;
    const oldInput = old.inputSnapshot();
    const pending = timer.pending[0]!;
    execution.reset();
    lesson = createAltairProgram("input");
    lesson.offerInput(0);
    execution.run(); pending.callback();
    assert.deepEqual(old.inputSnapshot(), oldInput);
    assert.deepEqual(old.outputSnapshot(), { lastByte: null, writes: 0 });
    assert.deepEqual(lesson.inputSnapshot(), { pendingByte: 0 });
    assert.equal(execution.steps, 0);
    timer.tick(); timer.tick();
    assert.deepEqual(lesson.outputSnapshot(), { lastByte: 0, writes: 1 });
    assert.deepEqual(old.inputSnapshot(), oldInput);
  }
});

test("polling keeps executing while empty, yields each instruction, and accepts input without restarting", () => {
  const timer = clock();
  const lesson = createAltairProgram("polling");
  const execution = createExecutionController({
    step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
    onChange() {}, schedule: timer.schedule,
  });
  execution.run();
  for (let i = 0; i < 30; i++) {
    assert.equal(timer.pending.length, 1);
    timer.tick();
    assert.equal(execution.steps, i + 1);
  }
  assert.equal(execution.running, true);
  assert.equal(execution.records.length, 12);
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: null, writes: 0 });
  lesson.offerInput(0);
  for (let i = 0; i < 6; i++) timer.tick();
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: 0, writes: 1 });
  assert.equal(execution.steps, 36);
  const queued = timer.pending[0]!;
  execution.stop();
  lesson.offerInput(42);
  queued.callback();
  assert.equal(execution.running, false);
  assert.equal(timer.pending.length, 0);
  assert.equal(execution.steps, 36);
  assert.deepEqual(lesson.inputSnapshot(), { pendingByte: 42 });
  execution.run();
  for (let i = 0; i < 6; i++) timer.tick();
  execution.stop();
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: 42, writes: 2 });
});

test("restarting polling before status, data, or output invalidates queued work even after a new RUN", () => {
  for (const stepsBeforeRestart of [0, 3, 4]) {
    const timer = clock();
    let lesson = createAltairProgram("polling");
    lesson.offerInput(99);
    const execution = createExecutionController({
      step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
      onChange() {}, schedule: timer.schedule,
    });
    execution.run();
    for (let i = 0; i < stepsBeforeRestart; i++) timer.tick();
    const old = lesson;
    const state = old.snapshot();
    const input = old.inputSnapshot();
    const queued = timer.pending[0]!;
    execution.reset();
    lesson = createAltairProgram("polling");
    lesson.offerInput(42);
    execution.run();
    queued.callback();
    assert.equal(execution.steps, 0);
    assert.deepEqual(lesson.inputSnapshot(), { pendingByte: 42 });
    assert.deepEqual(lesson.outputSnapshot(), { lastByte: null, writes: 0 });
    for (let i = 0; i < 6; i++) timer.tick();
    execution.stop();
    assert.deepEqual(lesson.outputSnapshot(), { lastByte: 42, writes: 1 });
    assert.deepEqual(old.snapshot(), state);
    assert.deepEqual(old.inputSnapshot(), input);
    assert.deepEqual(old.outputSnapshot(), { lastByte: null, writes: 0 });
  }
});


test("STOP before terminal output retains A and pending input; resume appends the captured byte once", () => {
  const timer = clock();
  const lesson = createTerminalLesson();
  const execution = createExecutionController({
    step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
    onChange() {}, schedule: timer.schedule,
  });
  lesson.offerInput(65);
  execution.run();
  for (let i = 0; i < 4; i++) timer.tick();
  const queued = timer.pending[0]!;
  execution.stop();
  lesson.offerInput(66);
  queued.callback();
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
  assert.deepEqual(lesson.inputSnapshot(), { pendingByte: 66 });
  assert.equal(lesson.snapshot().a, 65);
  assert.equal(timer.pending.length, 0);
  execution.run(); timer.tick(); execution.stop();
  assert.deepEqual(lesson.terminalSnapshot(), { text: "A", retained: 1 });
  assert.deepEqual(lesson.inputSnapshot(), { pendingByte: 66 });
});

for (const program of ["polling", "reply"] as const) test(`${program} terminal restart cannot append stale output to either session`, () => {
  for (const stepsBeforeRestart of (program === "reply" ? [0, 3, 4, 5, 6, 7] : [0, 3, 4])) {
    const timer = clock();
    let lesson = createTerminalLesson(program);
    const execution = createExecutionController({
      step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
      onChange() {}, schedule: timer.schedule,
    });
    lesson.offerInput(97);
    execution.run();
    for (let i = 0; i < stepsBeforeRestart; i++) timer.tick();
    const old = lesson;
    const state = old.snapshot();
    const pending = old.inputSnapshot();
    const queued = timer.pending[0]!;
    execution.reset();
    lesson = createTerminalLesson(program);
    lesson.offerInput(66);
    execution.run(); queued.callback();
    assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
    assert.deepEqual(lesson.inputSnapshot(), { pendingByte: 66 });
    for (let i = 0; i < (program === "reply" ? 8 : 6); i++) timer.tick();
    execution.stop();
    assert.deepEqual(lesson.terminalSnapshot(), { text: "B", retained: 1 });
    assert.deepEqual(old.terminalSnapshot(), { text: "", retained: 0 });
    assert.deepEqual(old.inputSnapshot(), pending);
    assert.deepEqual(old.snapshot(), state);
  }
});

test("STOP after the reply comparison preserves its decision and pending input for either branch", () => {
  for (const value of [97, 98]) {
    const timer = clock();
    const lesson = createTerminalLesson("reply");
    const execution = createExecutionController({
      step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
      onChange() {}, schedule: timer.schedule,
    });
    lesson.offerInput(value);
    execution.run();
    for (let i = 0; i < 5; i++) timer.tick();
    const state = lesson.snapshot();
    const queued = timer.pending[0]!;
    execution.stop();
    lesson.offerInput(122);
    queued.callback();
    assert.deepEqual(lesson.snapshot(), state);
    assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
    execution.run();
    for (let i = 0; i < (value === 97 ? 3 : 2); i++) timer.tick();
    execution.stop();
    assert.deepEqual(lesson.terminalSnapshot(), { text: value === 97 ? "A" : "b", retained: 1 });
    assert.deepEqual(lesson.inputSnapshot(), { pendingByte: 122 });
    assert.equal(lesson.snapshot().flags.z, value === 97);
  }
});

test("paced message output resumes after MOV and records HLT once without scheduling another step", () => {
  const timer = clock();
  const lesson = createTerminalLesson("message");
  const execution = createExecutionController({
    step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
    onChange() {}, schedule: timer.schedule,
  });
  execution.run();
  for (let i = 0; i < 3; i++) timer.tick();
  const queued = timer.pending[0]!;
  execution.stop(); queued.callback();
  assert.deepEqual([lesson.snapshot().a, lesson.snapshot().hl, lesson.snapshot().b], [72, 0x100, 6]);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
  lesson.ram.write(0x100, 74); // The first character has already been read into A.
  execution.run();
  for (let i = 0; i < 29; i++) timer.tick();
  assert.deepEqual([execution.steps, lesson.snapshot().pc, lesson.snapshot().halted], [32, 0x0d, false]);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\n", retained: 6 });
  timer.tick();
  assert.equal(execution.error, undefined);
  assert.equal(execution.running, false);
  assert.equal(execution.steps, 33);
  assert.equal(execution.records.at(-1)!.outcome, "halted");
  assert.deepEqual(execution.records.at(-1)!.instruction, { address: 0x0d, bytes: [0x76] });
  assert.equal(timer.pending.length, 0);
  execution.run(); execution.step();
  assert.equal(execution.steps, 33);
  assert.equal(timer.pending.length, 0);
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: 10, writes: 6 });
});

test("restarting message output before a read, write, or HLT rejects callbacks from the previous session", () => {
  for (const completed of [0, 2, 3, 4, 32]) {
    const timer = clock();
    let lesson = createTerminalLesson("message");
    const execution = createExecutionController({
      step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
      onChange() {}, schedule: timer.schedule,
    });
    execution.run();
    for (let i = 0; i < completed; i++) timer.tick();
    const old = lesson;
    const state = old.snapshot();
    const output = old.terminalSnapshot();
    const queued = timer.pending[0]!;
    execution.reset();
    lesson = createTerminalLesson("message");
    execution.run(); queued.callback();
    assert.equal(execution.steps, 0);
    assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
    for (let i = 0; i < 4; i++) timer.tick();
    execution.stop();
    assert.deepEqual(lesson.terminalSnapshot(), { text: "H", retained: 1 });
    assert.deepEqual(old.snapshot(), state);
    assert.deepEqual(old.terminalSnapshot(), output);
  }
});

test("STOP after either terminator comparison preserves the branch decision when RAM changes", () => {
  for (const value of [0, 72]) {
    const timer = clock();
    const lesson = createTerminalLesson("terminated-message");
    lesson.ram.write(0x100, value);
    const execution = createExecutionController({
      step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
      onChange() {}, schedule: timer.schedule,
    });
    execution.run();
    for (let i = 0; i < 3; i++) timer.tick();
    const state = lesson.snapshot();
    const queued = timer.pending[0]!;
    execution.stop();
    lesson.ram.write(0x100, value === 0 ? 72 : 0);
    queued.callback();
    assert.deepEqual(lesson.snapshot(), state);
    assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
    execution.run(); timer.tick(); timer.tick();
    assert.deepEqual(lesson.terminalSnapshot(), { text: value === 0 ? "" : "H", retained: value === 0 ? 0 : 1 });
    assert.equal(execution.error, undefined);
    assert.equal(execution.running, value !== 0);
    assert.equal(lesson.snapshot().halted, value === 0);
    if (value === 0) {
      assert.equal(execution.steps, 5);
      assert.equal(timer.pending.length, 0);
      execution.run(); execution.step();
      assert.equal(execution.steps, 5);
    }
    execution.stop();
  }
});

test("restarting a terminated message rejects queued reads, decisions, outputs, and halts", () => {
  for (const completed of [0, 1, 2, 3, 4, 37, 38, 39, 40]) {
    const timer = clock();
    let lesson = createTerminalLesson("terminated-message");
    const execution = createExecutionController({
      step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
      onChange() {}, schedule: timer.schedule,
    });
    execution.run();
    for (let i = 0; i < completed; i++) timer.tick();
    const old = lesson;
    const state = old.snapshot();
    const output = old.terminalSnapshot();
    old.ram.write(0x100, 0);
    const queued = timer.pending[0]!;
    execution.reset();
    lesson = createTerminalLesson("terminated-message");
    execution.run(); queued.callback();
    assert.equal(execution.steps, 0);
    assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
    assert.deepEqual([lesson.snapshot().a, lesson.snapshot().pc, lesson.snapshot().hl, lesson.snapshot().halted], [0, 0, 0, false]);
    assert.equal(lesson.ram.read(0x100), 72);
    for (let i = 0; i < 41; i++) timer.tick();
    assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\n", retained: 6 });
    assert.equal(execution.steps, 41);
    assert.equal(execution.running, false);
    assert.equal(execution.error, undefined);
    assert.equal(timer.pending.length, 0);
    assert.deepEqual(old.snapshot(), state);
    assert.deepEqual(old.terminalSnapshot(), output);
  }
});

test("subroutine STOP preserves pending calls and returns; resume performs each stack transfer once", () => {
  const timer = clock();
  const lesson = createTerminalLesson("subroutine");
  const execution = createExecutionController({
    step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
    onChange() {}, schedule: timer.schedule,
  });
  execution.run(); timer.tick();
  const call = timer.pending[0]!;
  execution.stop(); call.callback();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp, lesson.ram.read(0x1fe)], [3, 0x200, 0]);
  execution.run(); timer.tick(); execution.stop();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp, lesson.ram.read(0x1fe)], [10, 0x1fe, 6]);
  assert.equal(lesson.outputSnapshot()!.writes, 0);
  execution.run();
  for (let i = 0; i < 40; i++) timer.tick();
  const returned = timer.pending[0]!;
  execution.stop(); returned.callback();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp], [25, 0x1fe]);
  execution.run(); timer.tick(); execution.stop();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp, lesson.ram.read(0x1fe)], [6, 0x200, 6]);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\n", retained: 6 });
  execution.run();
  for (let i = 0; i < 43; i++) timer.tick();
  assert.equal(execution.steps, 86);
  assert.equal(execution.running, false);
  assert.equal(execution.error, undefined);
  assert.equal(timer.pending.length, 0);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\nHELLO\n", retained: 12 });
});

test("subroutine restart rejects queued stack writes, returns, outputs, and HLT from the old run", () => {
  for (const completed of [0, 1, 2, 3, 6, 42, 43, 44, 45, 84, 85]) {
    const timer = clock();
    let lesson = createTerminalLesson("subroutine");
    const execution = createExecutionController({
      step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
      onChange() {}, schedule: timer.schedule,
    });
    execution.run();
    for (let i = 0; i < completed; i++) timer.tick();
    const old = lesson;
    const state = old.snapshot();
    const output = old.terminalSnapshot();
    const stack = [old.ram.read(0x1fe), old.ram.read(0x1ff)];
    const queued = timer.pending[0]!;
    execution.reset(); lesson = createTerminalLesson("subroutine");
    assert.equal(lesson.snapshot().sp, 0);
    assert.deepEqual([lesson.ram.read(0x1fe), lesson.ram.read(0x1ff)], [0, 0]);
    assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
    execution.run(); queued.callback();
    assert.equal(execution.steps, 0);
    for (let i = 0; i < 86; i++) timer.tick();
    assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\nHELLO\n", retained: 12 });
    assert.equal(execution.running, false);
    assert.equal(execution.error, undefined);
    assert.deepEqual(old.snapshot(), state);
    assert.deepEqual(old.terminalSnapshot(), output);
    assert.deepEqual([old.ram.read(0x1fe), old.ram.read(0x1ff)], stack);
  }
});

test("nested-call STOP preserves both return addresses and resumes each RET once", () => {
  const timer = clock();
  const lesson = createTerminalLesson("nested-call");
  const execution = createExecutionController({
    step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
    onChange() {}, schedule: timer.schedule,
  });
  execution.run();
  for (let i = 0; i < 7; i++) timer.tick();
  const output = timer.pending[0]!;
  execution.stop(); output.callback();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp], [27, 0x1fc]);
  assert.deepEqual([0x1fc, 0x1fd, 0x1fe, 0x1ff].map(address => lesson.ram.read(address)), [22, 0, 6, 0]);
  assert.equal(lesson.outputSnapshot()!.writes, 0);
  execution.run(); timer.tick();
  const innerReturn = timer.pending[0]!;
  execution.stop(); innerReturn.callback();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp], [29, 0x1fc]);
  execution.run(); timer.tick(); execution.stop();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp], [22, 0x1fe]);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "H", retained: 1 });
  execution.run();
  for (let i = 9; i < 54; i++) timer.tick();
  const outerReturn = timer.pending[0]!;
  execution.stop(); outerReturn.callback();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp], [26, 0x1fe]);
  execution.run(); timer.tick(); execution.stop();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp], [6, 0x200]);
  execution.run();
  for (let i = 55; i < 110; i++) timer.tick();
  assert.equal(execution.steps, 110);
  assert.equal(execution.running, false);
  assert.equal(execution.error, undefined);
  assert.equal(timer.pending.length, 0);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\nHELLO\n", retained: 12 });
});

test("nested-call restart cancels queued work at either call depth and restores both stack pairs", () => {
  for (const completed of [0, 1, 2, 6, 7, 8, 9, 54, 55, 56, 108, 109]) {
    const timer = clock();
    let lesson = createTerminalLesson("nested-call");
    const execution = createExecutionController({
      step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
      onChange() {}, schedule: timer.schedule,
    });
    execution.run();
    for (let i = 0; i < completed; i++) timer.tick();
    const old = lesson;
    const state = old.snapshot();
    const output = old.terminalSnapshot();
    const stack = [0x1fc, 0x1fd, 0x1fe, 0x1ff].map(address => old.ram.read(address));
    const queued = timer.pending[0]!;
    execution.reset(); lesson = createTerminalLesson("nested-call");
    assert.equal(lesson.snapshot().sp, 0);
    assert.deepEqual([0x1fc, 0x1fd, 0x1fe, 0x1ff].map(address => lesson.ram.read(address)), [0, 0, 0, 0]);
    assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
    execution.run(); queued.callback();
    assert.equal(execution.steps, 0);
    for (let i = 0; i < 110; i++) timer.tick();
    assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\nHELLO\n", retained: 12 });
    assert.equal(execution.running, false);
    assert.equal(execution.error, undefined);
    assert.deepEqual(old.snapshot(), state);
    assert.deepEqual(old.terminalSnapshot(), output);
    assert.deepEqual([0x1fc, 0x1fd, 0x1fe, 0x1ff].map(address => old.ram.read(address)), stack);
  }
});

test("register-saving STOP preserves pending PUSH, POP, and RET without repeating their accesses", () => {
  const timer = clock();
  const lesson = createTerminalLesson("save-registers");
  const execution = createExecutionController({
    step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
    onChange() {}, schedule: timer.schedule,
  });
  execution.run();
  for (let i = 0; i < 3; i++) timer.tick();
  const push = timer.pending[0]!;
  execution.stop(); push.callback();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp, lesson.ram.read(0x1fd)], [13, 0x1fe, 0]);
  execution.run(); timer.tick(); execution.stop();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp, lesson.ram.read(0x1fd)], [14, 0x1fc, 1]);
  execution.run();
  for (let i = 4; i < 43; i++) timer.tick();
  const pop = timer.pending[0]!;
  execution.stop(); pop.callback();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().hl, lesson.snapshot().sp], [26, 0x106, 0x1fc]);
  execution.run(); timer.tick();
  const returned = timer.pending[0]!;
  execution.stop(); returned.callback();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().hl, lesson.snapshot().sp], [27, 0x100, 0x1fe]);
  execution.run();
  for (let i = 44; i < 89; i++) timer.tick();
  assert.equal(execution.steps, 89);
  assert.equal(execution.running, false);
  assert.equal(execution.error, undefined);
  assert.equal(timer.pending.length, 0);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\nHELLO\n", retained: 12 });
});

test("register-saving restart cancels queued accesses and restores CPU, stack, and message", () => {
  for (const completed of [0, 2, 3, 4, 7, 43, 44, 45, 46, 86, 87, 88]) {
    const timer = clock();
    let lesson = createTerminalLesson("save-registers");
    const execution = createExecutionController({
      step: () => lesson.step(), canStep: () => lesson.stepProblem() === undefined,
      onChange() {}, schedule: timer.schedule,
    });
    execution.run();
    for (let i = 0; i < completed; i++) timer.tick();
    const old = lesson;
    const state = old.snapshot();
    const output = old.terminalSnapshot();
    const stack = [0x1fc, 0x1fd, 0x1fe, 0x1ff].map(address => old.ram.read(address));
    old.ram.write(0x100, 0);
    const queued = timer.pending[0]!;
    execution.reset(); lesson = createTerminalLesson("save-registers");
    assert.deepEqual([lesson.snapshot().hl, lesson.snapshot().sp], [0, 0]);
    assert.deepEqual([0x1fc, 0x1fd, 0x1fe, 0x1ff].map(address => lesson.ram.read(address)), [0, 0, 0, 0]);
    assert.equal(lesson.ram.read(0x100), 72);
    assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
    execution.run(); queued.callback();
    assert.equal(execution.steps, 0);
    for (let i = 0; i < 89; i++) timer.tick();
    assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\nHELLO\n", retained: 12 });
    assert.equal(execution.running, false);
    assert.equal(execution.error, undefined);
    assert.deepEqual(old.snapshot(), state);
    assert.deepEqual(old.terminalSnapshot(), output);
    assert.deepEqual([0x1fc, 0x1fd, 0x1fe, 0x1ff].map(address => old.ram.read(address)), stack);
  }
});
