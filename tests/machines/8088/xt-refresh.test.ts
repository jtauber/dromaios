import assert from "node:assert/strict";
import { test } from "node:test";
import { create8088XtRefresh } from "../../../src/machines/generated/8088/xt-refresh.js";
import { stepTimedXtCpu } from "../../../src/machines/8088/pc-xt/interrupts.js";
import { InstructionTimingUnavailable } from "../../../src/components/cpus/instruction-timing.js";

function run(machine: ReturnType<typeof create8088XtRefresh>, steps: number) {
  return Array.from({ length: steps }, () => stepTimedXtCpu(machine));
}

test("8088 programs DMA and PIT through real ports, then continues refresh while halted", () => {
  const machine = create8088XtRefresh(), memory = machine.snapshot().ram;
  const records = run(machine, 180);
  const refreshes = records.flatMap(result => result.refresh ? [result.refresh] : []);
  assert.ok(refreshes.length >= 8);
  assert.deepEqual(refreshes.map(refresh => refresh.address), refreshes.map((_, i) => 0xfe + i % 4));
  assert.ok(refreshes.every(refresh => refresh.oscillatorTicks === 12));
  assert.ok(records.some(({ record, refresh }) => record.outcome === "halted" && refresh));
  assert.deepEqual(machine.snapshot().ram, memory);
  assert.equal(machine.io.snapshot().dma.terminal, 1);
  assert.equal(machine.io.snapshot().dma.base_count[0], 3);
  assert.equal(machine.io.oscillatorTicks, records.reduce((sum, result) => sum + result.oscillatorTicks, 0));
  for (const result of records) {
    if (result.record.clocks) assert.equal(result.oscillatorTicks, result.record.clocks * 3 + (result.refresh?.oscillatorTicks ?? 0));
  }
});

test("XT DMA, refresh latch, and clock survive saves at arbitrary execution batch boundaries", () => {
  const machine = create8088XtRefresh(), expected = run(machine, 130);
  for (const batch of [1, 7, 19]) {
    let restored = create8088XtRefresh();
    const actual = [];
    for (let step = 0; step < expected.length; step++) {
      actual.push(stepTimedXtCpu(restored));
      if ((step + 1) % batch === 0) restored = create8088XtRefresh(restored.snapshot());
    }
    assert.deepEqual(actual, expected);
    assert.deepEqual(restored.snapshot(), machine.snapshot());
  }
});

test("a completed refresh remains observable if the following CPU instruction lacks timing", () => {
  const machine = create8088XtRefresh();
  for (let step = 0; step < 30 && !machine.io.snapshot().refreshPending; step++) stepTimedXtCpu(machine);
  assert.equal(machine.io.snapshot().refreshPending, true);
  const cpu = machine.cpu.snapshot(), before = machine.io.snapshot();
  machine.ram.write(cpu.ip, 0xd0); machine.ram.write(cpu.ip + 1, 0xc0); // ROL AL,1 has no timing rule yet.
  assert.throws(() => stepTimedXtCpu(machine), InstructionTimingUnavailable);
  assert.deepEqual(machine.cpu.snapshot(), cpu);
  const after = machine.io.snapshot();
  assert.equal(after.clock.ticks, before.clock.ticks + 12);
  assert.equal(after.dma.address[0], 0xff); assert.equal(after.dma.count[0], 2);
  assert.equal(after.refreshPending, false);
});
