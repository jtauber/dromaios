import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu8080MemoryAccess, Cpu8080Snapshot, Cpu8080StepRecord } from "../../../src/components/cpus/8080.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create8080ControlFlowExample,
  create8080ControlFlowExampleMemory,
} from "../../../src/machines/generated/8080/control-flow-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu8080Snapshot {
  return {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    bc: 0x2233, de: 0x4455, hl: 0x6677, pc: 0, sp: 0x2000,
    flags: { s: true, z: false, ac: true, p: false, cy: true },
    interruptEnabled: false, interruptDeferred: false, halted: false,
  };
}

function checkMemory(ram: Ram, stage: "initial" | "called" | "finished"): void {
  // Independently authored image from the specification, including zero-filled gaps.
  const expected = new Uint8Array(0x10000);
  expected.set([0x3e, 0xfe, 0xcd, 0x10, 0x00, 0xc2, 0x02, 0x00, 0x32, 0x80, 0x00, 0x76]);
  expected.set([0xc6, 0x01, 0xc9], 0x0010);
  expected[0x0080] = stage === "finished" ? 0 : 0xa5;
  if (stage !== "initial") expected[0x1ffe] = 5;
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu8080StepRecord[] {
  const initial = expectedInitialState();
  const load = { ...initial, a: 0xfe, pc: 2 };
  const call1 = { ...load, pc: 0x10, sp: 0x1ffe };
  const add1 = { ...call1, a: 0xff, pc: 0x12,
    flags: { s: true, z: false, ac: false, p: true, cy: false } };
  const return1 = { ...add1, pc: 5, sp: 0x2000 };
  const jump1 = { ...return1, pc: 2 };
  const call2 = { ...jump1, pc: 0x10, sp: 0x1ffe };
  const add2 = { ...call2, a: 0, pc: 0x12,
    flags: { s: false, z: true, ac: true, p: true, cy: true } };
  const return2 = { ...add2, pc: 5, sp: 0x2000 };
  const jump2 = { ...return2, pc: 8 };
  const store = { ...jump2, pc: 0x0b };
  const halt = { ...store, pc: 0x0c, halted: true };
  const push: readonly Cpu8080MemoryAccess[] = [
    { kind: "write", address: 0x1fff, value: 0 }, { kind: "write", address: 0x1ffe, value: 5 },
  ];
  const pop: readonly Cpu8080MemoryAccess[] = [
    { kind: "read", address: 0x1ffe, value: 5 }, { kind: "read", address: 0x1fff, value: 0 },
  ];
  const steps: readonly {
    before: Cpu8080Snapshot; after: Cpu8080Snapshot; bytes: readonly number[];
    data?: readonly Cpu8080MemoryAccess[];
  }[] = [
    { before: initial, after: load, bytes: [0x3e, 0xfe] },
    { before: load, after: call1, bytes: [0xcd, 0x10, 0], data: push },
    { before: call1, after: add1, bytes: [0xc6, 1] },
    { before: add1, after: return1, bytes: [0xc9], data: pop },
    { before: return1, after: jump1, bytes: [0xc2, 2, 0] },
    { before: jump1, after: call2, bytes: [0xcd, 0x10, 0], data: push },
    { before: call2, after: add2, bytes: [0xc6, 1] },
    { before: add2, after: return2, bytes: [0xc9], data: pop },
    { before: return2, after: jump2, bytes: [0xc2, 2, 0] },
    { before: jump2, after: store, bytes: [0x32, 0x80, 0], data: [{ kind: "write", address: 0x80, value: 0 }] },
    { before: store, after: halt, bytes: [0x76] },
  ];
  return steps.map(({ before, after, bytes, data = [] }) => ({
    instruction: { address: before.pc, bytes }, before, after,
    accesses: [...bytes.map((value, offset): Cpu8080MemoryAccess => ({
      kind: "read", address: before.pc + offset, value,
    })), ...data],
    outcome: after.halted ? "halted" : "executed",
  }));
}

test("the 8080 control-flow example creates independent code, data, and stack images", () => {
  const first = create8080ControlFlowExampleMemory();
  checkMemory(first, "initial");
  first.write(0, 0);
  first.write(0x0080, 0);
  first.write(0x1ffe, 0xff);
  const second = create8080ControlFlowExampleMemory();
  assert.notStrictEqual(first, second);
  checkMemory(second, "initial");
});

test("the 8080 control-flow lesson calls twice, takes and skips JNZ, stores zero, and halts in eleven steps", (t) => {
  const { cpu, ram } = create8080ControlFlowExample();
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const result = runCpu(cpu, { maxSteps: 11 });
  const expected = expectedRecords();
  assert.equal(result.stopReason, "halted");
  assert.deepEqual(result.records, expected);
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments),
    accesses.flatMap(access => access.kind === "read" ? [[access.address]] : []));
  assert.deepEqual(write.mock.calls.map(call => call.arguments),
    [[0x1fff, 0], [0x1ffe, 5], [0x1fff, 0], [0x1ffe, 5], [0x0080, 0]]);
  checkMemory(ram, "finished");
  const final = expected[10]?.after;
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(cpu.step(), {
    before: final, after: final, instruction: null, accesses: [], outcome: "halted",
  });
});

test("the 8080 control-flow lesson resumes after a bounded run and preserves records across reset and restart", () => {
  const { cpu, ram } = create8080ControlFlowExample();
  const expected = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 5 });
  const saved = structuredClone(first);
  assert.equal(first.stopReason, "step-limit");
  assert.deepEqual(first.records, expected.slice(0, 5));
  checkMemory(ram, "called");
  const second = runCpu(cpu, { maxSteps: 6 });
  assert.equal(second.stopReason, "halted");
  assert.deepEqual(second.records, expected.slice(5));
  checkMemory(ram, "finished");
  const before = cpu.snapshot();
  assert.deepEqual(cpu.reset(), {
    before, after: { ...before, pc: 0, halted: false, interruptEnabled: false }, accesses: [],
  });
  checkMemory(ram, "finished");
  const restarted = create8080ControlFlowExample();
  assert.notStrictEqual(restarted.cpu, cpu);
  assert.notStrictEqual(restarted.ram, ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  checkMemory(restarted.ram, "initial");
  assert.deepEqual(first, saved);
});
