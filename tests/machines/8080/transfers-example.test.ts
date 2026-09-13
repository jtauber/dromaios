import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu8080MemoryAccess, Cpu8080Snapshot, Cpu8080StepRecord } from "../../../src/components/cpus/8080.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create8080TransfersExample,
  create8080TransfersExampleMemory,
} from "../../../src/machines/generated/8080/transfers-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu8080Snapshot {
  return {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    bc: 0x2233, de: 0x4455, hl: 0x6677, pc: 0, sp: 0xabcd,
    flags: { s: true, z: false, ac: true, p: false, cy: true },
    interruptEnabled: false, halted: false,
  };
}

function checkMemory(ram: Ram, finished: boolean): void {
  // Literal image from the specification, independent of the generated factory.
  const expected = new Uint8Array(0x10000);
  expected.set([
    0x06, 0xa5, 0x48, 0x21, 0x80, 0x00, 0x71, 0x56, 0x36, 0x5a, 0x7a,
    0x32, 0x81, 0x00, 0x2a, 0x80, 0x00, 0xeb, 0x22, 0x82, 0x00,
    0x21, 0x00, 0x20, 0xf9, 0xe3, 0x76,
  ]);
  expected.set(finished ? [0x00, 0x20] : [0x34, 0x12], 0x2000);
  if (finished) expected.set([0x5a, 0xa5, 0x55, 0xa5], 0x0080);
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu8080StepRecord[] {
  const initial = expectedInitialState();
  const loadB = { ...initial, b: 0xa5, bc: 0xa533, pc: 2 };
  const copyC = { ...loadB, c: 0xa5, bc: 0xa5a5, pc: 3 };
  const address = { ...copyC, h: 0, l: 0x80, hl: 0x0080, pc: 6 };
  const storeC = { ...address, pc: 7 };
  const loadD = { ...storeC, d: 0xa5, de: 0xa555, pc: 8 };
  const storeImmediate = { ...loadD, pc: 0x0a };
  const copyA = { ...storeImmediate, a: 0xa5, pc: 0x0b };
  const storeA = { ...copyA, pc: 0x0e };
  const loadPair = { ...storeA, h: 0xa5, l: 0x5a, hl: 0xa55a, pc: 0x11 };
  const exchangePairs = { ...loadPair, e: 0x5a, de: 0xa55a, l: 0x55, hl: 0xa555, pc: 0x12 };
  const storePair = { ...exchangePairs, pc: 0x15 };
  const loadSp = { ...storePair, h: 0x20, l: 0, hl: 0x2000, pc: 0x18 };
  const copySp = { ...loadSp, sp: 0x2000, pc: 0x19 };
  const exchangeStack = { ...copySp, h: 0x12, l: 0x34, hl: 0x1234, pc: 0x1a };
  const halt = { ...exchangeStack, pc: 0x1b, halted: true };
  const steps: readonly {
    before: Cpu8080Snapshot; after: Cpu8080Snapshot; bytes: readonly number[];
    data?: readonly Cpu8080MemoryAccess[];
  }[] = [
    { before: initial, after: loadB, bytes: [0x06, 0xa5] },
    { before: loadB, after: copyC, bytes: [0x48] },
    { before: copyC, after: address, bytes: [0x21, 0x80, 0] },
    { before: address, after: storeC, bytes: [0x71], data: [{ kind: "write", address: 0x80, value: 0xa5 }] },
    { before: storeC, after: loadD, bytes: [0x56], data: [{ kind: "read", address: 0x80, value: 0xa5 }] },
    { before: loadD, after: storeImmediate, bytes: [0x36, 0x5a], data: [{ kind: "write", address: 0x80, value: 0x5a }] },
    { before: storeImmediate, after: copyA, bytes: [0x7a] },
    { before: copyA, after: storeA, bytes: [0x32, 0x81, 0], data: [{ kind: "write", address: 0x81, value: 0xa5 }] },
    { before: storeA, after: loadPair, bytes: [0x2a, 0x80, 0], data: [
      { kind: "read", address: 0x80, value: 0x5a }, { kind: "read", address: 0x81, value: 0xa5 },
    ] },
    { before: loadPair, after: exchangePairs, bytes: [0xeb] },
    { before: exchangePairs, after: storePair, bytes: [0x22, 0x82, 0], data: [
      { kind: "write", address: 0x82, value: 0x55 }, { kind: "write", address: 0x83, value: 0xa5 },
    ] },
    { before: storePair, after: loadSp, bytes: [0x21, 0, 0x20] },
    { before: loadSp, after: copySp, bytes: [0xf9] },
    { before: copySp, after: exchangeStack, bytes: [0xe3], data: [
      { kind: "read", address: 0x2000, value: 0x34 }, { kind: "read", address: 0x2001, value: 0x12 },
      { kind: "write", address: 0x2001, value: 0x20 }, { kind: "write", address: 0x2000, value: 0 },
    ] },
    { before: exchangeStack, after: halt, bytes: [0x76] },
  ];
  return steps.map(({ before, after, bytes, data = [] }) => ({
    instruction: { address: before.pc, bytes }, before, after,
    accesses: [...bytes.map((value, offset): Cpu8080MemoryAccess => ({
      kind: "read", address: before.pc + offset, value,
    })), ...data],
    outcome: after.halted ? "halted" : "executed",
  }));
}

test("the 8080 transfers example creates independent program, data, and stack memory", () => {
  const first = create8080TransfersExampleMemory();
  checkMemory(first, false);
  first.write(0, 0);
  first.write(0x80, 0xff);
  first.write(0x2000, 0);
  const second = create8080TransfersExampleMemory();
  assert.notStrictEqual(first, second);
  checkMemory(second, false);
});

test("the 8080 transfers lesson moves bytes, exchanges pairs and stack data, and halts with exact records", (t) => {
  const { cpu, ram } = create8080TransfersExample();
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  const result = runCpu(cpu, { maxSteps: 15 });
  assert.equal(result.stopReason, "halted");
  assert.deepEqual(result.records, expected);
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments),
    accesses.filter(access => access.kind === "read").map(access => [access.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [
    [0x80, 0xa5], [0x80, 0x5a], [0x81, 0xa5], [0x82, 0x55], [0x83, 0xa5], [0x2001, 0x20], [0x2000, 0],
  ]);
  checkMemory(ram, true);
  const final = expected[14]?.after;
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
});

test("8080 reset retains transferred data while lesson restart restores fresh state and memory", () => {
  const { cpu, ram } = create8080TransfersExample();
  const result = runCpu(cpu, { maxSteps: 15 });
  const saved = structuredClone(result);
  assert.equal(result.stopReason, "halted");
  const before = cpu.snapshot();
  assert.deepEqual(cpu.reset(), {
    before, after: { ...before, pc: 0, halted: false, interruptEnabled: false }, accesses: [],
  });
  checkMemory(ram, true);
  const restarted = create8080TransfersExample();
  assert.notStrictEqual(restarted.cpu, cpu);
  assert.notStrictEqual(restarted.ram, ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  checkMemory(restarted.ram, false);
  restarted.cpu.step();
  ram.write(0x2000, 0xff);
  assert.deepEqual(result, saved);
});
