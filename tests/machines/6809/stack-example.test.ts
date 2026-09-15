import assert from "node:assert/strict";
import { test } from "node:test";
import { runCpu } from "../../../src/runtime/run-cpu.js";
import type { Cpu6809StepRecord } from "../../../src/components/cpus/6809.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create6809StackExample,
  create6809StackExampleMemory,
} from "../../../src/machines/generated/6809/stack-example.js";

function expectedInitialState() {
  return { waitMode: "none" as const, nmiArmed: false,
    a: 0x56, b: 0x78, d: 0x5678, dp: 0x12, x: 0x3456, y: 0x789a, s: 0x8000, u: 0x4000, pc: 0x0200,
    flags: { e: false, f: false, h: true, i: false, n: true, z: false, v: true, c: true },
  };
}

function checkExampleMemory(ram: Ram, changes: readonly (readonly [number, number])[] = []): void {
  const expected = new Uint8Array(65_536);
  // Literal program and vector from the specification, independent of the loader.
  expected.set([
    0x86, 0x12, 0x34, 0x02, 0x86, 0x34, 0x36, 0x02, 0x86, 0x00,
    0x35, 0x02, 0xb7, 0x00, 0x80, 0x37, 0x02, 0xb7, 0x00, 0x81,
  ], 0x0200);
  expected[0xfffe] = 0x02;
  expected[0xffff] = 0x00;
  for (const [address, value] of changes) expected[address] = value;
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) {
    assert.equal(ram.read(address), value, `memory at ${address}`);
  }
}

test("the 6809 stack example creates both pointers, the full RAM image, and its completion address", () => {
  const { cpu, ram, endAddress } = create6809StackExample();
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  assert.equal(endAddress, 0x0214);
  checkExampleMemory(ram);
  const memory = create6809StackExampleMemory();
  checkExampleMemory(memory);
  memory.write(0x7fff, 0xff);
  assert.equal(ram.read(0x7fff), 0);
});

test("the 6809 stack lesson retrieves independent S and U values with exact state and access records", t => {
  const { cpu, ram, endAddress } = create6809StackExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const { records, stopReason } = runCpu(cpu, { maxSteps: 12, endAddress });
  assert.equal(stopReason, "completed");
  const before = expectedInitialState();
  const loadS = { ...before, a: 0x12, d: 0x1278, pc: 0x0202, flags: { ...before.flags, n: false, v: false } };
  const pushS = { ...loadS, nmiArmed: true, s: 0x7fff, pc: 0x0204 };
  const loadU = { ...pushS, a: 0x34, d: 0x3478, pc: 0x0206 };
  const pushU = { ...loadU, u: 0x3fff, pc: 0x0208 };
  const clear = { ...pushU, a: 0, d: 0x0078, pc: 0x020a, flags: { ...pushU.flags, z: true } };
  const pullS = { ...clear, a: 0x12, d: 0x1278, s: 0x8000, pc: 0x020c };
  const storeS = { ...pullS, pc: 0x020f, flags: { ...pullS.flags, z: false } };
  const pullU = { ...storeS, a: 0x34, d: 0x3478, u: 0x4000, pc: 0x0211 };
  const storeU = { ...pullU, pc: 0x0214 };
  const expected: readonly Cpu6809StepRecord[] = [
    {
      instruction: { address: 0x0200, bytes: [0x86, 0x12] },
      before, after: loadS,
      accesses: [
        { kind: "read", address: 0x0200, value: 0x86 },
        { kind: "read", address: 0x0201, value: 0x12 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0202, bytes: [0x34, 0x02] },
      before: loadS, after: pushS,
      accesses: [
        { kind: "read", address: 0x0202, value: 0x34 },
        { kind: "read", address: 0x0203, value: 0x02 },
        { kind: "write", address: 0x7fff, value: 0x12 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0204, bytes: [0x86, 0x34] },
      before: pushS, after: loadU,
      accesses: [
        { kind: "read", address: 0x0204, value: 0x86 },
        { kind: "read", address: 0x0205, value: 0x34 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0206, bytes: [0x36, 0x02] },
      before: loadU, after: pushU,
      accesses: [
        { kind: "read", address: 0x0206, value: 0x36 },
        { kind: "read", address: 0x0207, value: 0x02 },
        { kind: "write", address: 0x3fff, value: 0x34 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0208, bytes: [0x86, 0x00] },
      before: pushU, after: clear,
      accesses: [
        { kind: "read", address: 0x0208, value: 0x86 },
        { kind: "read", address: 0x0209, value: 0x00 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x020a, bytes: [0x35, 0x02] },
      before: clear, after: pullS,
      accesses: [
        { kind: "read", address: 0x020a, value: 0x35 },
        { kind: "read", address: 0x020b, value: 0x02 },
        { kind: "read", address: 0x7fff, value: 0x12 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x020c, bytes: [0xb7, 0x00, 0x80] },
      before: pullS, after: storeS,
      accesses: [
        { kind: "read", address: 0x020c, value: 0xb7 },
        { kind: "read", address: 0x020d, value: 0x00 },
        { kind: "read", address: 0x020e, value: 0x80 },
        { kind: "write", address: 0x0080, value: 0x12 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x020f, bytes: [0x37, 0x02] },
      before: storeS, after: pullU,
      accesses: [
        { kind: "read", address: 0x020f, value: 0x37 },
        { kind: "read", address: 0x0210, value: 0x02 },
        { kind: "read", address: 0x3fff, value: 0x34 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0211, bytes: [0xb7, 0x00, 0x81] },
      before: pullU, after: storeU,
      accesses: [
        { kind: "read", address: 0x0211, value: 0xb7 },
        { kind: "read", address: 0x0212, value: 0x00 },
        { kind: "read", address: 0x0213, value: 0x81 },
        { kind: "write", address: 0x0081, value: 0x34 },
      ],
      outcome: "executed",
    },
  ];
  assert.deepEqual(records, expected);
  assert.equal(cpu.snapshot().pc, endAddress);
  assert.deepEqual(cpu.snapshot(), storeU);
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments),
    accesses.filter(access => access.kind === "read").map(access => [access.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments),
    accesses.filter(access => access.kind === "write").map(access => [access.address, access.value]));
  t.mock.restoreAll();
  checkExampleMemory(ram, [[0x7fff, 0x12], [0x3fff, 0x34], [0x0080, 0x12], [0x0081, 0x34]]);
  // Completion belongs to the caller; the CPU still attempts the next instruction.
  ram.write(endAddress, 0x01); // Explicit unsupported-byte fixture after caller completion.
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x0214, bytes: [0x01] },
    before: storeU, after: storeU,
    accesses: [{ kind: "read", address: 0x0214, value: 0x01 }],
    outcome: "unsupported", reason: "opcode",
  });
});

test("6809 reset preserves occupied S and U stacks while restarting the lesson creates fresh components", t => {
  const first = create6809StackExample();
  const records = Array.from({ length: 4 }, () => first.cpu.step());
  const savedRecords = structuredClone(records);
  const before = {
    ...expectedInitialState(), nmiArmed: true, a: 0x34, d: 0x3478, pc: 0x0208, s: 0x7fff, u: 0x3fff,
    flags: { ...expectedInitialState().flags, n: false, v: false },
  };
  assert.deepEqual(first.cpu.snapshot(), before);
  const after = { ...before, pc: 0x0200, dp: 0, nmiArmed: false, flags: { ...before.flags, f: true, i: true } };
  const read = t.mock.method(first.ram, "read");
  const write = t.mock.method(first.ram, "write");
  const reset = first.cpu.reset();
  const savedReset = structuredClone(reset);
  assert.deepEqual(reset, {
    before, after,
    accesses: [
      { kind: "read", address: 0xfffe, value: 0x02 },
      { kind: "read", address: 0xffff, value: 0x00 },
    ],
  });
  assert.deepEqual(first.cpu.snapshot(), after);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [[0xfffe], [0xffff]]);
  assert.deepEqual(write.mock.calls, []);
  t.mock.restoreAll();
  checkExampleMemory(first.ram, [[0x7fff, 0x12], [0x3fff, 0x34]]);
  for (let step = 0; step < 9; step++) assert.equal(first.cpu.step().outcome, "executed");
  assert.deepEqual(first.cpu.snapshot(), { ...after, nmiArmed: true, pc: 0x0214 });
  checkExampleMemory(first.ram, [
    [0x7fff, 0x12], [0x3fff, 0x34], [0x7ffe, 0x12], [0x3ffe, 0x34], [0x0080, 0x12], [0x0081, 0x34],
  ]);
  const restarted = create6809StackExample();
  assert.notEqual(restarted.cpu, first.cpu);
  assert.notEqual(restarted.ram, first.ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  assert.equal(restarted.endAddress, 0x0214);
  checkExampleMemory(restarted.ram);
  restarted.ram.write(0x7fff, 0xff);
  assert.equal(first.ram.read(0x7fff), 0x12);
  assert.deepEqual(records, savedRecords);
  assert.deepEqual(reset, savedReset);
});
