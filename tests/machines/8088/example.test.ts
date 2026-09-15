import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu8088Snapshot, Cpu8088StepRecord } from "../../../src/components/cpus/8088.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8088Example, create8088ExampleMemory } from "../../../src/machines/generated/8088/example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(): Cpu8088Snapshot {
  return { halted: false, ax: 0x1122, bx: 0x3344, cx: 0x5566, dx: 0x7788,
    sp: 0x8000, bp: 0x9000, si: 0x10, di: 0x20, cs: 0x1234, ds: 0x2000, ss: 0x3000, es: 0x4000, ip: 0x100,
    al: 0x22, ah: 0x11, bl: 0x44, bh: 0x33, cl: 0x66, ch: 0x55, dl: 0x88, dh: 0x77, pc: 0x12440,
    flags: { cf: true, pf: false, af: true, zf: true, sf: true, tf: false, if: true, df: true, of: true } };
}

function checkMemory(ram: Ram, finished = false): void {
  const expected = new Uint8Array(0x100000);
  // Literal program from the specification, independent of the generated factories.
  expected.set([0xb8, 0xff, 0x12, 5, 2, 0, 0xa3, 0x81, 0], 0x12440);
  if (finished) expected.set([1, 0x13], 0x20081);
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu8088StepRecord[] {
  const before = initialState();
  const load = { ...before, ax: 0x12ff, ah: 0x12, al: 0xff, ip: 0x103, pc: 0x12443 };
  const add = { ...load, ax: 0x1301, ah: 0x13, al: 1, ip: 0x106, pc: 0x12446,
    flags: { cf: false, pf: false, af: true, zf: false, sf: false, tf: false, if: true, df: true, of: false } };
  const store = { ...add, ip: 0x109, pc: 0x12449 };
  return [
    { before, after: load, instruction: { address: 0x12440, bytes: [0xb8, 0xff, 0x12] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x12440, value: 0xb8 }, { kind: "read", address: 0x12441, value: 0xff },
        { kind: "read", address: 0x12442, value: 0x12 }] },
    { before: load, after: add, instruction: { address: 0x12443, bytes: [5, 2, 0] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x12443, value: 5 }, { kind: "read", address: 0x12444, value: 2 },
        { kind: "read", address: 0x12445, value: 0 }] },
    { before: add, after: store, instruction: { address: 0x12446, bytes: [0xa3, 0x81, 0] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x12446, value: 0xa3 }, { kind: "read", address: 0x12447, value: 0x81 },
        { kind: "read", address: 0x12448, value: 0 }, { kind: "write", address: 0x20081, value: 1 },
        { kind: "write", address: 0x20082, value: 0x13 }] },
  ];
}

test("8088 factories create independent full one-MiB images and explicit logical state with derived byte and PC views", () => {
  const memory = create8088ExampleMemory();
  const first = create8088Example();
  const second = create8088Example();
  for (const ram of [memory, first.ram, second.ram]) checkMemory(ram);
  for (const machine of [first, second]) {
    assert.deepEqual(machine.cpu.snapshot(), initialState());
    assert.equal(machine.endAddress, 0x12449);
  }
  memory.write(0x12440, 0);
  first.cpu.step();
  first.ram.write(0x20081, 0xff);
  assert.notStrictEqual(first.cpu, second.cpu);
  assert.notStrictEqual(first.ram, second.ram);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  checkMemory(second.ram);
});

test("8088 arithmetic records CS instruction fetches and DS word stores and completes at the physical endpoint", t => {
  const { cpu, ram, endAddress } = create8088Example();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const records = expectedRecords();
  assert.deepEqual(runCpu(cpu, { maxSteps: 3, endAddress }), { records, stopReason: "completed" });
  assert.deepEqual(read.mock.calls.map(call => call.arguments),
    [[0x12440], [0x12441], [0x12442], [0x12443], [0x12444], [0x12445], [0x12446], [0x12447], [0x12448]]);
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x20081, 1], [0x20082, 0x13]]);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress: 0x109 }), { records: [], stopReason: "step-limit" });
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  assert.equal(read.mock.callCount(), 9);
  t.mock.restoreAll();
  checkMemory(ram, true);
  const final = records[2]!.after;
  assert.deepEqual(cpu.snapshot(), final);
  // An endpoint does not halt the CPU: 00 00 now executes ADD [BX+SI],AL.
  assert.equal(cpu.step().outcome, "executed");
  assert.equal(cpu.snapshot().ip, final.ip + 2);
});

test("8088 example pauses after MOV and resumes through the shared runner with unchanged earlier records", () => {
  const { cpu, endAddress } = create8088Example();
  const expected = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 1, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { records: expected.slice(0, 1), stopReason: "step-limit" });
  assert.deepEqual(runCpu(cpu, { maxSteps: 2, endAddress }), { records: expected.slice(1), stopReason: "completed" });
  assert.deepEqual(first, saved);
  const fresh = create8088Example();
  assert.deepEqual(runCpu(fresh.cpu, { maxSteps: 3 }), { records: expected, stopReason: "step-limit" });
});

test("8088 reset preserves the example's result, starts at FFFF:0000 without vector reads, and differs from restart", t => {
  const { cpu, ram, endAddress } = create8088Example();
  const records = runCpu(cpu, { maxSteps: 3, endAddress }).records;
  const saved = structuredClone(records);
  const before = expectedRecords()[2]!.after;
  const after = { ...before, cs: 0xffff, ds: 0, ss: 0, es: 0, ip: 0, pc: 0xffff0,
    flags: { cf: false, pf: false, af: false, zf: false, sf: false, tf: false, if: false, df: false, of: false } };
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const reset = cpu.reset();
  assert.deepEqual(reset, { before, after, accesses: [] });
  assert.equal(read.mock.callCount(), 0);
  assert.equal(write.mock.callCount(), 0);
  t.mock.restoreAll();
  checkMemory(ram, true);
  ram.write(0xffff0, 0x0f); // An explicitly unsupported original-8088 encoding.
  assert.equal(cpu.step().outcome, "unsupported");
  [0xb8, 0xef, 0xbe].forEach((byte, offset) => ram.write(0xffff0 + offset, byte));
  assert.equal(cpu.step().after.ax, 0xbeef);
  assert.deepEqual(reset.after, after);
  const fresh = create8088Example();
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  checkMemory(fresh.ram);
  assert.deepEqual(records, saved);
  Reflect.set(records[0]!.after.flags, "if", false);
  assert.equal(records[1]!.before.flags.if, true);
});
