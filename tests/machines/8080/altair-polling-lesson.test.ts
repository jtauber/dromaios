import assert from "node:assert/strict";
import { test } from "node:test";
import { create8080AltairPollingLesson } from "../../../src/machines/generated/8080/altair-polling-lesson.js";

const initial = {
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x100, sp: 0,
  bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
};
// Independently transcribed IN 0; CPI 0; JZ 0100; IN 1; OUT 1; JMP 0100.
const program = [0xdb, 0, 0xfe, 0, 0xca, 0, 1, 0xdb, 1, 0xd3, 1, 0xc3, 0, 1];
const emptyFlags = { s: false, z: true, ac: true, p: true, cy: false };
const readyFlags = { s: false, z: false, ac: true, p: false, cy: false };

type Machine = ReturnType<typeof create8080AltairPollingLesson>;

function expectStep(machine: Machine, before: typeof initial, after: typeof initial, bytes: number[],
  transfer?: { kind: "input" | "output"; port: number; value: number }): void {
  assert.deepEqual(machine.cpu.step(), {
    before, after, outcome: "executed", instruction: { address: before.pc, bytes },
    accesses: [
      ...bytes.map((value, offset) => ({ kind: "read", address: before.pc + offset, value })),
      ...(transfer ? [transfer] : []),
    ],
  });
}

test("the polling machine starts empty with fourteen program bytes and separate status, data, and output ports", () => {
  const writes: number[] = [];
  const machine = create8080AltairPollingLesson({ output: byte => { writes.push(byte); } });
  assert.deepEqual(machine.cpu.snapshot(), initial);
  assert.equal("endAddress" in machine, false);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.equal(machine.ram.size, 0x10000);
  for (let address = 0; address < machine.ram.size; address++) {
    assert.equal(machine.ram.read(address), program[address - 0x100] ?? 0, `address ${address}`);
  }
  assert.equal(machine.ports.readPort(0), 0);
  machine.input.offer(0);
  for (let port = 0; port <= 255; port++) {
    if (port > 1) assert.throws(() => machine.ports.readPort(port), /Unconnected input port/);
    if (port !== 1) assert.throws(() => machine.ports.writePort(port, 255), /Unconnected output port/);
  }
  assert.equal(machine.ports.readPort(0), 1);
  assert.equal(machine.ports.readPort(0), 1);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: 0 });
  assert.deepEqual(writes, []);
});

test("empty polling executes IN, CPI, and a taken JZ without consuming data, outputting, or halting", () => {
  const writes: number[] = [];
  const machine = create8080AltairPollingLesson({ output: byte => { writes.push(byte); } });
  let before = initial;
  for (let trip = 0; trip < 3; trip++) {
    const sampled = { ...before, pc: 0x102 };
    const compared = { ...sampled, pc: 0x104, flags: emptyFlags };
    const returned = { ...compared, pc: 0x100 };
    expectStep(machine, before, sampled, [0xdb, 0], { kind: "input", port: 0, value: 0 });
    expectStep(machine, sampled, compared, [0xfe, 0]);
    expectStep(machine, compared, returned, [0xca, 0, 1]);
    before = returned;
  }
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.deepEqual(writes, []);
});

test("every byte follows the ready path and is echoed while the next byte can wait separately", () => {
  for (let value = 0; value <= 255; value++) {
    const writes: number[] = [];
    const machine = create8080AltairPollingLesson({ output: byte => { writes.push(byte); } });
    machine.input.offer(value);
    const sampled = { ...initial, a: 1, pc: 0x102 };
    const compared = { ...sampled, pc: 0x104, flags: readyFlags };
    const continued = { ...compared, pc: 0x107 };
    const received = { ...continued, a: value, pc: 0x109 };
    const echoed = { ...received, pc: 0x10b };
    const returned = { ...echoed, pc: 0x100 };
    expectStep(machine, initial, sampled, [0xdb, 0], { kind: "input", port: 0, value: 1 });
    assert.deepEqual(machine.input.snapshot(), { pendingByte: value });
    expectStep(machine, sampled, compared, [0xfe, 0]);
    expectStep(machine, compared, continued, [0xca, 0, 1]);
    assert.deepEqual(machine.input.snapshot(), { pendingByte: value });
    expectStep(machine, continued, received, [0xdb, 1], { kind: "input", port: 1, value });
    assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
    assert.deepEqual(machine.output.snapshot(), { lastByte: null });
    machine.input.offer(value ^ 0xff);
    expectStep(machine, received, echoed, [0xd3, 1], { kind: "output", port: 1, value });
    expectStep(machine, echoed, returned, [0xc3, 0, 1]);
    assert.deepEqual(machine.input.snapshot(), { pendingByte: value ^ 0xff });
    assert.deepEqual(machine.output.snapshot(), { lastByte: value });
    assert.deepEqual(writes, [value]);
    assert.equal(machine.ram.read(1), 0);
    assert.deepEqual(program.map((_, i) => machine.ram.read(0x100 + i)), program);
  }
});
