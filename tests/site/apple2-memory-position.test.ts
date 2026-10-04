import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../src/components/cpus/generated/6502-cpu.js";
import { create6502Apple2 } from "../../src/machines/generated/6502/apple2.js";
import { createApple2ChangeLog } from "../../site/interactive/apple2-change-log.js";
import { createApple2MemoryPosition } from "../../site/interactive/apple2-memory-position.js";
import type { Apple2MemoryChange } from "../../site/interactive/apple2-inspection.js";

test("memory following keeps its window steady until the target leaves it, and browsing restores fixed mode", () => {
  const machine = create6502Apple2({ firmware: null }), position = createApple2MemoryPosition();
  assert.deepEqual(position.refresh(machine, 0x200), { start: 0x400, target: undefined });
  position.mode = "pc";
  assert.deepEqual(position.refresh(machine, 0x407), { start: 0x400, target: 0x407 });
  assert.equal(position.refresh(machine, 0x47f).start, 0x400);
  assert.equal(position.refresh(machine, 0x48b).start, 0x488);
  assert.equal(position.refresh(machine, 0x487).start, 0x480);
  assert.equal(position.refresh(machine, 0xffff).start, 0xff80);
  assert.equal(position.refresh(machine, 0).start, 0);
  position.browse(0xfffa);
  assert.equal(position.mode, "fixed");
  assert.deepEqual(position.refresh(machine, 0x1234), { start: 0xfffa, target: undefined });
  for (const value of [-1, 0x10000, NaN, 1.5]) assert.throws(() => position.browse(value), RangeError);
});

test("following catches writes earlier in a running batch even with recording disabled", () => {
  const machine = create6502Apple2({ firmware: null });
  // LDA #$55; STA $1234; STA $1234 (unchanged); NOP. Only refresh after all four steps.
  [0xa9, 0x55, 0x8d, 0x34, 0x12, 0x8d, 0x34, 0x12, 0xea].forEach((byte, offset) => machine.ram.write(0x200 + offset, byte));
  machine.cpu = new Cpu6502(machine.memory, { ...machine.cpu.snapshot(), pc: 0x200 });
  const log = createApple2ChangeLog(machine), position = createApple2MemoryPosition();
  log.recording = false;
  for (let step = 0; step < 4; step++) {
    const record = log.capture(() => machine.cpu.step());
    position.observe(machine, log.memoryChanges(record));
  }
  assert.equal(position.refresh(machine, 0x209).start, 0x400, "Fixed mode does not move, but observation continues");
  position.mode = "changes";
  assert.deepEqual(position.refresh(machine, 0x209), { start: 0x1230, target: 0x1234 });
  assert.deepEqual(log.entries(), []);
  position.reset();
  assert.deepEqual(position.refresh(machine, 0x209), { start: 0x1230, target: undefined });
  assert.equal(position.mode, "changes", "Reset forgets the write target, not the navigation preference");
  log.dispose();
});

test("following uses actual write order, ignores net-zero stores and retains the last changed byte across non-writing steps", () => {
  const machine = create6502Apple2({ firmware: null }), position = createApple2MemoryPosition();
  position.mode = "changes";
  const write = (address: number, before: number, after: number): Apple2MemoryChange => ({ region: "ram", address, before, after });
  position.observe(machine, [write(0x1000, 0, 1), write(0x2000, 0, 1), write(0x1000, 1, 2)]);
  assert.equal(position.refresh(machine, 0).target, 0x1000);
  position.observe(machine, [write(0x3000, 0, 1), write(0x4000, 0, 1), write(0x4000, 1, 0)]);
  assert.equal(position.refresh(machine, 0).target, 0x3000);
  position.observe(machine, [write(0x5000, 7, 7)]);
  position.observe(machine, []);
  assert.equal(position.refresh(machine, 0).target, 0x3000);
});

test("following never mistakes hidden Language Card stores or bank switches for visible changes", () => {
  const machine = create6502Apple2({ firmware: null }), position = createApple2MemoryPosition();
  position.mode = "changes";
  const writes: readonly Apple2MemoryChange[] = [
    { region: "bank2", address: 0xd012, before: 0, after: 1 },
    { region: "bank1", address: 0xd012, before: 0, after: 2 },
    { region: "upper", address: 0xe123, before: 0, after: 3 },
  ];
  position.observe(machine, writes);
  assert.equal(position.refresh(machine, 0).target, undefined, "ROM is mapped, so RAM writes behind it are hidden");
  machine.language.read(0);
  assert.equal(position.refresh(machine, 0).target, undefined, "Mapping RAM alone is not a write");
  position.observe(machine, writes);
  assert.deepEqual(position.refresh(machine, 0), { start: 0xe120, target: 0xe123 });
  position.observe(machine, writes.slice(0, 2));
  assert.equal(position.refresh(machine, 0).target, 0xd012, "The last write to a hidden bank cannot replace a visible write at the same address");
  machine.language.read(8);
  assert.equal(position.refresh(machine, 0).target, undefined, "The previous target is no longer visible");
  position.observe(machine, writes.slice(1, 2));
  const before = machine.snapshot();
  machine.language.read = machine.disk.read = () => { throw new Error("Inspection must not operate a device"); };
  assert.equal(position.refresh(machine, 0).target, 0xd012);
  assert.deepEqual(machine.snapshot(), before);
});
