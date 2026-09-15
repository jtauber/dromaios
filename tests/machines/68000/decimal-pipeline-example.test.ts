import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000MemoryAccess } from "../../../src/components/cpus/68000.js";
import { create68000DecimalPipelineExample } from "../../../src/machines/generated/68000/decimal-pipeline-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(): Cpu68000Snapshot {
  return { d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
    d4: 0x01234567, d5: 0x89abcdef, d6: 0xfedcba98, d7: 0x76543210,
    a0: 0xab003000, a1: 0xcd004000, a2: 0xef005000, a3: 0x40000000,
    a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34008000, ssp: 0x56009000,
    pc: 0xab002000, physicalPc: 0x2000, a7: 0x56009000, interruptMask: 2, halted: false,
    flags: { x: true, n: false, z: true, v: true, c: true, t: false, s: true } };
}
const reads = (address: number, bytes: number[]): Cpu68000MemoryAccess[] => bytes.map((value, i) => ({ kind: "read", address: address + i, value }));
const writes = (address: number, bytes: number[], stride = 1): Cpu68000MemoryAccess[] => bytes.map((value, i) => ({ kind: "write", address: address + i * stride, value }));

function expectedRecords(): Cpu68000StepRecord[] {
  let before = initialState();
  const records: Cpu68000StepRecord[] = [];
  function step(bytes: number[], changes: Partial<Cpu68000Snapshot> = {}, codes?: string, data: Cpu68000MemoryAccess[] = []): void {
    const after = { ...before, pc: before.pc + bytes.length, ...changes };
    after.physicalPc = after.pc % 0x1000000;
    if (codes !== undefined) after.flags = { ...after.flags, x: codes[0] === "1", n: codes[1] === "1", z: codes[2] === "1", v: codes[3] === "1", c: codes[4] === "1" };
    after.a7 = after.flags.s ? after.ssp : after.usp;
    records.push({ before, after, instruction: { address: before.pc, bytes }, outcome: after.halted ? "halted" : "executed",
      accesses: [...reads(before.physicalPc, bytes), ...data] });
    before = after;
  }
  step([0x70, 0x45], { d0: 0x45 }, "10000");
  step([0x72, 0x55], { d1: 0x55 }, "10000");
  step([0x44, 0xfc, 0, 4], {}, "00100");
  step([0xc3, 0], { d1: 0 }, "10101");
  step([0xc3, 0], { d1: 0x46 }, "00000");
  step([0x83, 0], { d1: 1 }, "00000");
  step([0x48, 1], { d1: 0x99 }, "10001");
  step([0x48, 0x81], { d1: 0xff99 }, "11000");
  step([0x48, 0xc1], { d1: 0xffffff99 }, "11000");
  step([0xc3, 0xfc, 0, 3], { d1: 0xfffffecb }, "11000");
  step([0x83, 0xfc, 0, 7], { d1: 0xffffffd4 }, "11000");
  step([0x48, 0x41], { d1: 0xffd4ffff }, "11000");
  step([0xc3, 0x42], { d1: 0x99aabbcc, d2: 0xffd4ffff });
  step([0x05, 0xc8, 0, 1], {}, undefined, writes(0x3001, [0xff, 0xd4, 0xff, 0xff], 2));
  step([0x07, 0x08, 0, 1], { d3: 0xddeeffd4 }, undefined, [...reads(0x3001, [0xff]), ...reads(0x3003, [0xd4])]);
  step([0x4a, 0xd1], {}, "10100", [...reads(0x4000, [0]), ...writes(0x4000, [0x80])]);
  step([0x40, 0xc4], { d4: 0x01232214 });
  step([0, 0x3c, 0, 1], {}, "10101");
  step([0x44, 0xfc, 5, 4], {}, "00100");
  step([0x4e, 0x62], { usp: 0xef005000 });
  step([0x4e, 0x6b], { a3: 0xef005000 });
  step([0x46, 0xfc, 0xa3, 4], { interruptMask: 3, flags: { ...before.flags, t: true } });
  step([0x41, 0xbc, 0x7f, 0xff]);
  step([0x4e, 0x71]);
  step([0x4e, 0x77], { pc: 0xab002046, ssp: 0x56009006 }, "00101", reads(0x9000, [0, 5, 0xab, 0, 0x20, 0x46]));
  step([0x4e, 0x72, 0, 0x1f], { halted: true, interruptMask: 0, flags: { ...before.flags, t: false, s: false } }, "11111");
  return records;
}

function checkResult(machine: ReturnType<typeof create68000DecimalPipelineExample>): void {
  assert.equal(machine.endAddress, 0xab00204a);
  assert.deepEqual(machine.cpu.snapshot(), expectedRecords().at(-1)!.after);
  for (const [address, bytes] of [[0x3000, [0x5a, 0xff, 0x5a, 0xd4, 0x5a, 0xff, 0x5a, 0xff, 0x5a]],
    [0x3fff, [0xde, 0x80, 0xad]], [0x8ffe, [0xde, 0xad, 0, 5, 0xab, 0, 0x20, 0x46, 0xbe, 0xef]]] as const) {
    for (const [offset, value] of bytes.entries()) assert.equal(machine.ram.read(address + offset), value);
  }
}

test("68000 decimal pipeline executes complete records through arithmetic, sparse transfers, status, RTR, and STOP", () => {
  const machine = create68000DecimalPipelineExample();
  assert.deepEqual(machine.cpu.snapshot(), initialState());
  const expected = expectedRecords();
  assert.equal(expected.length, 26);
  const run = runCpu(machine.cpu, { maxSteps: 30, endAddress: machine.endAddress });
  assert.deepEqual(run, { stopReason: "halted", records: expected });
  checkResult(machine);
  assert.deepEqual(runCpu(machine.cpu, { maxSteps: 0, endAddress: machine.endAddress }), { stopReason: "completed", records: [] });
  assert.deepEqual(runCpu(machine.cpu, { maxSteps: 1 }), { stopReason: "halted", records: [{ before: expected.at(-1)!.after,
    after: expected.at(-1)!.after, accesses: [], outcome: "halted", instruction: null }] });
});

test("68000 decimal pipeline resumes snapshots at every boundary and retains earlier records", () => {
  const expected = expectedRecords();
  for (let count = 0; count <= expected.length; count++) {
    const machine = create68000DecimalPipelineExample();
    const first = runCpu(machine.cpu, { maxSteps: count });
    const saved = structuredClone(first);
    const restored = new Cpu68000(machine.ram, machine.cpu.snapshot());
    const second = runCpu(restored, { maxSteps: 30, endAddress: machine.endAddress });
    assert.deepEqual([...first.records, ...second.records], expected);
    checkResult({ ...machine, cpu: restored });
    assert.deepEqual(first, saved);
  }
});

test("68000 decimal pipeline retries a live zero divisor without repeating earlier arithmetic", () => {
  const machine = create68000DecimalPipelineExample();
  const expected = expectedRecords();
  assert.deepEqual(runCpu(machine.cpu, { maxSteps: 10 }).records, expected.slice(0, 10));
  const before = machine.cpu.snapshot();
  const divisorByte = before.physicalPc + 3;
  machine.ram.write(divisorByte, 0);
  const failure = runCpu(machine.cpu, { maxSteps: 20 });
  assert.deepEqual(failure, { stopReason: "unsupported", records: [{ before, after: before,
    instruction: { address: before.pc, bytes: [0x83, 0xfc, 0, 0] }, accesses: reads(before.physicalPc, [0x83, 0xfc, 0, 0]),
    outcome: "unsupported", reason: "divide-by-zero" }] });
  machine.ram.write(divisorByte, 7);
  assert.deepEqual(runCpu(machine.cpu, { maxSteps: 20 }).records, expected.slice(10));
  checkResult(machine);
  assert.deepEqual(failure.records[0]!.after, before);
});

test("68000 decimal pipeline reset wakes STOP without restoring RAM; a new factory restores its image", () => {
  const machine = create68000DecimalPipelineExample();
  runCpu(machine.cpu, { maxSteps: 30 });
  const reset = machine.cpu.reset();
  assert.equal(reset.before.halted, true);
  assert.equal(reset.after.halted, false);
  assert.equal(reset.after.pc, 0xab002000);
  assert.equal(reset.after.a7, 0x56009000);
  assert.equal(machine.ram.read(0x4000), 0x80);
  assert.equal(machine.cpu.step().outcome, "executed");
  const fresh = create68000DecimalPipelineExample();
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  assert.equal(fresh.ram.read(0x4000), 0);
  assert.equal(fresh.ram.read(0x3001), 0xcc);
});
