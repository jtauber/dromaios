import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6800 } from "../../../src/components/cpus/generated/6800-cpu.js";
import type { Cpu6800Flags, Cpu6800Snapshot, Cpu6800StepRecord, Cpu6800MemoryAccess } from "../../../src/components/cpus/generated/6800-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create6800AddressingExample, create6800AddressingExampleMemory } from "../../../src/machines/generated/6800/addressing-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedFlags(bits: number): Cpu6800Flags {
  return { h: Boolean(bits & 32), i: Boolean(bits & 16), n: Boolean(bits & 8),
    z: Boolean(bits & 4), v: Boolean(bits & 2), c: Boolean(bits & 1) };
}

function initialState(): Cpu6800Snapshot {
  return { waiting: false, a: 0x81, b: 0x22, x: 0xff80, sp: 0x0101, pc: 0x0200, flags: expectedFlags(0x2e) };
}

function checkMemory(ram: Ram, finished: boolean, edits: readonly (readonly [number, number])[] = []): void {
  const expected = new Uint8Array(65536);
  expected.set([
    0x96, 0x80, 0x8b, 1, 0xf6, 3, 0, 0xc9, 0, 0x97, 0x82, 0xd7, 0x83, 0xc1, 0x13,
    0x80, 1, 0xc2, 0, 0xa7, 0xff, 0xf7, 3, 1, 0x84, 0x0f, 0xda, 0x80, 0xa8, 0xff,
    0xe5, 0xff, 0xb1, 3, 2, 0x27, 2, 0x86, 0, 0xb7, 3, 3, 0xe7, 0xfe,
  ], 0x0200);
  expected.set([0xaa, 0xcc, 0, 0xff, 0x55, 0xcc, 0xcc, 0xaa], 0x007d);
  expected.set([0x12, 0xcc, 0xf0, 0xcc, 0x55], 0x0300);
  expected.set([2, 0], 0xfffe);
  if (finished) {
    expected[0x007e] = 0xff;
    expected[0x007f] = 0xff;
    expected[0x0082] = 0;
    expected[0x0083] = 0x13;
    expected[0x0301] = 0x12;
    expected[0x0303] = 0xf0;
  }
  for (const [address, value] of edits) expected[address] = value;
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `RAM at ${address}`);
}

function expectedRecords(): readonly Cpu6800StepRecord[] {
  // Literal after-state values and HINZVC status bits from the example specification.
  const rows: readonly (readonly [pc: number, bytes: readonly number[], a: number, b: number, status: number, data?: Cpu6800MemoryAccess])[] = [
    [0x0200, [0x96, 0x80], 0xff, 0x22, 0x28, { kind: "read", address: 0x0080, value: 0xff }],
    [0x0202, [0x8b, 1], 0, 0x22, 0x25],
    [0x0204, [0xf6, 3, 0], 0, 0x12, 0x21, { kind: "read", address: 0x0300, value: 0x12 }],
    [0x0207, [0xc9, 0], 0, 0x13, 0],
    [0x0209, [0x97, 0x82], 0, 0x13, 4, { kind: "write", address: 0x0082, value: 0 }],
    [0x020b, [0xd7, 0x83], 0, 0x13, 0, { kind: "write", address: 0x0083, value: 0x13 }],
    [0x020d, [0xc1, 0x13], 0, 0x13, 4],
    [0x020f, [0x80, 1], 0xff, 0x13, 9],
    [0x0211, [0xc2, 0], 0xff, 0x12, 0],
    [0x0213, [0xa7, 0xff], 0xff, 0x12, 8, { kind: "write", address: 0x007f, value: 0xff }],
    [0x0215, [0xf7, 3, 1], 0xff, 0x12, 0, { kind: "write", address: 0x0301, value: 0x12 }],
    [0x0218, [0x84, 0x0f], 0x0f, 0x12, 0],
    [0x021a, [0xda, 0x80], 0x0f, 0xff, 8, { kind: "read", address: 0x0080, value: 0xff }],
    [0x021c, [0xa8, 0xff], 0xf0, 0xff, 8, { kind: "read", address: 0x007f, value: 0xff }],
    [0x021e, [0xe5, 0xff], 0xf0, 0xff, 8, { kind: "read", address: 0x007f, value: 0xff }],
    [0x0220, [0xb1, 3, 2], 0xf0, 0xff, 4, { kind: "read", address: 0x0302, value: 0xf0 }],
    [0x0223, [0x27, 2], 0xf0, 0xff, 4],
    [0x0227, [0xb7, 3, 3], 0xf0, 0xff, 8, { kind: "write", address: 0x0303, value: 0xf0 }],
    [0x022a, [0xe7, 0xfe], 0xf0, 0xff, 8, { kind: "write", address: 0x007e, value: 0xff }],
  ];
  let state = initialState();
  return rows.map(([address, bytes, a, b, status, data], index) => {
    const before = state;
    state = { ...before, a, b, flags: expectedFlags(status), pc: rows[index + 1]?.[0] ?? 0x022c };
    return { before, after: state, instruction: { address, bytes }, outcome: "executed",
      accesses: [...bytes.map((value, offset): Cpu6800MemoryAccess => ({ kind: "read", address: address + offset, value })),
        ...(data ? [data] : [])] };
  });
}

test("6800 addressing factories create independent state and complete memory images", () => {
  const memory = create6800AddressingExampleMemory();
  checkMemory(memory, false);
  memory.write(0x80, 0);
  checkMemory(create6800AddressingExampleMemory(), false);
  const first = create6800AddressingExample();
  assert.deepEqual(first.cpu.snapshot(), initialState());
  assert.equal(first.endAddress, 0x022c);
  runCpu(first.cpu, { maxSteps: 19, endAddress: first.endAddress });
  const fresh = create6800AddressingExample();
  assert.notStrictEqual(fresh.ram, first.ram);
  assert.notStrictEqual(fresh.cpu, first.cpu);
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  checkMemory(fresh.ram, false);
});

test("6800 addressing example carries and borrows across bytes, wraps indexed addresses, and branches on comparison", t => {
  const { cpu, ram, endAddress } = create6800AddressingExample();
  const read = t.mock.method(ram, "read"), write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  const result = runCpu(cpu, { maxSteps: 19, endAddress });
  assert.equal(result.stopReason, "completed");
  assert.deepEqual(result.records, expected);
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments),
    accesses.filter(access => access.kind === "read").map(access => [access.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments),
    [[0x82, 0], [0x83, 0x13], [0x7f, 0xff], [0x0301, 0x12], [0x0303, 0xf0], [0x7e, 0xff]]);
  read.mock.restore();
  write.mock.restore();
  checkMemory(ram, true);
  assert.deepEqual(cpu.snapshot(), { ...initialState(), pc: 0x022c, a: 0xf0, b: 0xff, flags: expectedFlags(8) });
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  const before = cpu.snapshot();
  assert.deepEqual(cpu.step(), { before, after: before, instruction: { address: 0x022c, bytes: [0] },
    accesses: [{ kind: "read", address: 0x022c, value: 0 }], outcome: "unsupported", reason: "opcode" });
});

test("6800 addressing example resumes after carries, borrows, and memory comparison without changing retained records", () => {
  for (const pauseAfter of [4, 9, 16]) {
    const { cpu, ram, endAddress } = create6800AddressingExample();
    const first = runCpu(cpu, { maxSteps: pauseAfter, endAddress });
    const saved = structuredClone(first);
    assert.equal(first.stopReason, "step-limit");
    const resumed = new Cpu6800(ram, cpu.snapshot());
    const rest = runCpu(resumed, { maxSteps: 19 - pauseAfter, endAddress });
    assert.equal(rest.stopReason, "completed");
    assert.deepEqual([...first.records, ...rest.records], expectedRecords());
    checkMemory(ram, true);
    resumed.reset();
    ram.write(0x7f, 0);
    assert.deepEqual(first, saved);
  }
});

test("6800 addressing reset rereads the vector, preserves results and state except PC/I, and a fresh factory restarts", () => {
  const { cpu, ram, endAddress } = create6800AddressingExample();
  runCpu(cpu, { maxSteps: 19, endAddress });
  const before = cpu.snapshot();
  assert.deepEqual(cpu.reset(), { before, after: { ...before, pc: 0x0200, flags: { ...before.flags, i: true } },
    accesses: [{ kind: "read", address: 0xfffe, value: 2 }, { kind: "read", address: 0xffff, value: 0 }] });
  checkMemory(ram, true);
  assert.equal(cpu.step().after.a, 0xff);
  checkMemory(create6800AddressingExample().ram, false);
});

test("editing the 6800 example's addition operand changes the borrow chain and selects the fallback", () => {
  const { cpu, ram, endAddress } = create6800AddressingExample();
  ram.write(0x0203, 2);
  const result = runCpu(cpu, { maxSteps: 20, endAddress });
  assert.equal(result.stopReason, "completed");
  assert.equal(result.records.length, 20);
  assert.ok(result.records.every(record => record.outcome === "executed"));
  assert.deepEqual(result.records.filter(record => record.instruction.address === 0x0225).map(record => record.instruction?.bytes), [[0x86, 0]]);
  assert.deepEqual(cpu.snapshot(), { ...initialState(), pc: 0x022c, a: 0, b: 0xff, flags: expectedFlags(9) });
  assert.deepEqual(result.records.flatMap(record => record.accesses).filter(access => access.kind === "write"), [
    { kind: "write", address: 0x82, value: 1 }, { kind: "write", address: 0x83, value: 0x13 },
    { kind: "write", address: 0x7f, value: 0 }, { kind: "write", address: 0x0301, value: 0x13 },
    { kind: "write", address: 0x0303, value: 0 }, { kind: "write", address: 0x7e, value: 0xff },
  ]);
  checkMemory(ram, true, [[0x0203, 2], [0x82, 1], [0x7f, 0], [0x0301, 0x13], [0x0303, 0]]);
});
