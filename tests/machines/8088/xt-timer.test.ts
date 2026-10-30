import assert from "node:assert/strict";
import { test } from "node:test";
import { create8088XtTimer } from "../../../src/machines/generated/8088/xt-timer.js";
import { stepXtCpu } from "../../../src/machines/8088/pc-xt/interrupts.js";

type Machine = ReturnType<typeof create8088XtTimer>;
function untilHalted(machine: Machine) {
  const records = [];
  for (let step = 0; step < 100; step++) {
    const record = stepXtCpu(machine); records.push(record);
    if (record.outcome === "halted") return records;
    assert.ok(record.outcome === "executed" || record.outcome === "accepted", record.outcome);
  }
  assert.fail("Timer fixture did not halt within its instruction bound.");
}

test("a native 8088 program configures mode 0, halts, and wakes through IRQ0 after five timer pulses", () => {
  const machine = create8088XtTimer();
  const init = untilHalted(machine);
  assert.deepEqual(init.flatMap(record => record.accesses.filter(access => access.kind === "output")), [
    { kind: "output", port: 0x20, value: 0x13 }, { kind: "output", port: 0x21, value: 8 },
    { kind: "output", port: 0x21, value: 9 }, { kind: "output", port: 0x21, value: 0xfe },
    { kind: "output", port: 0x43, value: 0x10 }, { kind: "output", port: 0x40, value: 4 },
  ]);
  assert.equal(machine.io.snapshot().clock.ticks, 0); // CPU steps are explicitly untimed.
  const waiting = machine.cpu.snapshot();
  machine.io.advanceOscillatorTicks(59);
  assert.deepEqual(machine.cpu.snapshot(), waiting); assert.equal(stepXtCpu(machine).outcome, "halted");
  assert.equal(machine.io.irq, false); assert.equal(machine.ram.read(0x300), 0);
  machine.io.advanceOscillatorTicks(1); assert.equal(machine.io.irq, true);
  const entry = stepXtCpu(machine);
  assert.equal(entry.outcome, "accepted"); assert.equal(entry.after.ip, 0x200); assert.equal(entry.after.sp, 0x7ffa);
  const handler = untilHalted(machine);
  assert.ok(handler.some(record => record.accesses.some(access => access.kind === "output" && access.port === 0x20 && access.value === 0x20)));
  assert.equal(machine.ram.read(0x300), 1); assert.equal(machine.cpu.snapshot().sp, 0x8000);
  assert.equal(machine.io.snapshot().pic.isr, 0); assert.equal(machine.io.snapshot().clock.ticks, 60);
  machine.io.advanceOscillatorTicks(12000); assert.equal(stepXtCpu(machine).outcome, "halted");
  assert.equal(machine.ram.read(0x300), 1);
});

test("saved timer phase and pending IRQ0 replay identically through the generated machine factory", () => {
  const machine = create8088XtTimer(); untilHalted(machine); machine.io.advanceOscillatorTicks(59);
  const snapshot = machine.snapshot(), restored = create8088XtTimer(snapshot);
  machine.io.advanceOscillatorTicks(1); restored.io.advanceOscillatorTicks(1);
  const pending = create8088XtTimer(restored.snapshot());
  const records = untilHalted(machine);
  assert.deepEqual(untilHalted(restored), records); assert.deepEqual(untilHalted(pending), records);
  assert.deepEqual(restored.snapshot(), machine.snapshot()); assert.deepEqual(pending.snapshot(), machine.snapshot());
  assert.equal(snapshot.io.clock.ticks, 59); assert.equal(snapshot.io.pic.irr, 0);
  const devices = machine.io.snapshot(); machine.cpu.reset(); assert.deepEqual(machine.io.snapshot(), devices);
  machine.reset(); assert.equal(machine.io.snapshot().clock.ticks, 0); assert.equal(machine.io.snapshot().pit.channels[0].rw, 0);
  assert.equal(machine.ram.read(0x300), 1); assert.equal(create8088XtTimer().ram.read(0x300), 0);
});
