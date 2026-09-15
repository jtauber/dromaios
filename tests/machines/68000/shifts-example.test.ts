import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000MemoryAccess } from "../../../src/components/cpus/68000.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create68000ShiftsExample, create68000ShiftsExampleMemory } from "../../../src/machines/generated/68000/shifts-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(supervisor = false): Cpu68000Snapshot {
  return { d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
    d4: 0x01234567, d5: 0x89abcdef, d6: 0xfedcba98, d7: 0x76543210,
    a0: 0x10000000, a1: 0x20000000, a2: 0x30000000, a3: 0x40000000,
    a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34008000, ssp: 0x56009000,
    pc: 0xab002000, a7: supervisor ? 0x56009000 : 0x34008000, physicalPc: 0x2000, halted: false, interruptMask: supervisor ? 7 : 2,
    flags: { x: true, n: false, z: true, v: true, c: true, t: false, s: supervisor } };
}
const read = (address: number, ...bytes: number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "read", address: address + offset, value }));
const write = (address: number, ...bytes: number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "write", address: address + offset, value }));
const word = (value: number): number[] => [Math.floor(value / 256), value % 256];
const program = [0x41, 0xf9, 0xab, 0, 0x30, 0, 0x43, 0xf9, 0xcd, 0, 0x40, 0, 0x7e, 1,
  0x30, 0x18, 0xe1, 0x58, 0x72, 0, 0x12, 0, 0xe0, 0x58, 0xe1, 0x48, 0xe0, 0x40,
  0xe3, 0x40, 0x32, 0xc0, 0xe2, 9, 0x32, 0xc1, 0x51, 0xcf, 0xff, 0xe8,
  0x45, 0xf9, 0xef, 0, 0x60, 2, 0xe3, 0xd2, 0xe5, 0xe2, 0xe2, 0xda, 0xe4, 0xd2];

function expectedRecords(supervisor = false): Cpu68000StepRecord[] {
  let before = initialState(supervisor);
  const records: Cpu68000StepRecord[] = [];
  function step(bytes: number[], nextPc: number, changes: Partial<Cpu68000Snapshot> = {}, condition?: string,
    data: Cpu68000MemoryAccess[] = []): void {
    const flags = condition === undefined ? { ...before.flags } : { ...before.flags,
      x: condition[0] === "1", n: condition[1] === "1", z: condition[2] === "1", v: condition[3] === "1", c: condition[4] === "1" };
    const after = { ...before, ...changes, flags, pc: 0xab000000 + nextPc, physicalPc: nextPc };
    records.push({ before, after, outcome: "executed", instruction: { address: before.pc, bytes },
      accesses: [...read(before.physicalPc, ...bytes), ...data] });
    before = after;
  }
  step([0x41, 0xf9, 0xab, 0, 0x30, 0], 0x2006, { a0: 0xab003000 });
  step([0x43, 0xf9, 0xcd, 0, 0x40, 0], 0x200c, { a1: 0xcd004000 });
  step([0x7e, 1], 0x200e, { d7: 1 }, "10000");
  const samples = [
    { packed: 0x8180, rotated: 0x8081, tag: 0x81, high: 0x8000, signed: 0xff80, doubled: 0xff00, shiftedTag: 0x40,
      loadedFlags: "11000", rotatedFlags: "11001", tagFlags: "11000", shiftedFlags: "11001", signedFlags: "01000", doubledFlags: "11001", storedFlags: "11000", tagShiftFlags: "10001", finalFlags: "10000" },
    { packed: 0x1234, rotated: 0x3412, tag: 0x12, high: 0x3400, signed: 0x0034, doubled: 0x0068, shiftedTag: 9,
      loadedFlags: "10000", rotatedFlags: "10000", tagFlags: "10000", shiftedFlags: "00000", signedFlags: "00000", doubledFlags: "00000", storedFlags: "00000", tagShiftFlags: "00000", finalFlags: "00000" },
  ];
  for (const [index, row] of samples.entries()) {
    const output = 0x4000 + index * 4;
    step([0x30, 0x18], 0x2010, { d0: 0x11220000 + row.packed, a0: 0xab003002 + index * 2 }, row.loadedFlags, read(0x3000 + index * 2, ...word(row.packed)));
    step([0xe1, 0x58], 0x2012, { d0: 0x11220000 + row.rotated }, row.rotatedFlags);
    step([0x72, 0], 0x2014, { d1: 0 }, "10100");
    step([0x12, 0], 0x2016, { d1: row.tag }, row.tagFlags);
    step([0xe0, 0x58], 0x2018, { d0: 0x11220000 + row.packed }, row.rotatedFlags);
    step([0xe1, 0x48], 0x201a, { d0: 0x11220000 + row.high }, row.shiftedFlags);
    step([0xe0, 0x40], 0x201c, { d0: 0x11220000 + row.signed }, row.signedFlags);
    step([0xe3, 0x40], 0x201e, { d0: 0x11220000 + row.doubled }, row.doubledFlags);
    step([0x32, 0xc0], 0x2020, { a1: 0xcd000000 + output + 2 }, row.storedFlags, write(output, ...word(row.doubled)));
    step([0xe2, 9], 0x2022, { d1: row.shiftedTag }, row.tagShiftFlags);
    step([0x32, 0xc1], 0x2024, { a1: 0xcd000000 + output + 4 }, row.finalFlags, write(output + 2, ...word(row.shiftedTag)));
    step([0x51, 0xcf, 0xff, 0xe8], index === 0 ? 0x200e : 0x2028, { d7: index === 0 ? 0 : 0xffff });
  }
  step([0x45, 0xf9, 0xef, 0, 0x60, 2], 0x202e, { a2: 0xef006002 });
  step([0xe3, 0xd2], 0x2030, {}, "10001", [...read(0x6002, 0x80, 1), ...write(0x6002, 0, 2)]);
  step([0xe5, 0xe2], 0x2032, { a2: 0xef006000 }, "01000", [...read(0x6000, 0x40, 1), ...write(0x6000, 0x80, 3)]);
  step([0xe2, 0xda], 0x2034, { a2: 0xef006002 }, "10001", [...read(0x6000, 0x80, 3), ...write(0x6000, 0x40, 1)]);
  step([0xe4, 0xd2], 0x2036, {}, "01000", [...read(0x6002, 0, 2), ...write(0x6002, 0x80, 1)]);
  return records;
}

function checkMemory(ram: Ram, finished = false): void {
  const expected = new Uint8Array(0x1000000);
  expected.set([0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0]);
  expected.set(program, 0x2000);
  expected.set([0xde, 0xad, 0x81, 0x80, 0x12, 0x34, 0xbe, 0xef], 0x2ffe);
  expected.set([0xde, 0xad, ...(finished ? [0xff, 0, 0, 0x40, 0, 0x68, 0, 9] : Array(8).fill(0xcc)), 0xbe, 0xef], 0x3ffe);
  expected.set([0xde, 0xad, 0x40, 1, 0x80, 1, 0xbe, 0xef], 0x5ffe);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

test("68000 shifts factories own their state and RAM and expose the logical endpoint", () => {
  const first = create68000ShiftsExample();
  const second = create68000ShiftsExample();
  const memory = create68000ShiftsExampleMemory();
  assert.deepEqual(first.cpu.snapshot(), initialState());
  assert.equal(first.endAddress, 0xab002036);
  checkMemory(first.ram);
  checkMemory(memory);
  first.cpu.step();
  first.ram.write(0x3000, 0xff);
  memory.write(0x4000, 0);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  assert.equal(second.ram.read(0x3000), 0x81);
  assert.equal(second.ram.read(0x4000), 0xcc);
});

test("68000 shifts example uses all eight operations in 32 exact records in either processor mode", t => {
  for (const supervisor of [false, true]) {
    const { cpu, ram, endAddress } = create68000ShiftsExample();
    if (supervisor) assert.deepEqual(cpu.reset(), { before: initialState(), after: initialState(true),
      accesses: read(0, 0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0) });
    const reads = t.mock.method(ram, "read");
    const writes = t.mock.method(ram, "write");
    const records = expectedRecords(supervisor);
    assert.equal(records.length, 32);
    assert.deepEqual(runCpu(cpu, { maxSteps: 32, endAddress }), { stopReason: "completed", records });
    const accesses = records.flatMap(record => record.accesses);
    assert.deepEqual(reads.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "read").map(a => [a.address]));
    assert.deepEqual(writes.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "write").map(a => [a.address, a.value]));
    assert.deepEqual(cpu.snapshot(), records[31]!.after);
    assert.equal(runCpu(cpu, { maxSteps: 0, endAddress }).stopReason, "completed");
    assert.equal(runCpu(cpu, { maxSteps: 0, endAddress: 0x2036 }).stopReason, "step-limit");
    t.mock.restoreAll();
    checkMemory(ram, true);
  }
});

test("68000 shifts example resumes between memory words using the saved X and current RAM", () => {
  const { cpu, ram, endAddress } = create68000ShiftsExample();
  const records = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 29, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { stopReason: "step-limit", records: records.slice(0, 29) });
  assert.equal(cpu.snapshot().flags.x, true);
  const restoredRam = create68000ShiftsExampleMemory();
  for (const access of first.records.flatMap(record => record.accesses)) {
    if (access.kind === "write") restoredRam.write(access.address, access.value);
  }
  const restored = new Cpu68000(restoredRam, cpu.snapshot());
  for (const running of [cpu, restored]) {
    assert.deepEqual(runCpu(running, { maxSteps: 3, endAddress }), { stopReason: "completed", records: records.slice(29) });
  }
  cpu.reset();
  assert.deepEqual(first, saved);
  assert.equal(ram.read(0x6000), restoredRam.read(0x6000));
});

test("68000 shifts example consumes live samples and wide values and preserves results on reset", () => {
  const { cpu, ram, endAddress } = create68000ShiftsExample();
  ram.write(0x3001, 0x7f); // +127 doubles to +254 instead of -256.
  for (let address = 0x6000; address < 0x6004; address++) ram.write(address, 0);
  assert.equal(runCpu(cpu, { maxSteps: 32, endAddress }).stopReason, "completed");
  assert.deepEqual([ram.read(0x4000), ram.read(0x4001)], [0, 0xfe]);
  assert.equal(cpu.snapshot().flags.z, true);
  assert.equal(cpu.snapshot().flags.x, false);
  const finished = cpu.snapshot();
  cpu.reset();
  assert.equal(cpu.snapshot().pc, 0xab002000);
  assert.equal(cpu.snapshot().d0, finished.d0);
  assert.equal(ram.read(0x4001), 0xfe);
  assert.equal(ram.read(0x6003), 0);
});
