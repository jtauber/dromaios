import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../../src/components/cpus/6502.js";
import type { Cpu6502Flags, Cpu6502MemoryAccess, Cpu6502Snapshot, Cpu6502StepRecord } from "../../../src/components/cpus/6502.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create6502DecimalExample, create6502DecimalExampleMemory } from "../../../src/machines/generated/6502/decimal-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu6502Snapshot {
  return { a: 0x11, x: 0x22, y: 0x33, sp: 0xff, pc: 0x0200,
    flags: { n: false, v: true, d: false, i: false, z: true, c: true } };
}

function checkMemory(ram: Ram, finished: boolean): void {
  const expected = new Uint8Array(0x10000);
  expected.set([0xaa, 0x99, 0x99, 1, 0, ...(finished ? [0, 0, 0x99, 0x99] : [0xcc, 0xcc, 0xcc, 0xcc]), 0x55], 0x7f);
  expected.set([0xf8, 0x18, 0xa5, 0x80, 0x65, 0x82, 0x85, 0x84, 0xa5, 0x81, 0x65, 0x83, 0x85, 0x85,
    0x38, 0xa5, 0x84, 0xe5, 0x82, 0x85, 0x86, 0xa5, 0x85, 0xe5, 0x83, 0x85, 0x87, 0xd8], 0x0200);
  expected.set([0, 2], 0xfffc);
  assert.equal(ram.size, expected.length);
  expected.forEach((value, address) => assert.equal(ram.read(address), value, `RAM ${address}`));
}

function expectedRecords(): readonly Cpu6502StepRecord[] {
  const records: Cpu6502StepRecord[] = [];
  let state = expectedInitialState();
  const append = (bytes: readonly number[], a: number, flags: Partial<Cpu6502Flags> = {},
    data: readonly Cpu6502MemoryAccess[] = []) => {
    const before = state;
    state = { ...before, a, pc: before.pc + bytes.length, flags: { ...before.flags, ...flags } };
    records.push({ before, after: state, instruction: { address: before.pc, bytes }, outcome: "executed",
      accesses: [...bytes.map((value, offset) => ({ kind: "read" as const, address: before.pc + offset, value })), ...data] });
  };
  append([0xf8], 0x11, { d: true });
  append([0x18], 0x11, { c: false });
  append([0xa5, 0x80], 0x99, { n: true, z: false }, [{ kind: "read", address: 0x80, value: 0x99 }]);
  // NMOS ADC leaves Z clear and N set despite the corrected accumulator being zero.
  append([0x65, 0x82], 0, { v: false, c: true }, [{ kind: "read", address: 0x82, value: 1 }]);
  append([0x85, 0x84], 0, {}, [{ kind: "write", address: 0x84, value: 0 }]);
  append([0xa5, 0x81], 0x99, {}, [{ kind: "read", address: 0x81, value: 0x99 }]);
  append([0x65, 0x83], 0, {}, [{ kind: "read", address: 0x83, value: 0 }]);
  append([0x85, 0x85], 0, {}, [{ kind: "write", address: 0x85, value: 0 }]);
  append([0x38], 0);
  append([0xa5, 0x84], 0, { n: false, z: true }, [{ kind: "read", address: 0x84, value: 0 }]);
  append([0xe5, 0x82], 0x99, { n: true, z: false, c: false }, [{ kind: "read", address: 0x82, value: 1 }]);
  append([0x85, 0x86], 0x99, {}, [{ kind: "write", address: 0x86, value: 0x99 }]);
  append([0xa5, 0x85], 0, { n: false, z: true }, [{ kind: "read", address: 0x85, value: 0 }]);
  append([0xe5, 0x83], 0x99, { n: true, z: false }, [{ kind: "read", address: 0x83, value: 0 }]);
  append([0x85, 0x87], 0x99, {}, [{ kind: "write", address: 0x87, value: 0x99 }]);
  append([0xd8], 0x99, { d: false });
  return records;
}

test("6502 decimal factories provide independent components and the complete initial image", () => {
  const first = create6502DecimalExample();
  assert.deepEqual(first.cpu.snapshot(), expectedInitialState());
  assert.equal(first.endAddress, 0x021c);
  checkMemory(first.ram, false);
  runCpu(first.cpu, { maxSteps: 16, endAddress: first.endAddress });
  const fresh = create6502DecimalExample();
  assert.notStrictEqual(fresh.cpu, first.cpu);
  assert.notStrictEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
  const memory = create6502DecimalExampleMemory();
  memory.write(0x80, 0);
  checkMemory(create6502DecimalExampleMemory(), false);
});

test("6502 decimal arithmetic propagates carry and borrow across two bytes with complete records", t => {
  const { cpu, ram, endAddress } = create6502DecimalExample();
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
  assert.equal(records.length, 16);
  assert.deepEqual(runCpu(cpu, { maxSteps: 16, endAddress }), { records, stopReason: "completed" });
  assert.deepEqual(accesses, records.flatMap(record => record.accesses));
  t.mock.restoreAll();
  checkMemory(ram, true);
  assert.deepEqual(cpu.snapshot(), records.at(-1)!.after);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
});

test("6502 decimal carry and borrow survive snapshot resumption between bytes", () => {
  for (const pauseAfter of [1, 4, 6, 8, 11, 13, 15]) {
    const { cpu, ram, endAddress } = create6502DecimalExample();
    const first = runCpu(cpu, { maxSteps: pauseAfter, endAddress });
    const saved = structuredClone(first);
    assert.equal(first.stopReason, "step-limit");
    const resumed = new Cpu6502(ram, cpu.snapshot());
    const rest = runCpu(resumed, { maxSteps: 16 - pauseAfter, endAddress });
    assert.equal(rest.stopReason, "completed");
    assert.deepEqual([...first.records, ...rest.records], expectedRecords());
    checkMemory(ram, true);
    resumed.reset();
    ram.write(0x84, 0xff);
    assert.deepEqual(first, saved);
  }
});
