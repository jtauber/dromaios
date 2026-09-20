import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu8008Snapshot, Cpu8008StepRecord } from "../../../src/components/cpus/generated/8008-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8008StackExample, create8008StackExampleMemory } from "../../../src/machines/generated/8008/stack-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu8008Snapshot {
  return { a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0xc0, l: 0x80, hl: 0xc080, pc: 0x0200,
    flags: { s: true, z: false, p: true, c: true },
    addressStack: [0x1111, 0x1222, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x0200], stackIndex: 7, halted: false };
}

function checkMemory(ram: Ram, result = 0): void {
  // Literal images from the specification, independent of the generated factory.
  const expected = new Uint8Array(16_384);
  expected.set([0x06, 2, 0x46, 0, 3, 0xf8, 0x7c, 0x0a, 0xc2, 0x22, 0], 0x0200);
  expected.set([0x04, 3, 0x7e, 0, 0x84, 0x04, 1, 0x3f], 0x0300);
  expected.set([0x04, 4, 0x07], 0x0400);
  expected[0x80] = result;
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu8008StepRecord[] {
  const initial = expectedInitialState();
  const load: Cpu8008Snapshot = { ...initial, a: 2, pc: 0x0202,
    addressStack: [0x1111, 0x1222, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x0202] };
  const outer: Cpu8008Snapshot = { ...load, pc: 0x0300, stackIndex: 0,
    addressStack: [0x0300, 0x1222, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x0205] };
  const addThree: Cpu8008Snapshot = { ...outer, a: 5, pc: 0x0302,
    flags: { s: false, z: false, p: true, c: false },
    addressStack: [0x0302, 0x1222, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x0205] };
  const inner: Cpu8008Snapshot = { ...addThree, pc: 0x0400, stackIndex: 1,
    addressStack: [0x0305, 0x0400, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x0205] };
  const addFour: Cpu8008Snapshot = { ...inner, a: 9, pc: 0x0402,
    addressStack: [0x0305, 0x0402, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x0205] };
  const returnInner: Cpu8008Snapshot = { ...addFour, pc: 0x0305, stackIndex: 0,
    addressStack: [0x0305, 0x0403, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x0205] };
  const addOne: Cpu8008Snapshot = { ...returnInner, a: 0x0a, pc: 0x0307,
    addressStack: [0x0307, 0x0403, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x0205] };
  const returnOuter: Cpu8008Snapshot = { ...addOne, pc: 0x0205, stackIndex: 7,
    addressStack: [0x0308, 0x0403, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x0205] };
  const store: Cpu8008Snapshot = { ...returnOuter, pc: 0x0206,
    addressStack: [0x0308, 0x0403, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x0206] };
  const jump: Cpu8008Snapshot = { ...store, pc: 0x020a,
    addressStack: [0x0308, 0x0403, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x020a] };
  const halt: Cpu8008Snapshot = { ...jump, pc: 0x020b, halted: true,
    addressStack: [0x0308, 0x0403, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x020b] };
  return [
    { before: initial, after: load, instruction: { address: 0x0200, bytes: [0x06, 2] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x0200, value: 0x06 }, { kind: "read", address: 0x0201, value: 2 }] },
    { before: load, after: outer, instruction: { address: 0x0202, bytes: [0x46, 0, 3] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x0202, value: 0x46 }, { kind: "read", address: 0x0203, value: 0 },
        { kind: "read", address: 0x0204, value: 3 }] },
    { before: outer, after: addThree, instruction: { address: 0x0300, bytes: [0x04, 3] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x0300, value: 0x04 }, { kind: "read", address: 0x0301, value: 3 }] },
    { before: addThree, after: inner, instruction: { address: 0x0302, bytes: [0x7e, 0, 0x84] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x0302, value: 0x7e }, { kind: "read", address: 0x0303, value: 0 },
        { kind: "read", address: 0x0304, value: 0x84 }] },
    { before: inner, after: addFour, instruction: { address: 0x0400, bytes: [0x04, 4] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x0400, value: 0x04 }, { kind: "read", address: 0x0401, value: 4 }] },
    { before: addFour, after: returnInner, instruction: { address: 0x0402, bytes: [0x07] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x0402, value: 0x07 }] },
    { before: returnInner, after: addOne, instruction: { address: 0x0305, bytes: [0x04, 1] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x0305, value: 0x04 }, { kind: "read", address: 0x0306, value: 1 }] },
    { before: addOne, after: returnOuter, instruction: { address: 0x0307, bytes: [0x3f] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x0307, value: 0x3f }] },
    { before: returnOuter, after: store, instruction: { address: 0x0205, bytes: [0xf8] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x0205, value: 0xf8 }, { kind: "write", address: 0x80, value: 0x0a }] },
    { before: store, after: jump, instruction: { address: 0x0206, bytes: [0x7c, 0x0a, 0xc2] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x0206, value: 0x7c }, { kind: "read", address: 0x0207, value: 0x0a },
        { kind: "read", address: 0x0208, value: 0xc2 }] },
    { before: jump, after: halt, instruction: { address: 0x020a, bytes: [0] }, outcome: "halted",
      accesses: [{ kind: "read", address: 0x020a, value: 0 }] },
  ];
}

test("8008 stack factories supply independent CPUs and full 16 KiB images with explicit inactive slots", () => {
  const memory = create8008StackExampleMemory();
  const first = create8008StackExample();
  const second = create8008StackExample();
  for (const ram of [memory, first.ram, second.ram]) checkMemory(ram);
  for (const example of [first, second]) {
    assert.deepEqual(example.cpu.snapshot(), expectedInitialState());
    assert.equal(Object.hasOwn(example, "endAddress"), false);
  }
  assert.notStrictEqual(first.cpu, second.cpu);
  assert.notStrictEqual(first.ram, second.ram);
  memory.write(0x200, 0);
  first.ram.write(0x80, 0xff);
  runCpu(first.cpu, { maxSteps: 4 });
  assert.deepEqual(second.cpu.snapshot(), expectedInitialState());
  checkMemory(second.ram);
});

test("8008 nested calls produce eleven complete records, store 0A, jump over 22, and halt", t => {
  const { cpu, ram } = create8008StackExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  assert.deepEqual(runCpu(cpu, { maxSteps: 11 }), { records: expected, stopReason: "halted" });
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [
    [0x0200], [0x0201], [0x0202], [0x0203], [0x0204], [0x0300], [0x0301], [0x0302], [0x0303], [0x0304],
    [0x0400], [0x0401], [0x0402], [0x0305], [0x0306], [0x0307], [0x0205], [0x0206], [0x0207], [0x0208], [0x020a],
  ]);
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x80, 0x0a]]);
  const final = expected[10]!.after;
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
  assert.equal(read.mock.callCount(), 21);
  assert.equal(write.mock.callCount(), 1);
  t.mock.restoreAll();
  checkMemory(ram, 0x0a);
});

test("8008 bounded running pauses inside nested calls and resumes using the selected PC for completion", () => {
  const { cpu, ram } = create8008StackExample();
  const expected = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 4 });
  const saved = structuredClone(first);
  assert.deepEqual(first, { records: expected.slice(0, 4), stopReason: "step-limit" });
  assert.deepEqual(cpu.snapshot(), expected[3]!.after);
  assert.deepEqual(runCpu(cpu, { maxSteps: 6, endAddress: 0x020a }),
    { records: expected.slice(4, 10), stopReason: "completed" });
  assert.deepEqual(cpu.snapshot(), expected[9]!.after);
  assert.deepEqual(runCpu(cpu, { maxSteps: 1, endAddress: 0x020b }),
    { records: expected.slice(10), stopReason: "halted" });
  assert.deepEqual(first, saved);
  checkMemory(ram, 0x0a);
});

test("8008 reset during nested calls clears the address stack and stays stopped; fresh factories restart the program", t => {
  const { cpu, ram } = create8008StackExample();
  const records = runCpu(cpu, { maxSteps: 4 }).records;
  const saved = structuredClone(records);
  ram.write(0x80, 0x55);
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const after: Cpu8008Snapshot = { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0, hl: 0,
    flags: { s: false, z: false, p: true, c: false },
    addressStack: [0, 0, 0, 0, 0, 0, 0, 0], stackIndex: 0, halted: true };
  assert.deepEqual(cpu.reset(), { before: expectedRecords()[3]!.after, after, accesses: [] });
  assert.deepEqual(cpu.step(), { before: after, after, instruction: null, accesses: [], outcome: "halted" });
  assert.equal(read.mock.callCount(), 0);
  assert.equal(write.mock.callCount(), 0);
  t.mock.restoreAll();
  checkMemory(ram, 0x55);
  const restarted = create8008StackExample();
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  checkMemory(restarted.ram);
  assert.deepEqual(runCpu(restarted.cpu, { maxSteps: 11 }), { records: expectedRecords(), stopReason: "halted" });
  assert.deepEqual(records, saved);
  Reflect.set(records[1]!.after.addressStack, 0, 0);
  Reflect.set(records[1]!.after.flags, "c", false);
  assert.deepEqual(records[2]!.before, saved[2]!.before);
  assert.deepEqual(cpu.snapshot(), after);
});
