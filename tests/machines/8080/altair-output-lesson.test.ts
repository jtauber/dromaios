import assert from "node:assert/strict";
import { test } from "node:test";
import { create8080AltairOutputLesson } from "../../../src/machines/generated/8080/altair-output-lesson.js";

const initial = {
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x100, sp: 0,
  bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
};

test("the lamp lesson loads only its seven-byte program and source, without sending output", () => {
  const received: number[] = [];
  const { cpu, ram, output, endAddress } = create8080AltairOutputLesson({ output: byte => { received.push(byte); } });
  assert.deepEqual(cpu.snapshot(), initial);
  assert.equal(endAddress, 0x107);
  assert.deepEqual(output.snapshot(), { lastByte: null });
  assert.deepEqual(received, []);
  const expected = new Uint8Array(0x10000);
  expected[3] = 41;
  expected.set([0x3a, 3, 0, 0xc6, 1, 0xd3, 1], 0x100);
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `address ${address}`);
  cpu.step(); cpu.step();
  assert.deepEqual(cpu.snapshot(), { ...initial, a: 42, pc: 0x105 });
  assert.deepEqual(received, []);
  const sent = cpu.step();
  assert.deepEqual(sent, {
    before: { ...initial, a: 42, pc: 0x105 }, after: { ...initial, a: 42, pc: endAddress },
    instruction: { address: 0x105, bytes: [0xd3, 1] }, outcome: "executed",
    accesses: [
      { kind: "read", address: 0x105, value: 0xd3 },
      { kind: "read", address: 0x106, value: 1 },
      { kind: "output", port: 1, value: 42 },
    ],
  });
  assert.deepEqual(output.snapshot(), { lastByte: 42 });
  assert.deepEqual(received, [42]);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `unchanged address ${address}`);
});

test("only output port 1 is connected; reset clears its latch without replaying host output or clearing RAM", () => {
  const received: number[] = [];
  const machine = create8080AltairOutputLesson({ output: byte => { received.push(byte); } });
  machine.ports.writePort(1, 0);
  machine.ports.writePort(1, 0);
  assert.deepEqual(received, [0, 0]);
  assert.deepEqual(machine.output.snapshot(), { lastByte: 0 });
  for (let port = 0; port <= 255; port++) {
    assert.throws(() => machine.ports.readPort(port), /Unconnected input port/);
    if (port !== 1) assert.throws(() => machine.ports.writePort(port, 255), /Unconnected output port/);
  }
  machine.ram.write(1, 99);
  machine.cpu.reset();
  assert.deepEqual(machine.output.snapshot(), { lastByte: 0 });
  machine.reset();
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.deepEqual(received, [0, 0]);
  assert.equal(machine.ram.read(1), 99);
  assert.equal(machine.ram.read(0x105), 0xd3);
});
