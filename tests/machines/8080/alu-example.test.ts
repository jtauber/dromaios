import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu8080MemoryAccess, Cpu8080Snapshot, Cpu8080StepRecord } from "../../../src/components/cpus/8080.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create8080AluExample,
  create8080AluExampleMemory,
} from "../../../src/machines/generated/8080/alu-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu8080Snapshot {
  return {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    bc: 0x2233, de: 0x4455, hl: 0x6677, pc: 0, sp: 0xabcd,
    flags: { s: true, z: false, ac: true, p: false, cy: true },
    interruptEnabled: false, interruptDeferred: false, halted: false,
  };
}

function checkMemory(ram: Ram, finished: boolean): void {
  // Literal image from the specification, independent of the generated factory.
  const expected = new Uint8Array(0x10000);
  expected.set([
    0x21, 0x80, 0x00, 0x3e, 0xf0, 0x86, 0x47, 0x32, 0x82, 0x00,
    0x3e, 0x01, 0xce, 0x00, 0x32, 0x83, 0x00, 0x78, 0x96, 0x4f,
    0x32, 0x84, 0x00, 0x3a, 0x83, 0x00, 0xde, 0x00, 0x32, 0x85, 0x00,
    0x79, 0xe6, 0x3f, 0xee, 0x55, 0xb0, 0xfe, 0x75, 0xca, 0x2c, 0x00,
    0x3e, 0xff, 0x32, 0x86, 0x00, 0x76,
  ]);
  expected[0x80] = 0x20;
  if (finished) expected.set([0x10, 0x02, 0xf0, 0x01, 0x75], 0x82);
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu8080StepRecord[] {
  const steps: readonly {
    bytes: readonly number[]; changes: Partial<Cpu8080Snapshot>; data?: readonly Cpu8080MemoryAccess[];
  }[] = [
    { bytes: [0x21, 0x80, 0], changes: { pc: 3, h: 0, l: 0x80, hl: 0x0080 } },
    { bytes: [0x3e, 0xf0], changes: { pc: 5, a: 0xf0 } },
    { bytes: [0x86], changes: { pc: 6, a: 0x10,
      flags: { s: false, z: false, ac: false, p: false, cy: true } },
      data: [{ kind: "read", address: 0x80, value: 0x20 }] },
    { bytes: [0x47], changes: { pc: 7, b: 0x10, bc: 0x1033 } },
    { bytes: [0x32, 0x82, 0], changes: { pc: 0x0a }, data: [{ kind: "write", address: 0x82, value: 0x10 }] },
    { bytes: [0x3e, 1], changes: { pc: 0x0c, a: 1 } },
    { bytes: [0xce, 0], changes: { pc: 0x0e, a: 2,
      flags: { s: false, z: false, ac: false, p: false, cy: false } } },
    { bytes: [0x32, 0x83, 0], changes: { pc: 0x11 }, data: [{ kind: "write", address: 0x83, value: 2 }] },
    { bytes: [0x78], changes: { pc: 0x12, a: 0x10 } },
    { bytes: [0x96], changes: { pc: 0x13, a: 0xf0,
      flags: { s: true, z: false, ac: true, p: true, cy: true } },
      data: [{ kind: "read", address: 0x80, value: 0x20 }] },
    { bytes: [0x4f], changes: { pc: 0x14, c: 0xf0, bc: 0x10f0 } },
    { bytes: [0x32, 0x84, 0], changes: { pc: 0x17 }, data: [{ kind: "write", address: 0x84, value: 0xf0 }] },
    { bytes: [0x3a, 0x83, 0], changes: { pc: 0x1a, a: 2 }, data: [{ kind: "read", address: 0x83, value: 2 }] },
    { bytes: [0xde, 0], changes: { pc: 0x1c, a: 1,
      flags: { s: false, z: false, ac: true, p: false, cy: false } } },
    { bytes: [0x32, 0x85, 0], changes: { pc: 0x1f }, data: [{ kind: "write", address: 0x85, value: 1 }] },
    { bytes: [0x79], changes: { pc: 0x20, a: 0xf0 } },
    { bytes: [0xe6, 0x3f], changes: { pc: 0x22, a: 0x30,
      flags: { s: false, z: false, ac: true, p: true, cy: false } } },
    { bytes: [0xee, 0x55], changes: { pc: 0x24, a: 0x65,
      flags: { s: false, z: false, ac: false, p: true, cy: false } } },
    { bytes: [0xb0], changes: { pc: 0x25, a: 0x75,
      flags: { s: false, z: false, ac: false, p: false, cy: false } } },
    { bytes: [0xfe, 0x75], changes: { pc: 0x27,
      flags: { s: false, z: true, ac: true, p: true, cy: false } } },
    { bytes: [0xca, 0x2c, 0], changes: { pc: 0x2c } },
    { bytes: [0x32, 0x86, 0], changes: { pc: 0x2f }, data: [{ kind: "write", address: 0x86, value: 0x75 }] },
    { bytes: [0x76], changes: { pc: 0x30, halted: true } },
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

test("the 8080 ALU example creates independent code, input, and output memory", () => {
  const first = create8080AluExampleMemory();
  checkMemory(first, false);
  first.write(0, 0);
  first.write(0x80, 0xff);
  first.write(0x82, 0xff);
  const second = create8080AluExampleMemory();
  assert.notStrictEqual(first, second);
  checkMemory(second, false);
});

test("the 8080 ALU lesson propagates carry and borrow, applies logic, and branches on comparison with exact records", (t) => {
  const { cpu, ram } = create8080AluExample();
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  const result = runCpu(cpu, { maxSteps: 23 });
  assert.equal(result.stopReason, "halted");
  assert.deepEqual(result.records, expected);
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments),
    accesses.flatMap(access => access.kind === "read" ? [[access.address]] : []));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [
    [0x82, 0x10], [0x83, 2], [0x84, 0xf0], [0x85, 1], [0x86, 0x75],
  ]);
  checkMemory(ram, true);
  const final = expected[22]?.after;
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
});

test("the 8080 ALU lesson resumes after its low-byte sum, resets without clearing results, and restarts independently", () => {
  const { cpu, ram } = create8080AluExample();
  const first = runCpu(cpu, { maxSteps: 5 });
  const saved = structuredClone(first);
  assert.equal(first.stopReason, "step-limit");
  assert.equal(cpu.snapshot().flags.cy, true);
  const rest = runCpu(cpu, { maxSteps: 18 });
  assert.equal(rest.stopReason, "halted");
  assert.deepEqual([...first.records, ...rest.records], expectedRecords());
  const before = cpu.snapshot();
  assert.deepEqual(cpu.reset(), {
    before, after: { ...before, pc: 0, halted: false, interruptEnabled: false }, accesses: [],
  });
  checkMemory(ram, true);
  const restarted = create8080AluExample();
  assert.notStrictEqual(restarted.cpu, cpu);
  assert.notStrictEqual(restarted.ram, ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  checkMemory(restarted.ram, false);
  restarted.cpu.step();
  ram.write(0x80, 0xff);
  assert.deepEqual(first, saved);
});
