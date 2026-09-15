import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../src/components/cpus/z80.js";
import type { CpuZ80Flags, CpuZ80MemoryAccess, CpuZ80Snapshot, CpuZ80StepRecord } from "../../../src/components/cpus/z80.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { createZ80BitCountExample, createZ80BitCountExampleMemory } from "../../../src/machines/generated/z80/bit-count-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(): CpuZ80Snapshot {
  return {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    bc: 0x2233, de: 0x4455, hl: 0x6677,
    flags: { s: true, z: true, h: true, pv: true, n: true, c: true },
    alternate: { a: 0x88, b: 0x99, c: 0xaa, d: 0xbb, e: 0xcc, h: 0xdd, l: 0xee,
      bc: 0x99aa, de: 0xbbcc, hl: 0xddee, flags: { s: false, z: true, h: false, pv: true, n: false, c: true } },
    ix: 0x1234, iy: 0x5678, pc: 0x200, sp: 0xabcd, i: 0x42, r: 0xfe,
    interruptDeferred: false, nmiDeferred: false, iff1: true, iff2: false, im: 2, halted: false,
  };
}

function checkMemory(ram: Ram, finished: boolean): void {
  const expected = new Uint8Array(65536);
  expected.set([0xaa, 0x81, 0x7f, 0xa5, 0xbb, finished ? 0x0d : 0xcc, 0x55], 0x7f);
  expected.set([0x31, 0, 0x90, 0xcd, 0x20, 2, 0x76], 0x200);
  expected.set([0xf5, 0xc5, 0xd5, 0xe5, 0x21, 0x80, 0, 0x06, 3, 0x16, 0, 0x7e, 0xcd, 0x40, 2,
    0x7a, 0x83, 0x57, 0x2c, 0x10, 0xf6, 0x7a, 0x32, 0x84, 0, 0xe1, 0xd1, 0xc1, 0xf1, 0xc9], 0x220);
  expected.set([0xc5, 0x06, 8, 0x1e, 0, 0xcb, 0x3f, 0xdc, 0x50, 2, 0x10, 0xf9, 0xc1, 0xc9], 0x240);
  expected.set([0x1c, 0xc9], 0x250);
  expected[0x8fef] = 0xaa;
  expected[0x9000] = 0xbb;
  if (finished) expected.set([0x4a, 2, 0x33, 1, 0x2f, 2, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0xd7, 0x11, 6, 2], 0x8ff0);
  expected.forEach((value, address) => assert.equal(ram.read(address), value, `RAM ${address.toString(16)}`));
}

function expectedRecords(): readonly CpuZ80StepRecord[] {
  const records: CpuZ80StepRecord[] = [];
  let state = initialState();
  const clear: CpuZ80Flags = { s: false, z: false, h: false, pv: false, n: false, c: false };
  const append = (bytes: readonly number[], changes: Partial<CpuZ80Snapshot> = {}, data: readonly CpuZ80MemoryAccess[] = []) => {
    const before = state;
    state = { ...state, pc: state.pc + bytes.length, r: 0x80 + (state.r + (bytes[0] === 0xcb ? 2 : 1)) % 128, ...changes };
    records.push({ before, after: state, outcome: state.halted ? "halted" : "executed",
      instruction: { address: before.pc, bytes }, accesses: [
        ...bytes.map((value, offset): CpuZ80MemoryAccess => ({ kind: "read", address: before.pc + offset, value })), ...data,
      ] });
  };
  const push = (bytes: readonly number[], low: number, high: number, changes: Partial<CpuZ80Snapshot> = {}) => {
    append(bytes, { sp: state.sp - 2, ...changes }, [
      { kind: "write", address: state.sp - 1, value: high }, { kind: "write", address: state.sp - 2, value: low },
    ]);
  };
  const pop = (opcode: number, low: number, high: number, changes: Partial<CpuZ80Snapshot>) => {
    append([opcode], { sp: state.sp + 2, ...changes }, [
      { kind: "read", address: state.sp, value: low }, { kind: "read", address: state.sp + 1, value: high },
    ]);
  };
  append([0x31, 0, 0x90], { sp: 0x9000 });
  push([0xcd, 0x20, 2], 6, 2, { pc: 0x220 });
  push([0xf5], 0xd7, 0x11);
  push([0xc5], 0x33, 0x22);
  push([0xd5], 0x55, 0x44);
  push([0xe5], 0x77, 0x66);
  append([0x21, 0x80, 0], { h: 0, l: 0x80, hl: 0x80 });
  append([0x06, 3], { b: 3, bc: 0x0333 });
  append([0x16, 0], { d: 0, de: 0x0055 });
  // Independently listed SRL results and outgoing bits for 81, 7F, A5.
  const rows = [
    { input: 0x81, results: [0x40, 0x20, 0x10, 8, 4, 2, 1, 0], carries: "10000001", total: 2 },
    { input: 0x7f, results: [0x3f, 0x1f, 0x0f, 7, 3, 1, 0, 0], carries: "11111110", total: 9 },
    { input: 0xa5, results: [0x52, 0x29, 0x14, 0x0a, 5, 2, 1, 0], carries: "10100101", total: 13 },
  ];
  for (const [index, row] of rows.entries()) {
    append([0x7e], { a: row.input }, [{ kind: "read", address: 0x80 + index, value: row.input }]);
    push([0xcd, 0x40, 2], 0x2f, 2, { pc: 0x240 });
    push([0xc5], 0x33, 3 - index);
    append([0x06, 8], { b: 8, bc: 0x0833 });
    append([0x1e, 0], { e: 0, de: state.d * 256 });
    let count = 0;
    for (const [bit, result] of row.results.entries()) {
      const carry = row.carries[bit] === "1";
      const parity = result.toString(2).split("1").length % 2 === 1;
      append([0xcb, 0x3f], { a: result, flags: { ...clear, z: result === 0, pv: parity, c: carry } });
      if (carry) {
        push([0xdc, 0x50, 2], 0x4a, 2, { pc: 0x250 });
        count++;
        append([0x1c], { e: count, de: state.d * 256 + count, flags: { ...clear, c: true } });
        pop(0xc9, 0x4a, 2, { pc: 0x24a });
      } else append([0xdc, 0x50, 2]);
      append([0x10, 0xf9], { b: 7 - bit, bc: (7 - bit) * 256 + 0x33, pc: bit === 7 ? 0x24c : 0x245 });
    }
    pop(0xc1, 0x33, 3 - index, { b: 3 - index, bc: (3 - index) * 256 + 0x33 });
    pop(0xc9, 0x2f, 2, { pc: 0x22f });
    append([0x7a], { a: state.d });
    append([0x83], { a: row.total, flags: clear });
    append([0x57], { d: row.total, de: row.total * 256 + count });
    append([0x2c], { l: 0x81 + index, hl: 0x81 + index, flags: { ...clear, s: true } });
    append([0x10, 0xf6], { b: 2 - index, bc: (2 - index) * 256 + 0x33, pc: index === 2 ? 0x235 : 0x22b });
  }
  append([0x7a], { a: 13 });
  append([0x32, 0x84, 0], {}, [{ kind: "write", address: 0x84, value: 13 }]);
  pop(0xe1, 0x77, 0x66, { h: 0x66, l: 0x77, hl: 0x6677 });
  pop(0xd1, 0x55, 0x44, { d: 0x44, e: 0x55, de: 0x4455 });
  pop(0xc1, 0x33, 0x22, { b: 0x22, c: 0x33, bc: 0x2233 });
  pop(0xf1, 0xd7, 0x11, { a: 0x11, flags: initialState().flags });
  pop(0xc9, 6, 2, { pc: 0x206 });
  append([0x76], { halted: true });
  return records;
}

test("Z80 bit-count example preserves registers across three call levels and checks all records and RAM accesses", t => {
  const { cpu, ram } = createZ80BitCountExample();
  assert.deepEqual(cpu.snapshot(), initialState());
  checkMemory(ram, false);
  const accesses: CpuZ80MemoryAccess[] = [];
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
  assert.equal(records.length, 151);
  assert.deepEqual(runCpu(cpu, { maxSteps: 151 }), { records, stopReason: "halted" });
  assert.deepEqual(accesses, records.flatMap(record => record.accesses));
  assert.deepEqual(cpu.snapshot(), { ...initialState(), pc: 0x207, sp: 0x9000, r: 0xad, halted: true });
  assert.equal(Math.min(...records.map(record => record.after.sp)), 0x8ff0);
  const final = cpu.snapshot();
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
  assert.deepEqual(accesses, records.flatMap(record => record.accesses));
  t.mock.restoreAll();
  checkMemory(ram, true);
});

test("Z80 bit-count example resumes from every instruction boundary and retains records across reset and RAM edits", () => {
  const records = expectedRecords();
  for (let pauseAfter = 1; pauseAfter < records.length; pauseAfter++) {
    const { cpu, ram } = createZ80BitCountExample();
    const first = runCpu(cpu, { maxSteps: pauseAfter });
    const saved = structuredClone(first);
    assert.equal(first.stopReason, "step-limit");
    const resumed = new CpuZ80(ram, cpu.snapshot());
    const rest = runCpu(resumed, { maxSteps: records.length - pauseAfter });
    assert.deepEqual([...first.records, ...rest.records], records);
    assert.equal(rest.stopReason, "halted");
    const final = resumed.snapshot();
    assert.deepEqual(resumed.reset(), { before: final, after: { ...final, pc: 0, i: 0, r: 0,
      interruptDeferred: false, nmiDeferred: false, iff1: false, iff2: false, im: 0, halted: false }, accesses: [] });
    assert.equal(ram.read(0x84), 13);
    ram.write(0x8ffe, 0);
    assert.deepEqual(first, saved);
  }
});

test("Z80 bit-count factories restart with fresh state and memory; zero and full bytes exercise both conditional paths", () => {
  const used = createZ80BitCountExample();
  runCpu(used.cpu, { maxSteps: 151 });
  const fresh = createZ80BitCountExample();
  assert.notStrictEqual(fresh.ram, used.ram);
  assert.notStrictEqual(fresh.cpu, used.cpu);
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  checkMemory(fresh.ram, false);
  const memory = createZ80BitCountExampleMemory();
  memory.write(0x80, 0);
  checkMemory(createZ80BitCountExampleMemory(), false);
  for (const [value, result, steps] of [[0, 0, 125], [0xff, 24, 173]] as const) {
    const { cpu, ram } = createZ80BitCountExample();
    for (const address of [0x80, 0x81, 0x82]) ram.write(address, value);
    const run = runCpu(cpu, { maxSteps: steps });
    assert.equal(run.stopReason, "halted");
    assert.equal(run.records.length, steps);
    assert.equal(ram.read(0x84), result);
    assert.equal(ram.read(0x8fef), 0xaa);
    assert.equal(ram.read(0x9000), 0xbb);
    assert.deepEqual(cpu.snapshot().flags, initialState().flags);
    assert.equal(cpu.snapshot().sp, 0x9000);
  }
});
