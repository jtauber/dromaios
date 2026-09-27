import assert from "node:assert/strict";
import { test } from "node:test";
import { create8080RegisterLesson } from "../../../src/machines/generated/8080/register-lesson.js";

const initial = {
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x100, sp: 0,
  bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
};
const program = [0x3a, 0x03, 0x00, 0x32, 0x04, 0x00];

test("the register lesson starts with independent data and code in a complete 8080 machine", () => {
  const { cpu, ram, endAddress } = create8080RegisterLesson();
  assert.deepEqual(cpu.snapshot(), initial);
  assert.equal(endAddress, 0x106);
  const expected = new Uint8Array(0x10000);
  expected.set([200, 42], 3);
  expected.set(program, 0x100);
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `address ${address}`);
});

test("the two real instructions copy through A with exact reads, writes, and preserved state", () => {
  const { cpu, ram, endAddress } = create8080RegisterLesson();
  const loaded = { ...initial, a: 200, pc: 0x103 };
  const stored = { ...loaded, pc: endAddress };
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x100, bytes: [0x3a, 3, 0] },
    before: initial, after: loaded, outcome: "executed",
    accesses: [
      { kind: "read", address: 0x100, value: 0x3a },
      { kind: "read", address: 0x101, value: 3 },
      { kind: "read", address: 0x102, value: 0 },
      { kind: "read", address: 3, value: 200 },
    ],
  });
  assert.equal(ram.read(3), 200);
  assert.equal(ram.read(4), 42);
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x103, bytes: [0x32, 4, 0] },
    before: loaded, after: stored, outcome: "executed",
    accesses: [
      { kind: "read", address: 0x103, value: 0x32 },
      { kind: "read", address: 0x104, value: 4 },
      { kind: "read", address: 0x105, value: 0 },
      { kind: "write", address: 4, value: 200 },
    ],
  });
  assert.deepEqual(Array.from({ length: 8 }, (_, address) => ram.read(address)), [0, 0, 0, 200, 200, 0, 0, 0]);
  assert.deepEqual(Array.from({ length: 6 }, (_, offset) => ram.read(0x100 + offset)), program);
  assert.equal(cpu.snapshot().halted, false); // Completion is a caller boundary, not HLT.
});

test("every byte is copied by value even when RAM changes between instructions", () => {
  for (let value = 0; value < 256; value++) {
    const { cpu, ram } = create8080RegisterLesson();
    ram.write(3, value);
    const load = cpu.step();
    ram.write(3, 255 - value);
    ram.write(4, 255 - value);
    assert.equal(cpu.snapshot().a, value);
    cpu.step();
    assert.equal(ram.read(3), 255 - value);
    assert.equal(ram.read(4), value);
    assert.equal(cpu.snapshot().a, value);
    assert.equal(load.after.a, value);
    assert.deepEqual(cpu.snapshot().flags, initial.flags);
  }
});

test("restarting the register lesson restores the full setup and leaves the old run and records intact", () => {
  const first = create8080RegisterLesson();
  const load = first.cpu.step(), store = first.cpu.step();
  const retained = structuredClone([load, store]);
  first.ram.write(3, 17);
  const fresh = create8080RegisterLesson();
  assert.notEqual(fresh.cpu, first.cpu);
  assert.notEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), initial);
  assert.deepEqual([fresh.ram.read(3), fresh.ram.read(4)], [200, 42]);
  assert.deepEqual([first.ram.read(3), first.ram.read(4)], [17, 200]);
  fresh.ram.write(3, 255);
  fresh.cpu.step();
  assert.deepEqual([load, store], retained);
});
