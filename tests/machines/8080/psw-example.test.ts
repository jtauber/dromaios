import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu8080MemoryAccess, Cpu8080Snapshot, Cpu8080StepRecord } from "../../../src/components/cpus/8080.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create8080PswExample,
  create8080PswExampleMemory,
} from "../../../src/machines/generated/8080/psw-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu8080Snapshot {
  return {
    a: 0x81, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    bc: 0x2233, de: 0x4455, hl: 0x6677, pc: 0x0200, sp: 0xabcd,
    flags: { s: true, z: false, ac: true, p: false, cy: true },
    interruptEnabled: true, interruptDeferred: false, halted: false,
  };
}

function checkMemory(ram: Ram, finished: boolean): void {
  // Literal image from the specification, independent of the generated factory.
  const expected = new Uint8Array(0x10000);
  expected.set([0x31, 0x01, 0x00, 0xf5, 0xaf, 0x00, 0xf1, 0x32,
    0x80, 0x00, 0xce, 0x00, 0x32, 0x81, 0x00, 0x76], 0x0200);
  if (finished) {
    expected[0] = 0x81;
    expected[0xffff] = 0x93;
    expected.set([0x81, 0x82], 0x80);
  }
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu8080StepRecord[] {
  const initial = expectedInitialState();
  const steps: readonly {
    bytes: readonly number[]; changes: Partial<Cpu8080Snapshot>; data?: readonly Cpu8080MemoryAccess[];
  }[] = [
    { bytes: [0x31, 1, 0], changes: { pc: 0x0203, sp: 1 } },
    { bytes: [0xf5], changes: { pc: 0x0204, sp: 0xffff }, data: [
      { kind: "write", address: 0, value: 0x81 }, { kind: "write", address: 0xffff, value: 0x93 }] },
    { bytes: [0xaf], changes: { pc: 0x0205, a: 0,
      flags: { s: false, z: true, ac: false, p: true, cy: false } } },
    { bytes: [0], changes: { pc: 0x0206 } },
    { bytes: [0xf1], changes: { pc: 0x0207, sp: 1, a: 0x81, flags: initial.flags }, data: [
      { kind: "read", address: 0xffff, value: 0x93 }, { kind: "read", address: 0, value: 0x81 }] },
    { bytes: [0x32, 0x80, 0], changes: { pc: 0x020a }, data: [{ kind: "write", address: 0x80, value: 0x81 }] },
    { bytes: [0xce, 0], changes: { pc: 0x020c, a: 0x82,
      flags: { s: true, z: false, ac: false, p: true, cy: false } } },
    { bytes: [0x32, 0x81, 0], changes: { pc: 0x020f }, data: [{ kind: "write", address: 0x81, value: 0x82 }] },
    { bytes: [0x76], changes: { pc: 0x0210, halted: true } },
  ];
  let state = initial;
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

test("the 8080 PSW example creates independent code, stack, and output memory", () => {
  const first = create8080PswExampleMemory();
  checkMemory(first, false);
  first.write(0x0200, 0);
  first.write(0xffff, 0xff);
  first.write(0x80, 0xff);
  const second = create8080PswExampleMemory();
  assert.notStrictEqual(first, second);
  checkMemory(second, false);
});

test("the 8080 PSW example restores A and flags across stack wrapping and uses the restored carry", (t) => {
  const { cpu, ram } = create8080PswExample();
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  const result = runCpu(cpu, { maxSteps: 9 });
  assert.equal(result.stopReason, "halted");
  assert.deepEqual(result.records, expected);
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments),
    accesses.flatMap(access => access.kind === "read" ? [[access.address]] : []));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0, 0x81], [0xffff, 0x93], [0x80, 0x81], [0x81, 0x82]]);
  checkMemory(ram, true);
  const final = expected[8]?.after;
  assert.ok(final);
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
});

test("the 8080 PSW example resumes after NOP, resets without clearing its stack, and restarts independently", () => {
  const { cpu, ram } = create8080PswExample();
  const first = runCpu(cpu, { maxSteps: 4 });
  const saved = structuredClone(first);
  assert.equal(first.stopReason, "step-limit");
  assert.deepEqual(first.records, expectedRecords().slice(0, 4));
  const rest = runCpu(cpu, { maxSteps: 5 });
  assert.equal(rest.stopReason, "halted");
  assert.deepEqual([...first.records, ...rest.records], expectedRecords());
  const before = cpu.snapshot();
  assert.deepEqual(cpu.reset(), {
    before, after: { ...before, pc: 0, halted: false, interruptEnabled: false }, accesses: [],
  });
  checkMemory(ram, true);
  const restarted = create8080PswExample();
  assert.notStrictEqual(restarted.cpu, cpu);
  assert.notStrictEqual(restarted.ram, ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  checkMemory(restarted.ram, false);
  restarted.cpu.step();
  ram.write(0xffff, 0xff);
  assert.deepEqual(first, saved);
});
