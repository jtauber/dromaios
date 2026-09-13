import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu8080MemoryAccess, Cpu8080Snapshot, Cpu8080StepRecord } from "../../../src/components/cpus/8080.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create8080CountedLoopExample,
  create8080CountedLoopExampleMemory,
} from "../../../src/machines/generated/8080/counted-loop-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu8080Snapshot {
  return {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    bc: 0x2233, de: 0x4455, hl: 0x6677, pc: 0x0200, sp: 0xabcd,
    flags: { s: true, z: false, ac: true, p: false, cy: true },
    interruptEnabled: false, halted: false,
  };
}

function checkMemory(ram: Ram, finished: boolean): void {
  const expected = new Uint8Array(0x10000);
  // Literal image from the specification, independent of the generated factory.
  expected.set([
    0x21, 0xff, 0xff, 0x11, 0x01, 0x00, 0x06, 0x03, 0x34, 0x19,
    0x05, 0xc2, 0x08, 0x02, 0x2b, 0x22, 0x80, 0x00, 0x76,
  ], 0x0200);
  expected[0xffff] = finished ? 0 : 0xff;
  expected.set(finished ? [0x10, 0x80] : [0x0f, 0x7f], 0);
  if (finished) expected[0x80] = 1;
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu8080StepRecord[] {
  const steps: readonly {
    bytes: readonly number[]; changes: Partial<Cpu8080Snapshot>; data?: readonly Cpu8080MemoryAccess[];
  }[] = [
    { bytes: [0x21, 0xff, 0xff], changes: { pc: 0x0203, h: 0xff, l: 0xff, hl: 0xffff } },
    { bytes: [0x11, 1, 0], changes: { pc: 0x0206, d: 0, e: 1, de: 1 } },
    { bytes: [0x06, 3], changes: { pc: 0x0208, b: 3, bc: 0x0333 } },
    { bytes: [0x34], changes: { pc: 0x0209,
      flags: { s: false, z: true, ac: true, p: true, cy: true } },
      data: [{ kind: "read", address: 0xffff, value: 0xff }, { kind: "write", address: 0xffff, value: 0 }] },
    { bytes: [0x19], changes: { pc: 0x020a, h: 0, l: 0, hl: 0 } },
    { bytes: [0x05], changes: { pc: 0x020b, b: 2, bc: 0x0233,
      flags: { s: false, z: false, ac: true, p: false, cy: true } } },
    { bytes: [0xc2, 0x08, 0x02], changes: { pc: 0x0208 } },
    { bytes: [0x34], changes: { pc: 0x0209 },
      data: [{ kind: "read", address: 0, value: 0x0f }, { kind: "write", address: 0, value: 0x10 }] },
    { bytes: [0x19], changes: { pc: 0x020a, l: 1, hl: 1,
      flags: { s: false, z: false, ac: true, p: false, cy: false } } },
    { bytes: [0x05], changes: { pc: 0x020b, b: 1, bc: 0x0133 } },
    { bytes: [0xc2, 0x08, 0x02], changes: { pc: 0x0208 } },
    { bytes: [0x34], changes: { pc: 0x0209,
      flags: { s: true, z: false, ac: true, p: false, cy: false } },
      data: [{ kind: "read", address: 1, value: 0x7f }, { kind: "write", address: 1, value: 0x80 }] },
    { bytes: [0x19], changes: { pc: 0x020a, l: 2, hl: 2 } },
    { bytes: [0x05], changes: { pc: 0x020b, b: 0, bc: 0x0033,
      flags: { s: false, z: true, ac: true, p: true, cy: false } } },
    { bytes: [0xc2, 0x08, 0x02], changes: { pc: 0x020e } },
    { bytes: [0x2b], changes: { pc: 0x020f, l: 1, hl: 1 } },
    { bytes: [0x22, 0x80, 0], changes: { pc: 0x0212 },
      data: [{ kind: "write", address: 0x80, value: 1 }, { kind: "write", address: 0x81, value: 0 }] },
    { bytes: [0x76], changes: { pc: 0x0213, halted: true } },
  ];
  let state = expectedInitialState();
  return steps.map(({ bytes, changes, data = [] }) => {
    const before = state;
    state = { ...before, ...changes };
    return {
      instruction: { address: before.pc, bytes }, before, after: state,
      accesses: [...bytes.map((value, offset): Cpu8080MemoryAccess => ({
        kind: "read", address: before.pc + offset, value,
      })), ...data],
      outcome: state.halted ? "halted" : "executed",
    };
  });
}

test("the 8080 counted-loop example creates independent code and boundary-spanning data", () => {
  const first = create8080CountedLoopExampleMemory();
  checkMemory(first, false);
  first.write(0x0200, 0);
  first.write(0xffff, 0);
  first.write(0, 0);
  const second = create8080CountedLoopExampleMemory();
  assert.notStrictEqual(first, second);
  checkMemory(second, false);
});

test("the 8080 counted loop increments three bytes across FFFF, stores the last address, and halts with exact records", (t) => {
  const { cpu, ram } = create8080CountedLoopExample();
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  const result = runCpu(cpu, { maxSteps: 18 });
  assert.equal(result.stopReason, "halted");
  assert.deepEqual(result.records, expected);
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments),
    accesses.filter(access => access.kind === "read").map(access => [access.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [
    [0xffff, 0], [0, 0x10], [1, 0x80], [0x80, 1], [0x81, 0],
  ]);
  checkMemory(ram, true);
  const final = expected[17]?.after;
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
});

test("the 8080 counted loop resumes after address wrapping, resets to zero, and restarts at its entry point", () => {
  const { cpu, ram } = create8080CountedLoopExample();
  const first = runCpu(cpu, { maxSteps: 5 });
  const saved = structuredClone(first);
  assert.equal(first.stopReason, "step-limit");
  assert.equal(cpu.snapshot().hl, 0);
  assert.equal(cpu.snapshot().flags.cy, true);
  const rest = runCpu(cpu, { maxSteps: 13 });
  assert.equal(rest.stopReason, "halted");
  assert.deepEqual([...first.records, ...rest.records], expectedRecords());
  const before = cpu.snapshot();
  assert.deepEqual(cpu.reset(), {
    before, after: { ...before, pc: 0, halted: false, interruptEnabled: false }, accesses: [],
  });
  checkMemory(ram, true);
  const restarted = create8080CountedLoopExample();
  assert.notStrictEqual(restarted.cpu, cpu);
  assert.notStrictEqual(restarted.ram, ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  checkMemory(restarted.ram, false);
  restarted.cpu.step();
  ram.write(0, 0xff);
  assert.deepEqual(first, saved);
});
