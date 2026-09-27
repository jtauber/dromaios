import assert from "node:assert/strict";
import { test } from "node:test";
import { create8080JumpLesson } from "../../../src/machines/generated/8080/jump-lesson.js";

const initial = {
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x100, sp: 0,
  bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
};
const program = [0x3a, 3, 0, 0xc3, 8, 1, 0xc6, 1, 0x32, 4, 0];

test("the jump lesson starts with a forward jump over the addition and otherwise empty RAM", () => {
  const { cpu, ram, endAddress } = create8080JumpLesson();
  assert.deepEqual(cpu.snapshot(), initial);
  assert.equal(endAddress, 0x10b);
  const expected = new Uint8Array(0x10000);
  expected[3] = 41;
  expected.set(program, 0x100);
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `address ${address}`);
});

test("the skip path loads and stores 41 without fetching the addition", () => {
  const { cpu, ram, endAddress } = create8080JumpLesson();
  const loaded = { ...initial, a: 41, pc: 0x103 };
  const jumped = { ...loaded, pc: 0x108 };
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x100, bytes: [0x3a, 3, 0] },
    before: initial, after: loaded, outcome: "executed",
    accesses: [
      { kind: "read", address: 0x100, value: 0x3a },
      { kind: "read", address: 0x101, value: 3 },
      { kind: "read", address: 0x102, value: 0 },
      { kind: "read", address: 3, value: 41 },
    ],
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x103, bytes: [0xc3, 8, 1] },
    before: loaded, after: jumped, outcome: "executed",
    accesses: [
      { kind: "read", address: 0x103, value: 0xc3 },
      { kind: "read", address: 0x104, value: 8 },
      { kind: "read", address: 0x105, value: 1 },
    ],
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x108, bytes: [0x32, 4, 0] },
    before: jumped, after: { ...jumped, pc: endAddress }, outcome: "executed",
    accesses: [
      { kind: "read", address: 0x108, value: 0x32 },
      { kind: "read", address: 0x109, value: 4 },
      { kind: "read", address: 0x10a, value: 0 },
      { kind: "write", address: 4, value: 41 },
    ],
  });
  assert.deepEqual([ram.read(3), ram.read(4)], [41, 41]);
  assert.deepEqual(Array.from({ length: program.length }, (_, offset) => ram.read(0x100 + offset)), program);
  assert.equal(cpu.snapshot().halted, false);
});

test("both destinations follow the fetched address and keep the loaded value independent of memory edits", () => {
  for (const destination of [0x106, 0x108]) {
    for (const source of [0, 41, 255]) {
      const { cpu, ram, endAddress } = create8080JumpLesson();
      ram.write(0x104, destination & 0xff);
      ram.write(0x105, destination >>> 8);
      ram.write(3, source);
      assert.deepEqual(cpu.snapshot(), initial); // Editing code or data does not run an instruction.
      const load = cpu.step();
      ram.write(3, 99);
      ram.write(4, 77);
      const jump = cpu.step();
      assert.deepEqual(jump.after, { ...load.after, pc: destination });
      assert.deepEqual(jump.instruction, { address: 0x103, bytes: [0xc3, destination & 0xff, 1] });
      assert.deepEqual([ram.read(3), ram.read(4)], [99, 77]);
      const savedJump = structuredClone(jump);
      const path = [load.before.pc, load.after.pc, jump.after.pc];
      const result = destination === 0x106 ? (source + 1) % 256 : source;
      const carry = destination === 0x106 && source === 255;
      if (destination === 0x106) {
        const add = cpu.step();
        assert.deepEqual(add.instruction, { address: 0x106, bytes: [0xc6, 1] });
        path.push(add.after.pc);
      }
      const beforeStore = cpu.snapshot();
      const store = cpu.step();
      path.push(store.after.pc);
      assert.deepEqual(store.after, { ...beforeStore, pc: endAddress });
      assert.deepEqual([store.after.a, store.after.flags.cy, ram.read(3), ram.read(4)], [result, carry, 99, result]);
      assert.deepEqual(path, destination === 0x106 ? [0x100, 0x103, 0x106, 0x108, 0x10b] : [0x100, 0x103, 0x108, 0x10b]);
      ram.write(0x104, 0); // Later edits cannot rewrite the captured destination or PC transition.
      assert.deepEqual(jump, savedJump);
    }
  }
});

test("a fresh jump lesson restores the skip path, data, and CPU after an addition with carry", () => {
  const first = create8080JumpLesson();
  first.ram.write(0x104, 6);
  first.ram.write(3, 255);
  const records = Array.from({ length: 4 }, () => first.cpu.step());
  assert.equal(first.cpu.snapshot().flags.cy, true);
  const fresh = create8080JumpLesson();
  assert.notEqual(fresh.ram, first.ram);
  assert.notEqual(fresh.cpu, first.cpu);
  assert.deepEqual(fresh.cpu.snapshot(), initial);
  assert.deepEqual([fresh.ram.read(3), fresh.ram.read(4), fresh.ram.read(0x104), fresh.ram.read(0x105)], [41, 0, 8, 1]);
  fresh.cpu.step();
  assert.equal(fresh.cpu.step().after.pc, 0x108);
  assert.deepEqual(first.cpu.snapshot(), records[3]!.after);
  assert.equal(first.ram.read(0x104), 6);
});
