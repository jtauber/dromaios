import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../src/components/cpus/generated/6502-cpu.js";
import { create6502Apple2 } from "../../src/machines/generated/6502/apple2.js";
import { Apple2Video } from "../../src/components/devices/generated/apple2-video.js";
import { Ram } from "../../src/components/memory/ram.js";
import { apple2ScreenCell, createApple2ScreenWrites } from "../../site/interactive/apple2-screen-inspection.js";
import { createApple2ChangeLog } from "../../site/interactive/apple2-change-log.js";
import { apple2DebugLocation } from "../../site/interactive/apple2-debugger.js";
import { addMemoryWatch } from "../../site/interactive/apple2-watches.js";

// Row starts from the hardware's interleaved display layout, independent of the generated view.
const rows = [0x400, 0x480, 0x500, 0x580, 0x600, 0x680, 0x700, 0x780,
  0x428, 0x4a8, 0x528, 0x5a8, 0x628, 0x6a8, 0x728, 0x7a8,
  0x450, 0x4d0, 0x550, 0x5d0, 0x650, 0x6d0, 0x750, 0x7d0];

test("screen inspection follows all text cells on both physical pages and decodes every character byte", () => {
  const ram = new Ram(0xc000), video = new Apple2Video();
  for (const page of [1, 2]) {
    video.write(page === 1 ? 4 : 5, 0);
    rows.forEach((start, row) => {
      for (let column = 0; column < 40; column++) {
        const address = start + column + (page - 1) * 0x400;
        const byte = (row * 40 + column) & 0xff; ram.write(address, byte);
        const cell = apple2ScreenCell(ram, video, row, column)!;
        assert.equal(cell.address, address); assert.equal(cell.page, page); assert.equal(cell.byte, byte);
        assert.equal(cell.attribute, byte < 64 ? "inverse" : byte < 128 ? "flashing" : "normal");
        assert.equal(cell.character, String.fromCharCode((byte & 63) < 32 ? (byte & 63) + 64 : byte & 63));
      }
    });
  }
});

test("graphics rows and invalid coordinates never read RAM or masquerade as text cells", () => {
  const video = new Apple2Video(), unreadable = { read() { throw new Error("Must not read"); } };
  for (const [row, column] of [[-1, 0], [24, 0], [0, -1], [0, 40], [NaN, 0], [0, 1.5]]) {
    assert.equal(apple2ScreenCell(unreadable, video, row!, column!), undefined);
  }
  for (const hires of [false, true]) {
    video.write(0, 0); video.write(hires ? 7 : 6, 0);
    for (let row = 0; row < 24; row++) assert.equal(apple2ScreenCell(unreadable, video, row, 0), undefined);
    video.write(3, 0);
    for (let row = 0; row < 20; row++) assert.equal(apple2ScreenCell(unreadable, video, row, 0), undefined);
    for (let row = 20; row < 24; row++) assert.equal(apple2ScreenCell({ read: () => 0xc1 }, video, row, 0)!.character, "A");
    video.write(2, 0);
  }
});

test("last screen writers include unchanged and RMW stores, retain both pages, and outlive log recording and clearing", () => {
  const machine = create6502Apple2({ firmware: null });
  machine.cpu = new Cpu6502(machine.memory, { ...machine.cpu.snapshot(), pc: 0x200 });
  const bytes = [0xa9, 0xc1, 0x8d, 0, 4, 0x8d, 0, 8, 0x8d, 0, 4, 0xee, 0, 4, 0x02];
  bytes.forEach((byte, index) => machine.ram.write(0x200 + index, byte));
  const log = createApple2ChangeLog(machine, 1), screen = createApple2ScreenWrites();
  const step = () => {
    const caller = apple2DebugLocation(machine), record = log.capture(() => machine.cpu.step());
    screen.observe(record, caller, log.memoryWrites(record)); return record;
  };
  step(); step(); step(); log.recording = false; log.clear();
  const unchanged = step();
  assert.deepEqual(log.memoryChanges(unchanged), []);
  assert.deepEqual(screen.at(0x400), { sequence: 4, caller: { address: 0x208, space: "ram" }, bytes: [0x8d, 0, 4], before: 0xc1, after: 0xc1 });
  const modified = step();
  assert.deepEqual(log.memoryWrites(modified).map(({ before, after }) => [before, after]), [[0xc1, 0xc1], [0xc1, 0xc2]]);
  assert.equal(log.memoryChanges(modified).length, 1);
  assert.equal(screen.at(0x400)!.caller.address, 0x20b); assert.equal(screen.at(0x400)!.after, 0xc2);
  assert.equal(screen.at(0x800)!.caller.address, 0x205); assert.deepEqual(log.entries(), []);
  machine.ram.write(0x20b, 0xea);
  assert.deepEqual(screen.at(0x400)!.bytes, [0xee, 0, 4], "Captured instruction, even if current code changes");
  step(); assert.equal(screen.at(0x400)!.sequence, 5, "Unsupported instruction cannot replace provenance");
  assert.deepEqual(log.memoryWrites(undefined), []);
  screen.reset(); assert.equal(screen.at(0x400), undefined); assert.equal(screen.at(0x800), undefined);
  log.dispose();
});

test("screen write history ignores other RAM and incomplete instructions, and reset restarts numbering", () => {
  const machine = create6502Apple2({ firmware: null });
  machine.cpu = new Cpu6502(machine.memory, { ...machine.cpu.snapshot(), pc: 0x200 });
  machine.ram.write(0x200, 0xea);
  const record = machine.cpu.step(), screen = createApple2ScreenWrites(), caller = { address: 0x200, space: "ram" };
  const writes = [0x3ff, 0x400, 0xbff, 0xc00].map(address => ({ region: "ram" as const, address, before: 0, after: 1 }));
  screen.observe(record, caller, [...writes, { region: "bank1", address: 0x500, before: 0, after: 1 }]);
  assert.equal(screen.at(0x3ff), undefined); assert.equal(screen.at(0xc00), undefined); assert.equal(screen.at(0x500), undefined);
  assert.equal(screen.at(0xbff)!.after, 1);
  screen.observe({ ...record, outcome: "unsupported", reason: "opcode" }, caller, [{ region: "ram", address: 0x400, before: 1, after: 2 }]);
  assert.equal(screen.at(0x400)!.after, 1);
  caller.space = "rom"; assert.equal(screen.at(0x400)!.caller.space, "ram");
  screen.reset(); screen.observe(record, caller, writes); assert.equal(screen.at(0x400)!.sequence, 1);
});

test("adding a screen write watch enables W idempotently without losing a label or existing stop modes", () => {
  const original = [{ address: 0x400, label: "Selected cell", stop: ["read", "change"] as const }];
  const once = addMemoryWatch(original, "0400", original[0]!.label, "write");
  assert.deepEqual(once, [{ address: 0x400, label: "Selected cell", stop: ["read", "change", "write"] }]);
  assert.deepEqual(addMemoryWatch(once, "0400", "Selected cell", "write"), once);
  assert.deepEqual(original[0]!.stop, ["read", "change"]);
});
