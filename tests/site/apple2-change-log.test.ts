import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../src/components/cpus/generated/6502-cpu.js";
import { create6502Apple2 } from "../../src/machines/generated/6502/apple2.js";
import { createApple2ChangeLog } from "../../site/interactive/apple2-change-log.js";
import { createExecutionController } from "../../site/interactive/execution-controller.js";

function example(bytes: readonly number[], capacity = 500) {
  const machine = create6502Apple2({ firmware: null });
  machine.cpu = new Cpu6502(machine.memory, { ...machine.cpu.snapshot(), pc: 0x200 });
  bytes.forEach((byte, index) => machine.ram.write(0x200 + index, byte));
  const log = createApple2ChangeLog(machine, capacity);
  return { machine, log, step: () => log.capture(() => machine.cpu.step()) };
}

test("the change log attributes register, cleared/set flag, PC and memory changes to captured instructions", () => {
  const { machine, log, step } = example([0xa9, 0x80, 0x8d, 0x00, 0x04, 0xee, 0x00, 0x04, 0xa9, 0x00]);
  step(); step(); step(); step();
  const entries = log.entries();
  assert.deepEqual(entries.map(entry => entry.instruction!.address), [0x208, 0x205, 0x202, 0x200]);
  assert.deepEqual(entries[0]!.changes, [
    { kind: "register", target: "A", before: 0x80, after: 0, width: 2 },
    { kind: "pc", target: "PC", before: 0x208, after: 0x20a, width: 4 },
    { kind: "flag", target: "N", before: 1, after: 0, width: 1 },
    { kind: "flag", target: "Z", before: 0, after: 1, width: 1 },
  ]);
  assert.deepEqual(entries[1]!.changes.filter(change => change.kind === "memory"), [
    { kind: "memory", target: "RAM $0400", before: 0x80, after: 0x81, width: 2 },
  ]);
  assert.deepEqual(entries[2]!.changes.filter(change => change.kind === "memory"), [
    { kind: "memory", target: "RAM $0400", before: 0, after: 0x80, width: 2 },
  ]);
  machine.ram.write(0x200, 0xea); // Disassembly must use captured bytes, not current memory.
  assert.deepEqual(entries[3]!.instruction!.bytes, [0xa9, 0x80]);
  assert.equal(log.entries().length, 4, "Host writes outside an instruction are not attributed to it");
});

test("stack writes retain their bus order and separate before values", () => {
  const { machine, log, step } = example([0x20, 0x00, 0x03]);
  machine.ram.write(0x1fe, 0x77); machine.ram.write(0x1ff, 0x88);
  step();
  assert.deepEqual(log.entries()[0]!.changes.filter(change => change.kind === "memory"), [
    { kind: "memory", target: "RAM $01FF", before: 0x88, after: 2, width: 2 },
    { kind: "memory", target: "RAM $01FE", before: 0x77, after: 2, width: 2 },
  ]);
  assert.deepEqual(log.entries()[0]!.changes.find(change => change.target === "SP"),
    { kind: "register", target: "SP", before: 0xff, after: 0xfd, width: 2 });
});

test("Language Card logging observes physical writes behind ROM and labels both banks and common upper RAM", () => {
  const { machine, log, step } = example([0xa9, 0x55, 0x8d, 0x00, 0xd0, 0x8d, 0x00, 0xe0, 0x8d, 0x00, 0xd0]);
  machine.bank1.write(0, 0x11); machine.bank2.write(0, 0x22); machine.upper.write(0, 0x33);
  machine.firmware.read = () => { throw new Error("The log must not read ROM to observe a RAM write"); };
  step(); step(); step();
  machine.language.read(9); machine.language.read(9); // Select bank 1, still reading ROM.
  step();
  assert.equal(machine.language.ramRead(), false);
  assert.deepEqual(log.entries().flatMap(entry => entry.changes.filter(change => change.kind === "memory")), [
    { kind: "memory", target: "LC bank 1 $D000", before: 0x11, after: 0x55, width: 2 },
    { kind: "memory", target: "LC upper $E000", before: 0x33, after: 0x55, width: 2 },
    { kind: "memory", target: "LC bank 2 $D000", before: 0x22, after: 0x55, width: 2 },
  ]);
});

test("unchanged stores, protected RAM, ROM, unmapped addresses and soft switches produce no RAM changes or extra reads", () => {
  const { machine, log, step } = example([0x8d, 0x00, 0x04, 0x8d, 0x00, 0xd0, 0x8d, 0x00, 0xc6,
    0x8d, 0x00, 0xc1, 0x8d, 0x10, 0xc0]);
  machine.language.read(2); // ROM mapped; RAM writes protected.
  machine.keyboard.offer(65);
  let reads = 0, writes = 0;
  const read = machine.keyboard.read.bind(machine.keyboard), write = machine.keyboard.write.bind(machine.keyboard);
  machine.keyboard.read = address => { reads++; return read(address); };
  machine.keyboard.write = (address, value) => { writes++; return write(address, value); };
  for (let i = 0; i < 5; i++) step();
  assert.equal(reads, 0); assert.equal(writes, 1);
  assert.equal(machine.keyboard.snapshot().strobe, false);
  assert.equal(log.entries().flatMap(entry => entry.changes).filter(change => change.kind === "memory").length, 0);
});

test("a running batch records every instruction independently of the twelve-step trace; the ring drops only its oldest entries", () => {
  const { log, step } = example(Array(40).fill(0xea), 20);
  const callbacks: (() => void)[] = [];
  const controller = createExecutionController({ step, canStep: () => true, onChange() {}, batchSize: 35,
    schedule(callback) { callbacks.push(callback); return () => {}; } });
  controller.run(); callbacks.shift()!(); controller.stop();
  assert.equal(controller.records.length, 12);
  assert.deepEqual(log.entries().map(entry => entry.sequence), Array.from({ length: 20 }, (_, i) => 35 - i));
  assert.equal(log.captured, 35); assert.equal(log.discarded, 15);
  log.recording = false; const saved = log.entries(); step(); step();
  assert.deepEqual(log.entries(), saved);
  log.recording = true; step(); assert.equal(log.entries()[0]!.sequence, 38);
  log.clear(); assert.deepEqual(log.entries(), []); assert.equal(log.captured, 0); assert.equal(log.discarded, 0);
  step(); assert.equal(log.entries()[0]!.sequence, 1);
});

test("partial effects remain visible on errors, without attributing later host writes to the failed instruction", () => {
  const { machine, log } = example([0x20, 0x00, 0x03]);
  const failure = new Error("Host failure after a completed store");
  assert.throws(() => log.capture(() => { machine.cpu.step(); throw failure; }), error => error === failure);
  const entry = log.entries()[0]!;
  assert.equal(entry.outcome, "interrupted"); assert.equal(entry.instruction!.address, 0x200);
  assert.deepEqual(entry.instruction!.bytes, []);
  assert.equal(entry.changes.filter(change => change.kind === "memory").length, 2);
  machine.ram.write(0x300, 0xea);
  assert.equal(entry.changes.filter(change => change.kind === "memory").length, 2);
  log.dispose(); log.capture(() => machine.cpu.step());
  assert.equal(log.entries().length, 1);
});

test("unsupported instructions are marked, and invalid history limits are rejected", () => {
  const { machine, log, step } = example([0x02]);
  assert.equal(step().outcome, "unsupported"); assert.equal(log.entries()[0]!.outcome, "unsupported");
  for (const capacity of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => createApple2ChangeLog(machine, capacity), RangeError);
});

test("last-instruction memory observation stays live independently of history recording and clearing", () => {
  const { log, step } = example([0xa9, 0x80, 0x85, 0x10, 0x85, 0x11, 0xe8, 0x02]);
  step(); const first = step();
  assert.deepEqual(log.memoryChanges(first), [{ region: "ram", address: 0x10, before: 0, after: 0x80 }]);
  log.recording = false;
  const second = step();
  assert.deepEqual(log.memoryChanges(second), [{ region: "ram", address: 0x11, before: 0, after: 0x80 }]);
  assert.equal(log.entries().length, 2);
  assert.deepEqual(log.memoryChanges(first), [], "An earlier trace record cannot supply stale highlights");
  assert.deepEqual(log.memoryChanges(undefined), [], "Reset/error views have no completed instruction to highlight");
  log.clear();
  assert.deepEqual(log.memoryChanges(second), [{ region: "ram", address: 0x11, before: 0, after: 0x80 }]);
  assert.deepEqual(log.entries(), []);
  assert.deepEqual(log.memoryChanges(step()), [], "The next instruction replaces the highlighted bytes");
  assert.deepEqual(log.memoryChanges(step()), [], "Unsupported instructions cannot supply highlights");
});
