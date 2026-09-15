import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import { create68000Example } from "../../../src/machines/generated/68000/example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

test("68000 runner traverses TRAP, trace, IRQ, RESET, and three RTEs with restorable boundaries", () => {
  const machine = create68000Example();
  const { ram } = machine;
  const before = { ...machine.cpu.snapshot(), pc: 0xab001000, flags: { x: true, n: false, z: true, v: false, c: true, s: false, t: true } };
  for (const [address, bytes] of [[128, [0xcd, 0, 0x20, 0]], [36, [0xef, 0, 0x30, 0]], [108, [0x12, 0, 0x40, 0]],
    [0x1000, [0x4e, 0x40]], [0x2000, [0x4e, 0x73]], [0x3000, [0x4e, 0x73]], [0x4000, [0x4e, 0x70, 0x4e, 0x73]]] as const) {
    bytes.forEach((b, i) => ram.write(address + i, b));
  }
  let resets = 0;
  const connections = { resetDevices: () => { resets++; } };
  let cpu = new Cpu68000(ram, before, connections);
  const trap = runCpu(cpu, { maxSteps: 1 });
  assert.equal(trap.stopReason, "step-limit");
  assert.equal(cpu.snapshot().pc, 0xcd002000);
  assert.equal(cpu.snapshot().tracePending, true);
  assert.equal(cpu.interrupt(3, () => { assert.fail("Trace takes priority"); }).outcome, "ignored");
  cpu = new Cpu68000(ram, cpu.snapshot(), connections);
  const trace = runCpu(cpu, { maxSteps: 1 });
  assert.equal(trace.records[0]!.instruction, null);
  assert.equal(cpu.snapshot().pc, 0xef003000);
  cpu = new Cpu68000(ram, cpu.snapshot(), connections);
  const irq = cpu.interrupt(3, () => "autovector");
  assert.equal(irq.outcome, "accepted");
  assert.equal(cpu.snapshot().pc, 0x12004000);
  assert.equal(cpu.snapshot().ssp, before.ssp - 18);
  const saved = structuredClone({ trap, trace, irq });
  const addresses = [];
  for (let i = 0; i < 4; i++) {
    cpu = new Cpu68000(ram, cpu.snapshot(), connections);
    const run = runCpu(cpu, { maxSteps: 1, endAddress: before.pc + 2 });
    assert.equal(run.stopReason, i === 3 ? "completed" : "step-limit");
    addresses.push(cpu.snapshot().pc);
  }
  assert.deepEqual(addresses, [0x12004002, 0xef003000, 0xcd002000, 0xab001002]);
  assert.equal(resets, 1);
  assert.deepEqual(cpu.snapshot(), { ...before, pc: before.pc + 2, physicalPc: 0x1002, a7: before.usp });
  assert.deepEqual({ trap, trace, irq }, saved);
});

test("68000 runner stops at STOP and resumes through a selected interrupt and RTE", () => {
  const { cpu: initial, ram } = create68000Example();
  const before = { ...initial.snapshot(), pc: 0xab001000, flags: { ...initial.snapshot().flags, s: true, t: false } };
  for (const [address, bytes] of [[0x1000, [0x4e, 0x72, 0x22, 0, 0x70, 0x2a]],
    [0x4000, [0x4e, 0x73]], [108, [0xcd, 0, 0x40, 0]]] as const) bytes.forEach((b, i) => ram.write(address + i, b));
  let cpu = new Cpu68000(ram, before);
  const stop = runCpu(cpu, { maxSteps: 10 });
  assert.equal(stop.stopReason, "halted");
  assert.equal(stop.records.length, 1);
  assert.equal(cpu.interrupt(2, () => { assert.fail("Masked STOP must not acknowledge"); }).outcome, "ignored");
  assert.equal(cpu.snapshot().halted, true);
  cpu = new Cpu68000(ram, cpu.snapshot());
  assert.equal(cpu.interrupt(3, () => "autovector").outcome, "accepted");
  const run = runCpu(cpu, { maxSteps: 2, endAddress: 0xab001006 });
  assert.equal(run.stopReason, "completed");
  assert.equal(cpu.snapshot().d0, 42);
  assert.equal(cpu.snapshot().ssp, before.ssp);
  assert.equal(cpu.snapshot().interruptMask, 2);
  assert.equal(cpu.snapshot().halted, false);
});
