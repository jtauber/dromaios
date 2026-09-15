import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu8080MemoryAccess, Cpu8080Snapshot, Cpu8080StepRecord } from "../../../src/components/cpus/8080.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create8080RotatesExample,
  create8080RotatesExampleMemory,
} from "../../../src/machines/generated/8080/rotates-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu8080Snapshot {
  return {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    bc: 0x2233, de: 0x4455, hl: 0x6677, pc: 0x0200, sp: 0xabcd,
    flags: { s: true, z: false, ac: true, p: false, cy: false },
    interruptEnabled: true, interruptDeferred: false, halted: false,
  };
}

function checkMemory(ram: Ram, finished: boolean): void {
  // Literal image from the specification, independent of the generated factory.
  const expected = new Uint8Array(0x10000);
  expected.set([
    0x21, 0x80, 0x81, 0x37, 0x3f, 0x7d, 0x17, 0x6f, 0x7c, 0x17,
    0x67, 0x22, 0x80, 0x00, 0x1f, 0x67, 0x7d, 0x1f, 0x6f, 0x22,
    0x82, 0x00, 0x07, 0x0f, 0x2f, 0x32, 0x84, 0x00, 0x76,
  ], 0x0200);
  if (finished) expected.set([0x00, 0x03, 0x80, 0x81, 0x7f], 0x80);
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu8080StepRecord[] {
  const steps: readonly {
    bytes: readonly number[]; changes: Partial<Cpu8080Snapshot>; data?: readonly Cpu8080MemoryAccess[];
  }[] = [
    { bytes: [0x21, 0x80, 0x81], changes: { pc: 0x0203, h: 0x81, l: 0x80, hl: 0x8180 } },
    { bytes: [0x37], changes: { pc: 0x0204,
      flags: { s: true, z: false, ac: true, p: false, cy: true } } },
    { bytes: [0x3f], changes: { pc: 0x0205,
      flags: { s: true, z: false, ac: true, p: false, cy: false } } },
    { bytes: [0x7d], changes: { pc: 0x0206, a: 0x80 } },
    { bytes: [0x17], changes: { pc: 0x0207, a: 0,
      flags: { s: true, z: false, ac: true, p: false, cy: true } } },
    { bytes: [0x6f], changes: { pc: 0x0208, l: 0, hl: 0x8100 } },
    { bytes: [0x7c], changes: { pc: 0x0209, a: 0x81 } },
    { bytes: [0x17], changes: { pc: 0x020a, a: 3 } },
    { bytes: [0x67], changes: { pc: 0x020b, h: 3, hl: 0x0300 } },
    { bytes: [0x22, 0x80, 0], changes: { pc: 0x020e },
      data: [{ kind: "write", address: 0x80, value: 0 }, { kind: "write", address: 0x81, value: 3 }] },
    { bytes: [0x1f], changes: { pc: 0x020f, a: 0x81 } },
    { bytes: [0x67], changes: { pc: 0x0210, h: 0x81, hl: 0x8100 } },
    { bytes: [0x7d], changes: { pc: 0x0211, a: 0 } },
    { bytes: [0x1f], changes: { pc: 0x0212, a: 0x80,
      flags: { s: true, z: false, ac: true, p: false, cy: false } } },
    { bytes: [0x6f], changes: { pc: 0x0213, l: 0x80, hl: 0x8180 } },
    { bytes: [0x22, 0x82, 0], changes: { pc: 0x0216 },
      data: [{ kind: "write", address: 0x82, value: 0x80 }, { kind: "write", address: 0x83, value: 0x81 }] },
    { bytes: [0x07], changes: { pc: 0x0217, a: 1,
      flags: { s: true, z: false, ac: true, p: false, cy: true } } },
    { bytes: [0x0f], changes: { pc: 0x0218, a: 0x80 } },
    { bytes: [0x2f], changes: { pc: 0x0219, a: 0x7f } },
    { bytes: [0x32, 0x84, 0], changes: { pc: 0x021c }, data: [{ kind: "write", address: 0x84, value: 0x7f }] },
    { bytes: [0x76], changes: { pc: 0x021d, halted: true } },
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

test("the 8080 rotates example creates independent code and zero-filled output memory", () => {
  const first = create8080RotatesExampleMemory();
  checkMemory(first, false);
  first.write(0x0200, 0);
  first.write(0x80, 0xff);
  const second = create8080RotatesExampleMemory();
  assert.notStrictEqual(first, second);
  checkMemory(second, false);
});

test("the 8080 rotates example restores a word through carry and complements a byte with exact records", (t) => {
  const { cpu, ram } = create8080RotatesExample();
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  const result = runCpu(cpu, { maxSteps: 21 });
  assert.equal(result.stopReason, "halted");
  assert.deepEqual(result.records, expected);
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments),
    accesses.flatMap(access => access.kind === "read" ? [[access.address]] : []));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [
    [0x80, 0], [0x81, 3], [0x82, 0x80], [0x83, 0x81], [0x84, 0x7f],
  ]);
  checkMemory(ram, true);
  const final = expected[20]?.after;
  assert.ok(final);
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
});

test("the 8080 rotates example resumes between bytes with carry intact, resets, and restarts independently", () => {
  const { cpu, ram } = create8080RotatesExample();
  const first = runCpu(cpu, { maxSteps: 5 });
  const saved = structuredClone(first);
  assert.equal(first.stopReason, "step-limit");
  assert.equal(cpu.snapshot().a, 0);
  assert.equal(cpu.snapshot().flags.cy, true);
  const rest = runCpu(cpu, { maxSteps: 16 });
  assert.equal(rest.stopReason, "halted");
  assert.deepEqual([...first.records, ...rest.records], expectedRecords());
  const before = cpu.snapshot();
  assert.deepEqual(cpu.reset(), {
    before, after: { ...before, pc: 0, halted: false, interruptEnabled: false }, accesses: [],
  });
  checkMemory(ram, true);
  const restarted = create8080RotatesExample();
  assert.notStrictEqual(restarted.cpu, cpu);
  assert.notStrictEqual(restarted.ram, ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  checkMemory(restarted.ram, false);
  restarted.cpu.step();
  ram.write(0x80, 0xff);
  assert.deepEqual(first, saved);
});
