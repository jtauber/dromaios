import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createExecutionIntervals, executionIntervalText } from "../../site/interactive/execution-intervals.js";
import type { MeasuredStep } from "../../site/interactive/execution-intervals.js";
import { createExecutionController } from "../../site/interactive/execution-controller.js";
import { createClockPacing } from "../../site/interactive/clock-pacing.js";
import { createInstructionDebugger } from "../../site/interactive/instruction-debugger.js";
import { apple2DebugLocation, apple2DebugStep } from "../../site/interactive/apple2-debugger.js";
import { instructionCatalogue6502 } from "../../site/6502-instruction-catalogue.js";
import { families } from "../../src/components/cpus/semantics/generated/6502.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { editApple2Register } from "../../site/interactive/apple2-register-edit.js";
import { readApple2Rom } from "../../site/interactive/apple2-media.js";
import { romImages } from "../../src/machines/generated/6502/apple2.js";

const catalogue = instructionCatalogue6502(Object.values(families).flat());
const nested = {
  0x200: [0x20, 0x00, 0x03, 0xea],                  // JSR $0300; NOP
  0x300: [0xa2, 2, 0x20, 0, 4, 0xca, 0xd0, 0xfa, 0x60], // LDX #2; JSR $0400; DEX; BNE $0302; RTS
  0x400: [0xe6, 0x10, 0x60],                        // INC $10; RTS
};

function example(batchSize = 2, budget = 100, session = createApple2Session(), paced = false) {
  if (!session.hasFirmware) {
    for (const [address, bytes] of Object.entries(nested)) bytes.forEach((byte, i) => session.machine.ram.write(+address + i, byte));
    editApple2Register(session.machine, "pc", "0200");
  }
  const intervals = createExecutionIntervals(() => session.machine.clock), debug = createInstructionDebugger(budget);
  const location = () => apple2DebugLocation(session.machine), jobs: (() => void)[] = [];
  let writeStop = false;
  let hostTime = 0;
  const execution = createExecutionController({
    step() {
      const before = location(), record = session.hasFirmware ? session.step() : session.machine.step();
      debug.observe(apple2DebugStep(record, before, location(), catalogue));
      if (writeStop && record.accesses.some(access => access.kind === "write" && access.address === 0x10)) debug.watchpoint(location(), "Write at $0010");
      if (!execution.running) debug.beforeStep(location);
      return record;
    },
    canStep: () => true, pauseBeforeStep: () => debug.beforeStep(location), batchSize,
    schedule(callback) { jobs.push(() => { hostTime += 0.001; callback(); }); return () => {}; },
    onChange() { intervals.update(execution.running, execution.error ? "error" : debug.stop?.kind); },
  });
  if (paced) execution.setPacing(createClockPacing({
    ticks: () => session.machine.clock.ticks, hertz: session.machine.clock.hertz!, now: () => hostTime,
  }));
  function start(action: MeasuredStep): void {
    if (action === "step") debug.step(location());
    else if (action === "over") debug.over(location(), catalogue[session.machine.memory.read(location().address)]?.stackFlow);
    else debug.out(location());
    intervals.begin(action);
    if (action === "step") execution.step(); else execution.run();
  }
  function finish(): void {
    for (let batches = 0; execution.running; batches++) {
      assert.ok(batches < 100, "The request must finish within the test budget"); jobs.shift()!();
    }
  }
  return { session, intervals, debug, execution, jobs, location, start, finish,
    result: () => intervals.update(execution.running, execution.error ? "error" : debug.stop?.kind),
    watchWrite() { writeStop = true; },
  };
}

test("a marker measures nested calls and both branch paths independently of scheduled batch size", () => {
  // JSR 6 + LDX 2 + first iteration (6+5+6+2+3) + second (6+5+6+2+2) + RTS 6 = 57.
  for (const batchSize of [1, 2, 10000]) {
    const p = example(batchSize); p.intervals.mark(); p.start("over"); p.finish();
    assert.equal(p.execution.steps, 13); assert.equal(p.session.machine.ram.read(0x10), 2);
    assert.deepEqual(p.result(), { marker: { at: 0, clocks: 57 }, interval: { action: "over", clocks: 57, stop: "over" } });
    assert.equal(executionIntervalText(p.result().interval!), "Step over: 57 CPU clocks · complete");
    p.intervals.mark();
    assert.deepEqual(p.result().marker, { at: 57, clocks: 0 });
    p.intervals.clearMarker(); assert.equal(p.result().marker, undefined);
    assert.equal(p.result().interval?.clocks, 57, "Clearing a marker preserves the last operation");
  }
});

test("Step measures its instruction; Step over a non-call and Step out measure only the work requested", () => {
  const p = example(); p.intervals.mark();
  p.start("step"); assert.deepEqual(p.result().interval, { action: "step", clocks: 6, stop: "step" });
  p.start("over"); p.finish(); // LDX #2 is one ordinary instruction.
  assert.deepEqual(p.result().interval, { action: "over", clocks: 2, stop: "step" });
  assert.match(executionIntervalText(p.result().interval!), /complete$/);
  p.start("step"); // Enter the nested call.
  assert.equal(p.result().marker?.clocks, 14);
  p.start("out"); p.finish();
  assert.deepEqual(p.result().interval, { action: "out", clocks: 11, stop: "out" });
  p.start("out"); p.finish();
  assert.deepEqual(p.result().interval, { action: "out", clocks: 32, stop: "out" });
  assert.equal(p.result().marker?.clocks, 57);
  const previous = p.result();
  assert.throws(() => p.start("out"), /No observed caller/);
  assert.deepEqual(p.result(), previous, "A rejected request does not replace a completed measurement");
});

test("breakpoints, watchpoints, limits and failures retain consumed clocks without claiming completion", () => {
  for (const cause of ["breakpoint", "watchpoint", "limit", "error", "tracking-lost"] as const) {
    const p = example(10000, cause === "limit" ? 2 : 100); p.intervals.mark();
    if (cause === "breakpoint") p.debug.setBreakpoints([{ address: 0x305, enabled: true }]);
    if (cause === "watchpoint") p.watchWrite();
    if (cause === "error") p.session.machine.ram.write(0x402, 0x02); // Unsupported after INC has completed.
    if (cause === "tracking-lost") p.session.machine.ram.write(0x402, 0x9a); // TXS destroys observed callers.
    p.start("over"); p.finish();
    const clocks = { breakpoint: 25, watchpoint: 19, limit: 8, error: 19, "tracking-lost": 21 }[cause];
    assert.deepEqual(p.result(), { marker: { at: 0, clocks }, interval: { action: "over", clocks, stop: cause } });
    assert.match(executionIntervalText(p.result().interval!), cause === "error" ? /failed$/ : /stopped$/);
  }
});

test("Pause freezes the requested interval while later Run advances the independent marker", () => {
  const p = example(); p.intervals.mark(); p.start("over"); p.jobs.shift()!();
  assert.deepEqual(p.result().interval, { action: "over", clocks: 8 });
  assert.match(executionIntervalText(p.result().interval!), /running$/);
  p.debug.pause(p.location()); p.execution.stop();
  const paused = p.result();
  for (const stale of p.jobs.splice(0)) stale();
  assert.deepEqual(p.result(), paused);
  assert.deepEqual(paused.interval, { action: "over", clocks: 8, stop: "pause" });
  p.debug.runTo(p.location(), 0x203); p.execution.run(); p.finish();
  assert.equal(p.result().marker?.clocks, 57); assert.deepEqual(p.result().interval, paused.interval);
});

test("CPU reset and host edits retain the marker; replacing a machine clears measurements even when time increases", () => {
  const p = example(); p.start("step"); p.intervals.mark();
  p.start("step"); const later = p.session.snapshot();
  p.session.machine.reset(); p.execution.reset(); p.intervals.clearStep();
  assert.deepEqual(p.result(), { marker: { at: 6, clocks: 2 }, interval: undefined });
  editApple2Register(p.session.machine, "pc", "0200"); p.session.machine.ram.write(0x10, 42);
  assert.deepEqual(p.result().marker, { at: 6, clocks: 2 });
  p.session.powerOn();
  assert.deepEqual(p.result(), { marker: undefined, interval: undefined });
  p.intervals.mark(); p.session.restore(later);
  assert.equal(p.session.machine.clock.ticks, 8);
  assert.deepEqual(p.result(), { marker: undefined, interval: undefined });
  p.intervals.mark(); p.session.restore({ ...later, hardware: { ...later.hardware, clock: { ticks: 0 } } });
  assert.deepEqual(p.result(), { marker: undefined, interval: undefined });
});

test("verified Monitor SETNORM takes 17 clocks for Step over, or 6 for JSR plus 11 for Step out", {
  skip: process.env.APPLE2_ROM === undefined ? "Set APPLE2_ROM to the externally supplied Apple II Plus ROM" : false,
}, async () => {
  const chapter = readFileSync("src/machines/6502/apple2.md", "utf8"), bytes = new Uint8Array(readFileSync(process.env.APPLE2_ROM!));
  const media = JSON.parse(chapter.match(/```json\n([\s\S]*?)```/)![1]!);
  const rom = await readApple2Rom({ name: "apple2p.rom", size: bytes.length, async arrayBuffer() { return bytes.buffer; } }, romImages.firmware, media);
  for (const paced of [false, true]) {
    const session = createApple2Session(rom.image), p = example(2, 100, session, paced);
    assert.deepEqual(Array.from({ length: 5 }, (_, i) => session.machine.firmware.read(0x2e84 + i)), [0xa0, 0xff, 0x84, 0x32, 0x60]);
    p.intervals.mark(); p.start("step"); // CLD at FA62: two clocks.
    assert.deepEqual(p.result().interval, { action: "step", clocks: 2, stop: "step" });
    const before = session.snapshot();
    p.start("over"); p.finish();
    assert.deepEqual(p.result().interval, { action: "over", clocks: 17, stop: "over" });
    assert.equal(session.machine.cpu.snapshot().pc, 0xfa66); assert.equal(session.machine.ram.read(0x32), 0xff);
    assert.equal(p.result().marker?.clocks, 19);
    session.restore(before); p.debug.reset(); p.execution.reset();
    p.start("step"); assert.equal(p.result().interval?.clocks, 6);
    p.start("out"); p.finish(); assert.equal(p.result().interval?.clocks, 11);
    assert.equal(session.machine.clock.ticks, 19);
  }
});
