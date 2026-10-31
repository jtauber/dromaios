import assert from "node:assert/strict";
import { test } from "node:test";
import { create8088XtTimer } from "../../../../src/machines/generated/8088/xt-timer.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";
import { InstructionTimingUnavailable } from "../../../../src/components/cpus/instruction-timing.js";

test("timed XT execution wakes a halted CPU through the PIT without host-supplied elapsed time", () => {
  const machine = create8088XtTimer();
  const records = Array.from({ length: 50 }, () => stepTimedXtCpu(machine));
  assert.equal(machine.ram.read(0x300), 1);
  assert.equal(records.filter(({ record }) => record.outcome === "accepted").length, 1);
  assert.ok(records.some(({ record }) => record.outcome === "halted" && record.instruction === null));
  assert.equal(machine.io.snapshot().pic.isr, 0);
  assert.equal(machine.io.oscillatorTicks, records.reduce((sum, record) => sum + record.oscillatorTicks, 0));
  for (const { record, oscillatorTicks } of records) {
    if (record.clocks) assert.equal(oscillatorTicks, record.clocks * 3);
    else assert.ok(oscillatorTicks > 0 && oscillatorTicks <= 12);
  }
});

test("browser batch boundaries and restored snapshots preserve timed execution and PIT phase", () => {
  const machine = create8088XtTimer();
  const expected = Array.from({ length: 70 }, () => stepTimedXtCpu(machine));
  for (const batch of [1, 7, 23]) {
    let restored = create8088XtTimer();
    const actual = [];
    for (let step = 0; step < expected.length; step++) {
      actual.push(stepTimedXtCpu(restored));
      if ((step + 1) % batch === 0) restored = create8088XtTimer(restored.snapshot());
    }
    assert.deepEqual(actual, expected); assert.deepEqual(restored.snapshot(), machine.snapshot());
  }
});

test("masked IRQ0 remains pending while halted time continues; observation is inert", () => {
  const machine = create8088XtTimer();
  machine.ram.write(0x100, 0xfa); machine.ram.write(0x101, 0xf4); // CLI; HLT
  const io = machine.io;
  io.write(0x20, 0x13); io.write(0x21, 8); io.write(0x21, 9); io.write(0x21, 0xfe);
  io.write(0x43, 0x10); io.write(0x40, 1);
  stepTimedXtCpu(machine); stepTimedXtCpu(machine);
  const stopped = machine.cpu.snapshot();
  for (let step = 0; step < 4; step++) assert.equal(stepTimedXtCpu(machine).record.outcome, "halted");
  assert.deepEqual(machine.cpu.snapshot(), stopped);
  assert.equal(io.irq, true); assert.equal(io.snapshot().pic.isr, 0); assert.equal(io.snapshot().pic.irr, 1);
  const saved = machine.snapshot(); machine.cpu.snapshot(); io.snapshot(); void io.oscillatorTicks;
  assert.deepEqual(machine.snapshot(), saved);
});

test("an uncovered timed instruction stops the XT without advancing device time", () => {
  const machine = create8088XtTimer(); machine.ram.write(0x100, 0xd0); machine.ram.write(0x101, 0xc0);
  const before = machine.snapshot();
  assert.throws(() => stepTimedXtCpu(machine), InstructionTimingUnavailable);
  assert.deepEqual(machine.snapshot(), before);
});
