import assert from "node:assert/strict";
import { test } from "node:test";
import { create8080AltairInputLesson } from "../../../src/machines/generated/8080/altair-input-lesson.js";

const initial = {
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x100, sp: 0,
  bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
};
const program = [0xdb, 1, 0xd3, 1];

test("the input lesson starts with empty devices, zero RAM outside its program, and only port 1 connected", () => {
  const received: number[] = [];
  const machine = create8080AltairInputLesson({ output: byte => { received.push(byte); } });
  assert.deepEqual(machine.cpu.snapshot(), initial);
  assert.equal(machine.endAddress, 0x104);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.equal(machine.ram.size, 0x10000);
  for (let address = 0; address < machine.ram.size; address++) {
    assert.equal(machine.ram.read(address), program[address - 0x100] ?? 0, `address ${address}`);
  }
  machine.input.offer(42);
  for (let port = 0; port <= 255; port++) {
    if (port === 1) continue;
    assert.throws(() => machine.ports.readPort(port), /Unconnected input port/);
    assert.throws(() => machine.ports.writePort(port, 255), /Unconnected output port/);
  }
  assert.deepEqual(machine.input.snapshot(), { pendingByte: 42 });
  assert.deepEqual(received, []);
});

test("IN consumes every possible byte and OUT echoes it while a later byte remains pending", () => {
  for (let value = 0; value <= 255; value++) {
    const received: number[] = [];
    const { cpu, input, output, ram } = create8080AltairInputLesson({ output: byte => { received.push(byte); } });
    assert.equal(input.offer(value), true);
    assert.deepEqual(cpu.step(), {
      before: initial, after: { ...initial, a: value, pc: 0x102 }, outcome: "executed",
      instruction: { address: 0x100, bytes: [0xdb, 1] },
      accesses: [
        { kind: "read", address: 0x100, value: 0xdb }, { kind: "read", address: 0x101, value: 1 },
        { kind: "input", port: 1, value },
      ],
    });
    assert.deepEqual(input.snapshot(), { pendingByte: null });
    assert.deepEqual(output.snapshot(), { lastByte: null });
    assert.deepEqual(received, []);
    input.offer(value ^ 0xff);
    assert.deepEqual(cpu.step(), {
      before: { ...initial, a: value, pc: 0x102 }, after: { ...initial, a: value, pc: 0x104 }, outcome: "executed",
      instruction: { address: 0x102, bytes: [0xd3, 1] },
      accesses: [
        { kind: "read", address: 0x102, value: 0xd3 }, { kind: "read", address: 0x103, value: 1 },
        { kind: "output", port: 1, value },
      ],
    });
    assert.deepEqual(received, [value]);
    assert.deepEqual(output.snapshot(), { lastByte: value });
    assert.deepEqual(input.snapshot(), { pendingByte: value ^ 0xff });
    assert.equal(ram.read(1), 0);
    assert.deepEqual(program.map((_, i) => ram.read(0x100 + i)), program);
  }
});

test("the raw device returns zero when empty; the lesson's waiting guard is not CPU behavior", () => {
  const machine = create8080AltairInputLesson({ output() {} });
  const record = machine.cpu.step();
  assert.deepEqual(record.after, { ...initial, pc: 0x102 });
  assert.deepEqual(record.accesses.at(-1), { kind: "input", port: 1, value: 0 });
  machine.input.offer(99);
  machine.output.write(0, 42);
  machine.ram.write(1, 77);
  machine.cpu.reset();
  assert.deepEqual(machine.input.snapshot(), { pendingByte: 99 });
  assert.deepEqual(machine.output.snapshot(), { lastByte: 42 });
  machine.reset();
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.equal(machine.ram.read(1), 77);
});
