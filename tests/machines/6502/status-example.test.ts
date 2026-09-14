import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../../src/components/cpus/6502.js";
import type { Cpu6502Flags, Cpu6502MemoryAccess, Cpu6502Snapshot, Cpu6502StepRecord } from "../../../src/components/cpus/6502.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create6502StatusExample, create6502StatusExampleMemory } from "../../../src/machines/generated/6502/status-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu6502Snapshot {
  return { a: 0x11, x: 0x22, y: 0x33, sp: 0, pc: 0x0200,
    flags: { n: true, v: false, d: true, i: false, z: true, c: true } };
}

function checkMemory(ram: Ram, finished: boolean): void {
  const expected = new Uint8Array(0x10000);
  expected.set([0xaa, finished ? 0x80 : 0xcc, 0x55], 0x7f);
  expected.set([0x08, 0x20, 0x40, 2, 0x28, 0xf0, 2, 0, 0, 0x8d, 0x80, 0, 0x6c, 0, 0x31], 0x0200);
  expected.set([0x6c, 0xff, 0x30], 0x0240);
  expected.set([0xd8, 0x18, 0xa9, 0x7f, 0x69, 1, 0x60], 0x0260);
  expected[0x3000] = 2;
  expected[0x30ff] = 0x60;
  expected.set([4, 3], 0x3100);
  expected.set([0, 2], 0xfffc);
  if (finished) {
    expected[0x0100] = 0xbb;
    expected.set([3, 2], 0x01fe);
  }
  assert.equal(ram.size, expected.length);
  expected.forEach((value, address) => assert.equal(ram.read(address), value, `RAM ${address}`));
}

function expectedRecords(): readonly Cpu6502StepRecord[] {
  const records: Cpu6502StepRecord[] = [];
  let state = expectedInitialState();
  const append = (bytes: readonly number[], pc: number,
    changes: Partial<Omit<Cpu6502Snapshot, "flags">> & { flags?: Partial<Cpu6502Flags> } = {},
    data: readonly Cpu6502MemoryAccess[] = []) => {
    const before = state;
    state = { ...before, ...changes, pc, flags: { ...before.flags, ...changes.flags } };
    records.push({ before, after: state, instruction: { address: before.pc, bytes }, outcome: "executed",
      accesses: [...bytes.map((value, offset) => ({ kind: "read" as const, address: before.pc + offset, value })), ...data] });
  };
  append([0x08], 0x0201, { sp: 0xff }, [{ kind: "write", address: 0x0100, value: 0xbb }]);
  const beforeCall = state;
  state = { ...state, pc: 0x0240, sp: 0xfd };
  // JSR fetches its high operand after writing the return address.
  records.push({ before: beforeCall, after: state, instruction: { address: 0x0201, bytes: [0x20, 0x40, 2] },
    outcome: "executed", accesses: [
      { kind: "read", address: 0x0201, value: 0x20 }, { kind: "read", address: 0x0202, value: 0x40 },
      { kind: "write", address: 0x01ff, value: 2 }, { kind: "write", address: 0x01fe, value: 3 },
      { kind: "read", address: 0x0203, value: 2 },
    ] });
  append([0x6c, 0xff, 0x30], 0x0260, {}, [
    { kind: "read", address: 0x30ff, value: 0x60 }, { kind: "read", address: 0x3000, value: 2 },
  ]);
  append([0xd8], 0x0261, { flags: { d: false } });
  append([0x18], 0x0262, { flags: { c: false } });
  append([0xa9, 0x7f], 0x0264, { a: 0x7f, flags: { n: false, z: false } });
  append([0x69, 1], 0x0266, { a: 0x80, flags: { n: true, v: true, z: false, c: false } });
  append([0x60], 0x0204, { sp: 0xff }, [
    { kind: "read", address: 0x01fe, value: 3 }, { kind: "read", address: 0x01ff, value: 2 },
  ]);
  append([0x28], 0x0205, { sp: 0, flags: expectedInitialState().flags }, [{ kind: "read", address: 0x0100, value: 0xbb }]);
  append([0xf0, 2], 0x0209);
  append([0x8d, 0x80, 0], 0x020c, {}, [{ kind: "write", address: 0x80, value: 0x80 }]);
  append([0x6c, 0, 0x31], 0x0304, {}, [
    { kind: "read", address: 0x3100, value: 4 }, { kind: "read", address: 0x3101, value: 3 },
  ]);
  return records;
}

test("6502 status factories provide fresh CPU/RAM components and the complete initial image", () => {
  const first = create6502StatusExample();
  assert.deepEqual(first.cpu.snapshot(), expectedInitialState());
  assert.equal(first.endAddress, 0x0304);
  checkMemory(first.ram, false);
  runCpu(first.cpu, { maxSteps: 12, endAddress: first.endAddress });
  const fresh = create6502StatusExample();
  assert.notStrictEqual(fresh.cpu, first.cpu);
  assert.notStrictEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
  const memory = create6502StatusExampleMemory();
  memory.write(0x3000, 0);
  checkMemory(create6502StatusExampleMemory(), false);
});

test("6502 saves status around indirect dispatch and restores flags independently of the result", t => {
  const { cpu, ram, endAddress } = create6502StatusExample();
  const accesses: Cpu6502MemoryAccess[] = [];
  const read = ram.read.bind(ram), write = ram.write.bind(ram);
  t.mock.method(ram, "read", (address: number) => {
    const value = read(address);
    accesses.push({ kind: "read", address, value });
    return value;
  });
  t.mock.method(ram, "write", (address: number, value: number) => {
    write(address, value);
    accesses.push({ kind: "write", address, value });
  });
  const records = expectedRecords();
  assert.equal(records.length, 12);
  assert.deepEqual(runCpu(cpu, { maxSteps: 12, endAddress }), { records, stopReason: "completed" });
  assert.deepEqual(accesses, records.flatMap(record => record.accesses));
  t.mock.restoreAll();
  assert.deepEqual(cpu.snapshot(), { ...expectedInitialState(), a: 0x80, pc: 0x0304 });
  checkMemory(ram, true);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
});

test("6502 status and return frames resume from RAM and snapshots and survive reset as data", () => {
  for (const pauseAfter of [1, 2, 3, 7, 8, 9]) {
    const { cpu, ram, endAddress } = create6502StatusExample();
    const first = runCpu(cpu, { maxSteps: pauseAfter, endAddress });
    const saved = structuredClone(first);
    assert.equal(first.stopReason, "step-limit");
    const resumed = new Cpu6502(ram, cpu.snapshot());
    const rest = runCpu(resumed, { maxSteps: 12 - pauseAfter, endAddress });
    assert.equal(rest.stopReason, "completed");
    assert.deepEqual([...first.records, ...rest.records], expectedRecords());
    const before = resumed.snapshot();
    assert.deepEqual(resumed.reset(), { before,
      after: { ...before, pc: 0x0200, sp: 0xfd, flags: { ...before.flags, i: true } },
      accesses: [{ kind: "read", address: 0xfffc, value: 0 }, { kind: "read", address: 0xfffd, value: 2 }] });
    checkMemory(ram, true);
    ram.write(0x0100, 0);
    ram.write(0x30ff, 0);
    assert.deepEqual(first, saved);
  }
});

test("6502 indirect dispatch uses an edited pointer and rejects ADC when the new entry skips CLD", () => {
  const { cpu, ram, endAddress } = create6502StatusExample();
  runCpu(cpu, { maxSteps: 2, endAddress });
  ram.write(0x30ff, 0x61);
  const run = runCpu(cpu, { maxSteps: 5, endAddress });
  assert.equal(run.stopReason, "unsupported");
  assert.deepEqual(run.records.map(record => record.instruction.address), [0x0240, 0x0261, 0x0262, 0x0264]);
  const last = run.records.at(-1)!;
  assert.equal(last.outcome, "unsupported");
  if (last.outcome === "unsupported") assert.equal(last.reason, "decimal-mode");
  assert.deepEqual(last.instruction.bytes, [0x69]);
  assert.deepEqual(last.accesses, [{ kind: "read", address: 0x0264, value: 0x69 }]);
  assert.equal(cpu.snapshot().sp, 0xfd);
  assert.equal(ram.read(0x0100), 0xbb);
  assert.equal(ram.read(0x80), 0xcc);
});
