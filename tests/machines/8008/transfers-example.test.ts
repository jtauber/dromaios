import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8008 } from "../../../src/components/cpus/8008.js";
import type { Cpu8008MemoryAccess, Cpu8008Snapshot, Cpu8008StepRecord } from "../../../src/components/cpus/8008.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8008TransfersExample, create8008TransfersExampleMemory } from "../../../src/machines/generated/8008/transfers-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu8008Snapshot {
  return { a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77, hl: 0x6677, pc: 0x0200,
    flags: { s: true, z: false, p: true, c: true },
    addressStack: [0x1111, 0x1222, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x0200], stackIndex: 7, halted: false };
}

function checkMemory(ram: Ram, source = 0, destination = 0): void {
  // Literal images from the specification, independent of the generated factory.
  const expected = new Uint8Array(0x4000);
  expected.set([0xcc, source, destination, 0xcc], 0x7f);
  expected.set([0xcc, 0x3c, 0xcc], 0x2580);
  expected.set([0x0e, 0xc0, 0x16, 0x80, 0x1e, 0x81, 0x26, 0x5a, 0xe9, 0xf2,
    0xfc, 0xc7, 0xf3, 0xf8, 0x3e, 0xa5, 0xef, 0xe7, 0xff], 0x0200);
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu8008StepRecord[] {
  const steps: readonly {
    bytes: readonly number[]; changes: Partial<Cpu8008Snapshot> & { pc: number }; data?: readonly Cpu8008MemoryAccess[];
  }[] = [
    { bytes: [0x0e, 0xc0], changes: { pc: 0x0202, b: 0xc0 } },
    { bytes: [0x16, 0x80], changes: { pc: 0x0204, c: 0x80 } },
    { bytes: [0x1e, 0x81], changes: { pc: 0x0206, d: 0x81 } },
    { bytes: [0x26, 0x5a], changes: { pc: 0x0208, e: 0x5a } },
    { bytes: [0xe9], changes: { pc: 0x0209, h: 0xc0, hl: 0xc077 } },
    { bytes: [0xf2], changes: { pc: 0x020a, l: 0x80, hl: 0xc080 } },
    { bytes: [0xfc], changes: { pc: 0x020b }, data: [{ kind: "write", address: 0x80, value: 0x5a }] },
    { bytes: [0xc7], changes: { pc: 0x020c, a: 0x5a }, data: [{ kind: "read", address: 0x80, value: 0x5a }] },
    { bytes: [0xf3], changes: { pc: 0x020d, l: 0x81, hl: 0xc081 } },
    { bytes: [0xf8], changes: { pc: 0x020e }, data: [{ kind: "write", address: 0x81, value: 0x5a }] },
    { bytes: [0x3e, 0xa5], changes: { pc: 0x0210 }, data: [{ kind: "write", address: 0x81, value: 0xa5 }] },
    { bytes: [0xef], changes: { pc: 0x0211, h: 0xa5, hl: 0xa581 }, data: [{ kind: "read", address: 0x81, value: 0xa5 }] },
    { bytes: [0xe7], changes: { pc: 0x0212, e: 0x3c }, data: [{ kind: "read", address: 0x2581, value: 0x3c }] },
    { bytes: [0xff], changes: { pc: 0x0213, halted: true } },
  ];
  let state = expectedInitialState();
  return steps.map(({ bytes, changes, data = [] }) => {
    const before = state;
    state = { ...before, ...changes,
      addressStack: [0x1111, 0x1222, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, changes.pc] };
    return {
      before, after: state, instruction: { address: before.pc, bytes },
      accesses: [...bytes.map((value, offset): Cpu8008MemoryAccess => ({ kind: "read", address: before.pc + offset, value })), ...data],
      outcome: state.halted ? "halted" : "executed",
    };
  });
}

test("8008 transfer factories provide independent RAM and explicit state without executing", () => {
  const { cpu, ram } = create8008TransfersExample();
  const memory = create8008TransfersExampleMemory();
  assert.notStrictEqual(memory, ram);
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  checkMemory(ram);
  checkMemory(memory);
  ram.write(0x80, 0xff);
  assert.equal(memory.read(0x80), 0);
});

test("8008 transfers copy and replace a byte, load H through its original address, and halt in fourteen steps", t => {
  const { cpu, ram } = create8008TransfersExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  assert.deepEqual(runCpu(cpu, { maxSteps: 14 }), { records: expected, stopReason: "halted" });
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), accesses.filter(access => access.kind === "read").map(access => [access.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x80, 0x5a], [0x81, 0x5a], [0x81, 0xa5]]);
  const final = expected.at(-1)!.after;
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
  assert.equal(read.mock.callCount(), 22);
  assert.equal(write.mock.callCount(), 3);
  t.mock.restoreAll();
  checkMemory(ram, 0x5a, 0xa5);
});

test("8008 transfer snapshots resume with the same trace, survive reset and edits, and restart with fresh factories", () => {
  const { cpu, ram } = create8008TransfersExample();
  const first = runCpu(cpu, { maxSteps: 8 });
  const saved = structuredClone(first);
  const expected = expectedRecords();
  assert.deepEqual(first, { records: expected.slice(0, 8), stopReason: "step-limit" });
  checkMemory(ram, 0x5a, 0);
  const resumed = new Cpu8008(ram, cpu.snapshot());
  assert.deepEqual(runCpu(resumed, { maxSteps: 6 }), { records: expected.slice(8), stopReason: "halted" });
  const before = resumed.snapshot();
  const after: Cpu8008Snapshot = { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, hl: 0, pc: 0,
    flags: { s: true, z: false, p: true, c: true },
    addressStack: [0, 0, 0, 0, 0, 0, 0, 0], stackIndex: 0, halted: true };
  const reset = resumed.reset();
  assert.deepEqual(reset, { before, after, accesses: [] });
  assert.deepEqual(resumed.step(), { before: after, after, instruction: null, accesses: [], outcome: "halted" });
  checkMemory(ram, 0x5a, 0xa5);
  Reflect.set(reset.before.addressStack, 7, 0);
  Reflect.set(reset.before.flags, "s", false);
  ram.write(0x80, 0);
  assert.deepEqual(first, saved);
  const fresh = create8008TransfersExample();
  assert.notStrictEqual(fresh.cpu, cpu);
  assert.notStrictEqual(fresh.ram, ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram);
});
