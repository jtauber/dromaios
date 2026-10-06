import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../src/components/cpus/generated/6502-cpu.js";
import { families } from "../../src/components/cpus/semantics/generated/6502.js";
import { instructionCatalogue6502 } from "../../site/6502-instruction-catalogue.js";
import { createApple2DeviceHistory } from "../../site/interactive/apple2-device-history.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { apple2DebugLocation } from "../../site/interactive/apple2-debugger.js";

const instructions = instructionCatalogue6502(Object.values(families).flat());
function program(bytes: number[], capacity?: number) {
  const session = createApple2Session(), { machine } = session, history = createApple2DeviceHistory(instructions, capacity);
  bytes.forEach((byte, index) => machine.ram.write(0x200 + index, byte));
  machine.cpu = new Cpu6502(machine.memory, { ...machine.cpu.snapshot(), pc: 0x200 });
  return { machine, history, step() {
    const before = apple2DebugLocation(machine), record = machine.cpu.step();
    history.observe(record, before); return record;
  } };
}

test("device history retains actual transfers and captured instructions without replaying side effects", () => {
  const { machine, history, step } = program([0xad, 0, 0xc0, 0x8d, 0x10, 0xc0, 0xad, 0x50, 0xc0, 0xad, 0x81, 0xc0]);
  machine.keyboard.offer(65);
  step(); assert.equal(machine.keyboard.snapshot().strobe, true);
  step(); assert.equal(machine.keyboard.snapshot().strobe, false);
  step(); assert.equal(machine.video.snapshot().text, false);
  step(); assert.equal(machine.language.snapshot().prewrite, true);
  const entries = history.entries();
  assert.deepEqual(entries.map(event => [event.caller.address, event.address, event.kind, event.value]), [
    [0x209, 0xc081, "read", 0], [0x206, 0xc050, "read", 0], [0x203, 0xc010, "write", 0xc1], [0x200, 0xc000, "read", 0xc1],
  ]);
  assert.deepEqual(entries.map(event => event.first), [4, 3, 2, 1]);
  const before = machine.snapshot();
  machine.memory.read = () => { throw new Error("History cannot read the bus"); };
  machine.ram.write(0x200, 0xea);
  assert.deepEqual(history.entries().at(-1)!.bytes, [0xad, 0, 0xc0]);
  assert.deepEqual(machine.keyboard.snapshot(), before.keyboard);
  assert.deepEqual(machine.language.snapshot(), before.language);
});

test("identical polling coalesces across ordinary instructions, but changes in value, caller mapping, or opcode remain distinct", () => {
  const { machine, history, step } = program([0x2c, 0, 0xc0, 0x4c, 0, 2]);
  step(); step(); step();
  assert.equal(history.entries().length, 1); assert.equal(history.entries()[0]!.count, 2);
  assert.deepEqual([history.entries()[0]!.first, history.entries()[0]!.last], [1, 3]);
  machine.keyboard.offer(65); step(); const poll = step();
  assert.equal(history.entries().length, 2); assert.equal(history.entries()[0]!.value, 0xc1);
  history.observe(poll, { address: 0x200, space: "bank1" });
  assert.equal(history.entries().length, 3);
  step(); machine.ram.write(0x200, 0xad); step();
  assert.equal(history.entries().length, 4); assert.equal(history.entries()[0]!.bytes[0], 0xad);
});

test("history keeps instruction fetches and read/write ordering, with bounded retention and explicit clear/reset semantics", () => {
  const { machine, history, step } = program([0xee, 0x50, 0xc0], 3); // NMOS INC: read, write original byte, write result.
  const record = step();
  assert.deepEqual(history.entries().map(entry => [entry.kind, entry.value]), [["write", 1], ["write", 0], ["read", 0]]);
  machine.disk.install([0xad, 0x00, 0xc0, ...new Array(253).fill(0)]);
  machine.cpu = new Cpu6502(machine.memory, { ...machine.cpu.snapshot(), pc: 0xc600 });
  step();
  assert.equal(history.accesses, 7); assert.equal(history.discarded, 4);
  assert.deepEqual(history.entries().map(entry => [entry.address, entry.role]), [[0xc000, "read"], [0xc602, "fetch"], [0xc601, "fetch"]]);
  history.clear(); assert.equal(history.accesses, 0); assert.equal(history.discarded, 0); assert.deepEqual(history.entries(), []);
  history.observe(record, { address: 0x200, space: "ram" }); assert.equal(history.entries()[0]!.first, 3);
  history.reset(); history.observe(record, { address: 0x200, space: "ram" }); assert.equal(history.entries()[0]!.first, 1);
  for (const invalid of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => createApple2DeviceHistory(instructions, invalid), RangeError);
});

test("coalesced groups account for discarded accesses and ignore instructions that did not execute", () => {
  const { machine, history, step } = program([0xad, 0, 0xc0, 0x4c, 0, 2], 1);
  step(); step(); step(); step(); machine.keyboard.offer(65); const poll = step();
  assert.equal(history.discarded, 2); assert.equal(history.accesses, 3);
  history.observe({ ...poll, outcome: "unsupported", reason: "opcode" }, { address: 0x200, space: "ram" });
  assert.equal(history.accesses, 3);
});
