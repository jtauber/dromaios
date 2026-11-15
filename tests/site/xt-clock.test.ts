import assert from "node:assert/strict";
import { test } from "node:test";
import { create8088XtTimer } from "../../src/machines/generated/8088/xt-timer.js";
import { stepTimedXtCpu } from "../../src/machines/8088/pc-xt/interrupts.js";
import { createExecutionController } from "../../site/interactive/execution-controller.js";
import { createClockPacing } from "../../site/interactive/clock-pacing.js";
import { createExecutionIntervals } from "../../site/interactive/execution-intervals.js";

test("XT Normal, Unlimited and Step agree through interrupt entry, halted time and DMA refresh", () => {
  function example() {
    const machine = create8088XtTimer(), io = machine.io;
    io.write(0, 0); io.write(0, 0); io.write(1, 255); io.write(1, 255);
    io.write(11, 0x58); io.write(10, 0);
    io.write(0x43, 0x54); io.write(0x41, 18);
    return machine;
  }
  const single = example(), expected = Array.from({ length: 140 }, () => stepTimedXtCpu(single));
  assert.ok(expected.some(step => step.dma));
  assert.ok(expected.some(step => step.record.outcome === "halted"));
  assert.ok(expected.some(step => step.record.outcome === "accepted"));
  assert.equal(single.io.clock.ticks, expected.reduce((sum, step) => sum + step.oscillatorTicks, 0));
  for (const normal of [true, false]) for (const batchSize of [1, 7, 10000]) {
    let machine = example(), time = 0, count = 0;
    const jobs: (() => void)[] = [];
    const execution = createExecutionController({
      step() { count++; return stepTimedXtCpu(machine); }, canStep: () => count < 140, batchSize,
      onChange() {}, schedule(callback) { jobs.push(callback); return () => {}; },
    });
    const pacing = createClockPacing({ ticks: () => machine.io.clock.ticks, hertz: machine.io.clock.hertz, now: () => time });
    if (normal) execution.setPacing(pacing);
    execution.step(); const saved = machine.snapshot();
    function finish() {
      execution.run();
      for (let batches = 0; execution.running; batches++) {
        assert.ok(batches < 1000); time += 0.001; jobs.shift()!();
      }
      assert.equal(execution.error, undefined); assert.deepEqual(machine.snapshot(), single.snapshot());
    }
    finish(); machine = create8088XtTimer(saved); execution.reset(); count = 1; finish();
  }
});

test("XT clock measurements preserve the CPU-reset marker and discard it on restored or fresh hardware", () => {
  let machine = create8088XtTimer();
  const measurements = createExecutionIntervals(() => machine.io.clock);
  measurements.mark(); measurements.begin("step"); stepTimedXtCpu(machine);
  const elapsed = machine.io.clock.ticks;
  assert.deepEqual(measurements.update(false, "step"), {
    marker: { at: 0, clocks: elapsed }, interval: { action: "step", clocks: elapsed, stop: "step" },
  });
  const saved = machine.snapshot(), clock = machine.io.clock;
  machine.cpu.reset(); measurements.clearStep();
  assert.equal(machine.io.clock, clock); assert.equal(measurements.update(false).marker?.clocks, elapsed);
  machine = create8088XtTimer(saved);
  assert.notEqual(machine.io.clock, clock); assert.equal(measurements.update(false).marker, undefined);
  measurements.mark(); machine = create8088XtTimer();
  assert.deepEqual(measurements.update(false), { marker: undefined, interval: undefined });
});
