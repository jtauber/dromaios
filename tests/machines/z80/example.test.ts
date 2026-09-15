import assert from "node:assert/strict";
import { test } from "node:test";
import type { CpuZ80StepRecord } from "../../../src/components/cpus/z80.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { createZ80Example, createZ80ExampleMemory } from "../../../src/machines/generated/z80/example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState() {
  const bank = () => ({
    a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, bc: 0, de: 0, hl: 0,
    flags: { s: false, z: false, h: false, pv: false, n: false, c: false },
  });
  return { ...bank(), alternate: bank(), ix: 0, iy: 0, pc: 0, sp: 0, i: 0, r: 0,
    im: 0 as const, interruptDeferred: false, nmiDeferred: false, iff1: false, iff2: false, halted: false };
}

function checkMemory(ram: Ram, result: number): void {
  const expected = new Uint8Array(65_536);
  expected.set([0x3e, 0x02, 0xc6, 0x03, 0x32, 0x80, 0x00, 0x76]);
  expected[0x80] = result;
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

test("Z80 example factories supply independent complete state and exactly the specified memory image", () => {
  const first = createZ80ExampleMemory();
  checkMemory(first, 0);
  first.write(0, 0);
  first.write(0x80, 9);
  first.write(0xffff, 0xff);
  const machine = createZ80Example();
  assert.deepEqual(machine.cpu.snapshot(), expectedInitialState());
  assert.equal(Object.hasOwn(machine, "endAddress"), false);
  checkMemory(machine.ram, 0);
  assert.equal(first.read(0x80), 9);
});

test("Z80 arithmetic executes the specified records, stores five, and halts with R equal to four", t => {
  const { cpu, ram } = createZ80Example();
  const before = expectedInitialState();
  const load = { ...before, a: 2, pc: 2, r: 1 };
  const add = { ...before, a: 5, pc: 4, r: 2 };
  const store = { ...add, pc: 7, r: 3 };
  const halt = { ...store, pc: 8, r: 4, halted: true };
  const expected: readonly CpuZ80StepRecord[] = [
    { before, after: load, instruction: { address: 0, bytes: [0x3e, 2] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0, value: 0x3e }, { kind: "read", address: 1, value: 2 }] },
    { before: load, after: add, instruction: { address: 2, bytes: [0xc6, 3] }, outcome: "executed",
      accesses: [{ kind: "read", address: 2, value: 0xc6 }, { kind: "read", address: 3, value: 3 }] },
    { before: add, after: store, instruction: { address: 4, bytes: [0x32, 0x80, 0] }, outcome: "executed",
      accesses: [{ kind: "read", address: 4, value: 0x32 }, { kind: "read", address: 5, value: 0x80 },
        { kind: "read", address: 6, value: 0 }, { kind: "write", address: 0x80, value: 5 }] },
    { before: store, after: halt, instruction: { address: 7, bytes: [0x76] }, outcome: "halted",
      accesses: [{ kind: "read", address: 7, value: 0x76 }] },
  ];
  assert.deepEqual(cpu.snapshot(), before);
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const result = runCpu(cpu, { maxSteps: 4 });
  assert.deepEqual(result, { records: expected, stopReason: "halted" });
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [[0], [1], [2], [3], [4], [5], [6], [7]]);
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x80, 5]]);
  assert.deepEqual(cpu.snapshot(), halt);
  assert.deepEqual(cpu.step(), { before: halt, after: halt, instruction: null, outcome: "halted", accesses: [] });
  assert.equal(read.mock.callCount(), 8);
  read.mock.restore();
  write.mock.restore();
  checkMemory(ram, 5);
});

test("Z80 bounded runs resume and caller completion can stop before HALT without advancing R", () => {
  const { cpu } = createZ80Example();
  const first = runCpu(cpu, { maxSteps: 2 });
  const saved = structuredClone(first);
  assert.equal(first.stopReason, "step-limit");
  assert.equal(cpu.snapshot().r, 2);
  const second = runCpu(cpu, { maxSteps: 1, endAddress: 7 });
  assert.equal(second.stopReason, "completed");
  assert.equal(cpu.snapshot().r, 3);
  assert.equal(cpu.snapshot().halted, false);
  assert.deepEqual(runCpu(cpu, { maxSteps: 10, endAddress: 7 }), { records: [], stopReason: "completed" });
  assert.equal(runCpu(cpu, { maxSteps: 1, endAddress: 8 }).stopReason, "halted");
  assert.equal(cpu.snapshot().r, 4);
  const stopped = runCpu(cpu, { maxSteps: 10 });
  assert.equal(stopped.stopReason, "halted");
  assert.equal(stopped.records.length, 1);
  assert.equal(stopped.records[0]?.instruction, null);
  assert.deepEqual(stopped.records[0]?.accesses, []);
  assert.equal(cpu.snapshot().r, 4);
  assert.deepEqual(first, saved);
});

test("Z80 reset preserves data and modified code while restarting recreates the lesson", () => {
  const first = createZ80Example();
  const result = runCpu(first.cpu, { maxSteps: 4 });
  const saved = structuredClone(result);
  first.ram.write(0, 0);
  first.cpu.reset();
  assert.deepEqual(first.cpu.snapshot(), { ...expectedInitialState(), a: 5 });
  assert.equal(first.ram.read(0), 0);
  assert.equal(first.ram.read(0x80), 5);
  const restarted = createZ80Example();
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  checkMemory(restarted.ram, 0);
  restarted.cpu.step();
  restarted.ram.write(0x80, 9);
  assert.equal(first.ram.read(0x80), 5);
  assert.deepEqual(result, saved);
});
