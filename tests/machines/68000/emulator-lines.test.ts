import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import { create68000Example } from "../../../src/machines/generated/68000/example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

test("68000 runner handles illegal, line-A, and line-F words through saved-PC edits and RTE", () => {
  const { cpu: initial, ram } = create68000Example();
  const before = { ...initial.snapshot(), pc: 0xab001000, physicalPc: 0x1000,
    flags: { x: true, n: true, z: true, v: true, c: true, s: false, t: false } };
  // Three faulting words, then MOVEQ #42,D0. Each handler advances the stacked PC by two.
  for (const [address, bytes] of [
    [0x1000, [0x4a, 0xfa, 0xa1, 0x23, 0xf4, 0x56, 0x70, 0x2a]],
    [16, [0xcd, 0, 0x20, 0]], [40, [0xef, 0, 0x30, 0]], [44, [0x12, 0, 0x40, 0]],
  ] as const) bytes.forEach((b, i) => ram.write(address + i, b));
  for (const address of [0x2000, 0x3000, 0x4000]) {
    // ADDQ.L #2,2(A7); RTE. The saved PC starts two bytes above SR in the six-byte frame.
    [0x54, 0xaf, 0, 2, 0x4e, 0x73].forEach((b, i) => ram.write(address + i, b));
  }
  let cpu = new Cpu68000(ram, before);
  const records = [];
  const boundaries = [0xcd002000, 0xcd002004, 0xab001002, 0xef003000, 0xef003004,
    0xab001004, 0x12004000, 0x12004004, 0xab001006, 0xab001008];
  for (const [index, pc] of boundaries.entries()) {
    const run = runCpu(cpu, { maxSteps: 1, endAddress: 0xab001008 });
    assert.equal(run.stopReason, index === boundaries.length - 1 ? "completed" : "step-limit");
    const record = run.records[0]!;
    assert.equal(record.outcome, "executed");
    assert.equal(record.after.pc, pc);
    assert.equal(record.after.tracePending, false);
    if (index < 9 && index % 3 === 2) {
      assert.equal(record.after.ssp, before.ssp);
      assert.equal(record.after.a7, before.usp);
      assert.deepEqual(record.after.flags, before.flags);
    }
    records.push(record);
    cpu = new Cpu68000(ram, cpu.snapshot());
  }
  assert.deepEqual(records.filter(record => record.exception).map(record => record.exception), [
    { source: "illegal-instruction", vector: 4, returnPc: 0xab001000 },
    { source: "line-a", vector: 10, returnPc: 0xab001002 },
    { source: "line-f", vector: 11, returnPc: 0xab001004 },
  ]);
  assert.deepEqual(cpu.snapshot(), { ...before, pc: 0xab001008, physicalPc: 0x1008, a7: before.usp, d0: 42,
    flags: { ...before.flags, n: false, z: false, v: false, c: false } });
  const saved = structuredClone(records);
  cpu.reset();
  assert.deepEqual(records, saved);
});
