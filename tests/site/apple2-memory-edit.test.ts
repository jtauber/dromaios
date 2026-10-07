import assert from "node:assert/strict";
import { test } from "node:test";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { apple2EditableMemory, editApple2Memory } from "../../site/interactive/apple2-memory-edit.js";
import { createApple2ChangeLog } from "../../site/interactive/apple2-change-log.js";

test("paused RAM edits address physical storage without executing the CPU or touching devices", () => {
  const session = createApple2Session(), { machine } = session;
  session.send([65]); machine.keyboard.offer(66);
  const before = machine.snapshot(), expectedRam = [...before.ram];
  machine.memory.read = machine.memory.write = () => { throw new Error("Debugger edit accessed the guest bus"); };
  for (const address of [0, 0x24, 0x1ff, 0x400, 0xbfff]) {
    const target = apple2EditableMemory(machine)(address, 0);
    assert.deepEqual(editApple2Memory(machine, target, " $c1 "), { region: "ram", address, before: 0, after: 0xc1 });
    assert.equal(machine.ram.read(address), 0xc1);
    expectedRam[address] = 0xc1;
  }
  assert.deepEqual(machine.snapshot(), { ...before, ram: expectedRam });
  assert.equal(session.pendingInput, 1);
});

test("Language Card edits use the displayed read bank, including write-protected RAM, and leave its latches alone", () => {
  const { machine } = createApple2Session();
  for (const [select, region] of [[0, "bank2"], [8, "bank1"]] as const) {
    machine.language.read(select); // Read RAM, CPU writes protected.
    const language = machine.language.snapshot(); assert.equal(language.ram_write, false);
    const target = apple2EditableMemory(machine)(0xd000, 0);
    assert.equal(target.region, region);
    editApple2Memory(machine, target, "55"); assert.equal(machine[region].read(0), 0x55);
    assert.deepEqual(machine.language.snapshot(), language);
  }
  for (const address of [0xe000, 0xffff]) {
    editApple2Memory(machine, apple2EditableMemory(machine)(address, 0), "AA");
    assert.equal(machine.upper.read(address - 0xe000), 0xaa);
  }
});

test("ROM, bootstrap and device addresses stay read-only even with CPU writes enabled behind ROM", () => {
  const { machine } = createApple2Session(), before = machine.snapshot();
  assert.equal(machine.language.snapshot().ram_write, true);
  for (const address of [0xc000, 0xc010, 0xc080, 0xc600, 0xcfff, 0xd000, 0xffff]) {
    assert.throws(() => apple2EditableMemory(machine)(address, 0), /read-only/);
  }
  assert.deepEqual(machine.snapshot(), before);
});

test("malformed, stale, replaced-machine and remapped edits fail before any mutation; equal bytes are a no-op", () => {
  const { machine } = createApple2Session();
  const target = apple2EditableMemory(machine)(0x24, 0), before = machine.snapshot();
  for (const text of ["100", "-1", "0x10", "1z", "", "1.5", "$", "FF00"]) {
    assert.throws(() => editApple2Memory(machine, target, text), RangeError);
    assert.deepEqual(machine.snapshot(), before);
  }
  assert.equal(editApple2Memory(machine, target, "00"), undefined);
  assert.throws(() => editApple2Memory(createApple2Session().machine, target, "01"), /changed/);
  machine.ram.write(0x24, 1);
  assert.throws(() => editApple2Memory(machine, target, "02"), /changed/); assert.equal(machine.ram.read(0x24), 1);
  machine.language.read(0); const bank2 = apple2EditableMemory(machine)(0xd000, 0);
  machine.language.read(8); const mapped = machine.snapshot();
  assert.throws(() => editApple2Memory(machine, bank2, "02"), /bank has changed/);
  assert.deepEqual(machine.snapshot(), mapped);
  machine.language.read(2);
  assert.throws(() => editApple2Memory(machine, bank2, "02"), /read-only/);
  for (const address of [-1, 0x10000, 1.5, NaN]) assert.throws(() => apple2EditableMemory(machine)(address, 0), RangeError);
});

test("user edits have no invented instruction address, remain visible with recording off, and use the bounded event log", () => {
  const { machine } = createApple2Session(), log = createApple2ChangeLog(machine, 2);
  log.recording = false;
  for (let before = 0; before < 3; before++) {
    const change = editApple2Memory(machine, apple2EditableMemory(machine)(0x24, before), String(before + 1))!;
    assert.equal(log.entries().length, Math.min(before, 2), "A physical edit is not automatically attributed to the CPU");
    log.recordEdit(change);
  }
  assert.deepEqual(log.entries()[0], { source: "user", sequence: 3, instruction: undefined, outcome: "edited",
    changes: [{ kind: "memory", target: "RAM $0024", before: 2, after: 3, width: 2 }] });
  assert.equal(log.entries().length, 2); assert.equal(log.discarded, 1);
  assert.deepEqual(log.memoryChanges(undefined), []);
});
