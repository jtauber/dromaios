import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8008 } from "../../../src/components/cpus/8008.js";
import type { Cpu8008MemoryAccess, Cpu8008Snapshot, Cpu8008StepRecord } from "../../../src/components/cpus/8008.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8008AluExample, create8008AluExampleMemory } from "../../../src/machines/generated/8008/alu-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu8008Snapshot {
  return { a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0xc0, l: 0x80, hl: 0xc080, pc: 0x0200,
    flags: { s: true, z: false, p: true, c: true },
    addressStack: [0x1111, 0x1222, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x0200], stackIndex: 7, halted: false };
}

function checkMemory(ram: Ram, completed = false): void {
  // Literal input, output, and program images, independent of the generated factory.
  const expected = new Uint8Array(0x4000);
  expected.set([0xcc, 0x20, 0, 0, 0, 0, 0, 0xcc], 0x7f);
  if (completed) expected.set([0x10, 0x02, 0xf0, 0x01, 0x75], 0x81);
  expected.set([0x06, 0xf0, 0x87, 0xc8, 0x06, 0x01, 0x0c, 0x00, 0xd0, 0xc1,
    0x97, 0xd8, 0xc2, 0x1c, 0x00, 0xe0, 0xc3, 0x24, 0x3f, 0x2c, 0x55, 0xb1,
    0x3c, 0x75, 0x36, 0x81, 0xf9, 0x36, 0x82, 0xfa, 0x36, 0x83, 0xfb,
    0x36, 0x84, 0xfc, 0x36, 0x85, 0xf8, 0xff], 0x0200);
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu8008StepRecord[] {
  const steps: readonly {
    bytes: readonly number[]; changes: Partial<Cpu8008Snapshot> & { pc: number }; data?: readonly Cpu8008MemoryAccess[];
  }[] = [
    { bytes: [0x06, 0xf0], changes: { pc: 0x0202, a: 0xf0 } },
    { bytes: [0x87], changes: { pc: 0x0203, a: 0x10, flags: { s: false, z: false, p: false, c: true } },
      data: [{ kind: "read", address: 0x80, value: 0x20 }] },
    { bytes: [0xc8], changes: { pc: 0x0204, b: 0x10 } },
    { bytes: [0x06, 0x01], changes: { pc: 0x0206, a: 0x01 } },
    { bytes: [0x0c, 0x00], changes: { pc: 0x0208, a: 0x02, flags: { s: false, z: false, p: false, c: false } } },
    { bytes: [0xd0], changes: { pc: 0x0209, c: 0x02 } },
    { bytes: [0xc1], changes: { pc: 0x020a, a: 0x10 } },
    { bytes: [0x97], changes: { pc: 0x020b, a: 0xf0, flags: { s: true, z: false, p: true, c: true } },
      data: [{ kind: "read", address: 0x80, value: 0x20 }] },
    { bytes: [0xd8], changes: { pc: 0x020c, d: 0xf0 } },
    { bytes: [0xc2], changes: { pc: 0x020d, a: 0x02 } },
    { bytes: [0x1c, 0x00], changes: { pc: 0x020f, a: 0x01, flags: { s: false, z: false, p: false, c: false } } },
    { bytes: [0xe0], changes: { pc: 0x0210, e: 0x01 } },
    { bytes: [0xc3], changes: { pc: 0x0211, a: 0xf0 } },
    { bytes: [0x24, 0x3f], changes: { pc: 0x0213, a: 0x30, flags: { s: false, z: false, p: true, c: false } } },
    { bytes: [0x2c, 0x55], changes: { pc: 0x0215, a: 0x65, flags: { s: false, z: false, p: true, c: false } } },
    { bytes: [0xb1], changes: { pc: 0x0216, a: 0x75, flags: { s: false, z: false, p: false, c: false } } },
    { bytes: [0x3c, 0x75], changes: { pc: 0x0218, flags: { s: false, z: true, p: true, c: false } } },
    { bytes: [0x36, 0x81], changes: { pc: 0x021a, l: 0x81, hl: 0xc081 } },
    { bytes: [0xf9], changes: { pc: 0x021b }, data: [{ kind: "write", address: 0x81, value: 0x10 }] },
    { bytes: [0x36, 0x82], changes: { pc: 0x021d, l: 0x82, hl: 0xc082 } },
    { bytes: [0xfa], changes: { pc: 0x021e }, data: [{ kind: "write", address: 0x82, value: 0x02 }] },
    { bytes: [0x36, 0x83], changes: { pc: 0x0220, l: 0x83, hl: 0xc083 } },
    { bytes: [0xfb], changes: { pc: 0x0221 }, data: [{ kind: "write", address: 0x83, value: 0xf0 }] },
    { bytes: [0x36, 0x84], changes: { pc: 0x0223, l: 0x84, hl: 0xc084 } },
    { bytes: [0xfc], changes: { pc: 0x0224 }, data: [{ kind: "write", address: 0x84, value: 0x01 }] },
    { bytes: [0x36, 0x85], changes: { pc: 0x0226, l: 0x85, hl: 0xc085 } },
    { bytes: [0xf8], changes: { pc: 0x0227 }, data: [{ kind: "write", address: 0x85, value: 0x75 }] },
    { bytes: [0xff], changes: { pc: 0x0228, halted: true } },
  ];
  let state = expectedInitialState();
  return steps.map(({ bytes, changes, data = [] }) => {
    const before = state;
    state = { ...before, ...changes,
      addressStack: [0x1111, 0x1222, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, changes.pc] };
    return { before, after: state, instruction: { address: before.pc, bytes },
      accesses: [...bytes.map((value, offset): Cpu8008MemoryAccess => ({ kind: "read", address: before.pc + offset, value })), ...data],
      outcome: state.halted ? "halted" : "executed" };
  });
}

test("8008 ALU factories provide fresh components and the specified initial state and memory without executing", () => {
  const { cpu, ram } = create8008AluExample();
  const memory = create8008AluExampleMemory();
  assert.notStrictEqual(memory, ram);
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  checkMemory(ram);
  checkMemory(memory);
  ram.write(0x80, 0xff);
  assert.equal(memory.read(0x80), 0x20);
});

test("8008 ALU example propagates carry and borrow, combines bits, and retains A and flags through compare and stores", t => {
  const { cpu, ram } = create8008AluExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  assert.deepEqual(runCpu(cpu, { maxSteps: 28 }), { records: expected, stopReason: "halted" });
  const reads = expected.flatMap(record => record.accesses).filter(access => access.kind === "read");
  assert.deepEqual(read.mock.calls.map(call => call.arguments), reads.map(access => [access.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x81, 0x10], [0x82, 2], [0x83, 0xf0], [0x84, 1], [0x85, 0x75]]);
  const final = expected.at(-1)!.after;
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
  assert.equal(read.mock.callCount(), 42);
  assert.equal(write.mock.callCount(), 5);
  t.mock.restoreAll();
  checkMemory(ram, true);
});

test("8008 ALU example resumes with a pending borrow and retains earlier records through execution, reset, and edits", () => {
  const { cpu, ram } = create8008AluExample();
  const first = runCpu(cpu, { maxSteps: 9 });
  const saved = structuredClone(first);
  const expected = expectedRecords();
  assert.deepEqual(first, { records: expected.slice(0, 9), stopReason: "step-limit" });
  checkMemory(ram);
  const paused = cpu.snapshot();
  assert.equal(paused.flags.c, true);
  const resumed = new Cpu8008(ram, paused);
  Reflect.set(paused.flags, "c", false);
  Reflect.set(paused.addressStack, 7, 0);
  assert.deepEqual(runCpu(resumed, { maxSteps: 19 }), { records: expected.slice(9), stopReason: "halted" });
  const before = resumed.snapshot();
  const after: Cpu8008Snapshot = { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, hl: 0, pc: 0,
    flags: { s: false, z: true, p: true, c: false },
    addressStack: [0, 0, 0, 0, 0, 0, 0, 0], stackIndex: 0, halted: true };
  const reset = resumed.reset();
  assert.deepEqual(reset, { before, after, accesses: [] });
  assert.deepEqual(resumed.step(), { before: after, after, instruction: null, accesses: [], outcome: "halted" });
  checkMemory(ram, true);
  Reflect.set(reset.before.flags, "z", false);
  ram.write(0x81, 0);
  assert.deepEqual(first, saved);
  const fresh = create8008AluExample();
  assert.notStrictEqual(fresh.cpu, cpu);
  assert.notStrictEqual(fresh.ram, ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram);
});
