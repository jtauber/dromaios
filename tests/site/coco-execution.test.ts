import assert from "node:assert/strict";
import { test } from "node:test";
import { create6809Coco } from "../../src/machines/generated/6809/coco.js";
import { stepCoco } from "../../src/machines/6809/coco/runtime.js";
import { createCocoKeyboardTransport } from "../../site/interactive/coco-keyboard-transport.js";
import { createCocoDebugger } from "../../site/interactive/coco-debugger.js";
import { createExecutionController } from "../../site/interactive/execution-controller.js";
import { createClockPacing } from "../../site/interactive/clock-pacing.js";
import { createExecutionIntervals, executionIntervalText } from "../../site/interactive/execution-intervals.js";
import type { MeasuredStep } from "../../site/interactive/execution-intervals.js";
import { catalogue6809 as catalogue } from "./6809-inspection-fixture.js";

const empty = { firmware: null, extended: null };
function machineWith(program: Readonly<Record<number, readonly number[]>>) {
  const base = create6809Coco(empty).snapshot();
  const machine = create6809Coco(empty, { ...base, cpu: { ...base.cpu, pc: 0x200, s: 0x7000 } });
  for (const [address, bytes] of Object.entries(program)) bytes.forEach((byte, i) => machine.ram.write(+address + i, byte));
  return machine;
}

test("Normal, Unlimited, and single steps deliver identical keyboard phases and hardware", () => {
  function example() {
    // Poll a selected keyboard column and retain the sensed rows: 5+4+3 clocks.
    const machine = machineWith({ 0x200: [0xb6, 0xff, 0x00, 0x97, 0x10, 0x20, 0xf9] });
    machine.pias.write(2, 255); machine.pias.write(1, 4); machine.pias.write(3, 4); machine.pias.write(2, 0xfd);
    const input = createCocoKeyboardTransport(machine.pias, machine.clock.hertz!);
    input.send([["A"], ["A"]]);
    const edges: [number, boolean][] = [];
    function step() {
      const pressed = input.snapshot().pressed;
      input.beforeStep();
      if (input.snapshot().pressed !== pressed) edges.push([machine.clock.ticks, !pressed]);
      const record = stepCoco(machine); input.afterStep(record.clocks + record.idleClocks); return record;
    }
    return { machine, input, step, edges };
  }
  const manual = example();
  while (manual.machine.clock.ticks < 180_000) manual.step();
  assert.equal(manual.input.settled, true);
  assert.deepEqual(manual.edges, [[0, true], [44_745, false], [89_493, true], [134_241, false]]);
  for (const normal of [false, true]) for (const batchSize of [1, 7, 10_000]) {
    const p = example(), jobs: (() => void)[] = [];
    let time = 0;
    const execution = createExecutionController({
      step: p.step, canStep: () => p.machine.clock.ticks < 180_000, onChange() {}, batchSize,
      schedule(callback) { jobs.push(callback); return () => {}; },
    });
    if (normal) execution.setPacing(createClockPacing({ ticks: () => p.machine.clock.ticks, hertz: p.machine.clock.hertz!, now: () => time }));
    execution.run();
    for (let count = 0; execution.running; count++) {
      assert.ok(count < 50_000); time += 1; jobs.shift()!();
    }
    assert.equal(execution.error, undefined);
    assert.deepEqual(p.machine.snapshot(), manual.machine.snapshot());
    assert.deepEqual(p.input.snapshot(), manual.input.snapshot()); assert.deepEqual(p.edges, manual.edges);
  }
});

test("idle clocks advance keyboard phases and restore exactly during SYNC", () => {
  const original = machineWith({ 0x200: [0x13] }); // No enabled IRQ: remain in SYNC.
  const input = createCocoKeyboardTransport(original.pias, original.clock.hertz!);
  input.send([["A"], ["A"]]);
  function advance(machine: typeof original, transport: typeof input) {
    transport.beforeStep(); const record = stepCoco(machine);
    transport.afterStep(record.clocks + record.idleClocks); return record;
  }
  assert.equal(advance(original, input).clocks, 4);
  assert.equal(advance(original, input).idleClocks, 49);
  assert.equal(input.snapshot().remainingClocks, 44_692);
  const restored = create6809Coco(empty, original.snapshot());
  const resumed = createCocoKeyboardTransport(restored.pias, restored.clock.hertz!, input.snapshot());
  for (let boundaries = 0; !input.settled; boundaries++) {
    assert.ok(boundaries < 10_000);
    assert.deepEqual(advance(restored, resumed), advance(original, input));
  }
  assert.deepEqual(resumed.snapshot(), input.snapshot()); assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.equal(original.cpu.snapshot().pc, 0x201); assert.equal(original.cpu.snapshot().waitMode, "sync");
  assert.ok(original.clock.ticks >= 178_980);
});

function measured(batchSize = 2, budget = 100, normal = false) {
  let machine = machineWith({
    0x200: [0xbd, 0x03, 0x00, 0x12], // JSR $0300; NOP
    0x300: [0xc6, 2, 0xbd, 4, 0, 0x5a, 0x26, 0xfa, 0x39], // LDB #2; loop: JSR $0400; DECB; BNE loop; RTS
    0x400: [0x0c, 0x10, 0x39],       // INC $10; RTS
  });
  const debug = createCocoDebugger(() => machine, catalogue, budget), intervals = createExecutionIntervals(() => machine.clock);
  const jobs: { callback: () => void; cancelled: boolean }[] = [];
  let time = 0;
  const execution = createExecutionController({
    step: () => debug.capture(() => stepCoco(machine)), canStep: () => true, pauseBeforeStep: debug.beforeStep, batchSize,
    onChange() { intervals.update(execution.running, execution.error ? "error" : debug.stop?.kind); },
    schedule(callback) { const job = { callback, cancelled: false }; jobs.push(job); return () => { job.cancelled = true; }; },
  });
  const pacing = createClockPacing({ ticks: () => machine.clock.ticks, hertz: machine.clock.hertz!, now: () => time });
  if (normal) execution.setPacing(pacing);
  return {
    get machine() { return machine; }, debug, intervals, execution, jobs, pacing,
    start(action: MeasuredStep) {
      debug[action](); intervals.begin(action);
      if (action === "step") execution.step(); else execution.run();
    },
    batch(ms = 1) { time += ms; const job = jobs.find(job => !job.cancelled)!; job.cancelled = true; job.callback(); },
    elapse(ms: number) { time += ms; },
    finish() { for (let n = 0; execution.running; n++) { assert.ok(n < 100); this.batch(); } },
    result: () => intervals.update(execution.running, execution.error ? "error" : debug.stop?.kind),
    restore(snapshot: ReturnType<typeof machine.snapshot>) {
      machine = create6809Coco(empty, snapshot); execution.reset(); debug.reset(); intervals.clearStep();
    },
  };
}

test("CoCo markers and Step over/out measure nested calls across speeds and batches", () => {
  // Outer JSR 8 + LDB 2 + twice (JSR 8 + INC 6 + RTS 5 + DECB 2 + BNE 3) + RTS 5 = 63.
  for (const batch of [1, 2, 10_000]) for (const normal of [true, false]) {
    const p = measured(batch, 100, normal); p.intervals.mark(); p.start("over"); p.finish();
    assert.deepEqual(p.result(), { marker: { at: 0, clocks: 63 }, interval: { action: "over", clocks: 63, stop: "over" } });
    assert.equal(p.machine.ram.read(0x10), 2);
    assert.equal(executionIntervalText(p.result().interval!), "Step over: 63 CPU clocks · complete");
  }
  const p = measured(); p.intervals.mark();
  p.start("step"); assert.equal(p.result().interval?.clocks, 8);
  p.start("over"); p.finish(); assert.deepEqual(p.result().interval, { action: "over", clocks: 2, stop: "step" });
  p.start("step"); p.start("out"); p.finish(); assert.equal(p.result().interval?.clocks, 11);
  p.start("out"); p.finish(); assert.equal(p.result().interval?.clocks, 34);
  assert.equal(p.result().marker?.clocks, 63);
  const before = p.result(); assert.throws(() => p.start("out"), /No observed caller/); assert.deepEqual(p.result(), before);
});

test("CoCo interrupted measurements retain completed clocks without claiming completion", () => {
  for (const cause of ["breakpoint", "watchpoint", "limit", "error"] as const) {
    const p = measured(10_000, cause === "limit" ? 2 : 100); p.intervals.mark();
    if (cause === "breakpoint") p.debug.setBreakpoints([{ address: 0x305, enabled: true }]);
    if (cause === "watchpoint") p.debug.setWatchpoints([{ address: 0x10, enabled: true }]);
    if (cause === "error") p.machine.ram.write(0x402, 0x01); // Unsupported after the INC.
    p.start("over"); p.finish();
    const clocks = { breakpoint: 29, watchpoint: 24, limit: 10, error: 24 }[cause];
    assert.deepEqual(p.result().interval, { action: "over", clocks, stop: cause });
    assert.match(executionIntervalText(p.result().interval!), cause === "error" ? /failed$/ : /stopped$/);
  }
});

test("CoCo Pause, speed changes and restoration discard stale host budgets; reset preserves the marker", () => {
  const p = measured(2, 100, true); p.intervals.mark(); p.start("over"); p.batch();
  const saved = p.machine.snapshot(), clocks = p.machine.clock.ticks, stale = p.jobs.at(-1)!;
  p.debug.pause(); p.execution.stop(); const result = p.result();
  p.elapse(3_600_000); p.debug.run(); p.execution.run(); stale.callback(); p.batch(0);
  assert.equal(p.machine.clock.ticks, clocks); assert.deepEqual(p.result(), result);
  p.execution.setPacing(undefined); p.batch(0); assert.ok(p.machine.clock.ticks > clocks);
  p.execution.setPacing(p.pacing); const before = p.machine.snapshot(); p.batch(0); assert.deepEqual(p.machine.snapshot(), before);
  for (const ticks of [0, 100_000]) {
    const pending = p.jobs.at(-1)!;
    p.restore({ ...saved, clock: { ticks } }); p.debug.run(); p.execution.run(); pending.callback(); p.batch(0);
    assert.equal(p.machine.clock.ticks, ticks); assert.deepEqual(p.result(), { marker: undefined, interval: undefined });
    p.batch(); assert.ok(p.machine.clock.ticks > ticks);
    p.execution.stop(); p.intervals.mark();
    p.machine.reset(); p.execution.reset(); p.debug.reset(); p.intervals.clearStep();
    assert.equal(p.result().marker?.clocks, 0); assert.equal(p.result().interval, undefined);
  }
  p.restore(create6809Coco(empty).snapshot()); assert.equal(p.result().marker, undefined);
});
