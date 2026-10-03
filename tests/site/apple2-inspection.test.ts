import assert from "node:assert/strict";
import { test } from "node:test";
import { Ram } from "../../src/components/memory/ram.js";
import { Apple2LanguageCard } from "../../src/components/devices/generated/apple2-language-card.js";
import { Apple2DiskII } from "../../src/components/devices/apple2-disk-ii.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import { apple2MemoryAddresses, apple2MemoryHighlights, apple2StorageReader } from "../../site/interactive/apple2-inspection.js";
import type { Apple2MemoryChange } from "../../site/interactive/apple2-inspection.js";
import { createApple2Session, apple2ScreenKey } from "../../site/interactive/apple2-session.js";

function storage() {
  const ram = new Ram(0xc000), firmware = new Ram(0x3000), bank1 = new Ram(0x1000), bank2 = new Ram(0x1000), upper = new Ram(0x2000);
  for (const [memory, value] of [[ram, 0x11], [firmware, 0x22], [bank1, 0x33], [bank2, 0x44], [upper, 0x55]] as const) {
    memory.write(0, value); memory.write(memory.size - 1, value + 1);
  }
  return { ram, firmware, bank1, bank2, upper, language: new Apple2LanguageCard(), disk: new Apple2DiskII() };
}

test("Apple II storage inspection follows both Language Card banks and preserves the captured selection", () => {
  const machine = storage();
  const rom = apple2StorageReader(machine);
  for (const [address, expected] of [[0, 0x11], [0xbfff, 0x12], [0xd000, 0x22], [0xffff, 0x23]]) assert.equal(rom(address!), expected);
  machine.language.read(0); // Bank 2 mapped for reading.
  const second = apple2StorageReader(machine);
  assert.equal(second(0xd000), 0x44); assert.equal(second(0xdfff), 0x45);
  assert.equal(second(0xe000), 0x55); assert.equal(second(0xffff), 0x56);
  machine.language.read(8); // Bank 1, same upper memory.
  const first = apple2StorageReader(machine);
  assert.equal(first(0xd000), 0x33); assert.equal(first(0xdfff), 0x34);
  assert.equal(first(0xe000), 0x55); assert.equal(first(0xffff), 0x56);
  assert.equal(rom(0xd000), 0x22); assert.equal(second(0xd000), 0x44);
  for (const address of [-1, 0x10000, 1.5, NaN]) assert.throws(() => first(address), RangeError);
});

test("inspection exposes installed card ROM but never operates a device or consumes a disk byte", () => {
  const machine = storage();
  assert.equal(apple2StorageReader(machine)(0xc600), undefined);
  machine.disk.install(Array.from({ length: 256 }, (_, i) => i));
  machine.disk.insert(new Dos33Disk(new Uint8Array(Dos33Disk.size)));
  machine.disk.read(9); machine.disk.read(12);
  machine.language.read(1); // Pending write-enable read must remain pending.
  const before = { disk: machine.disk.snapshot(), language: machine.language.snapshot() };
  machine.disk.read = machine.language.read = () => { throw new Error("Inspection operated a device"); };
  const read = apple2StorageReader(machine);
  for (let address = 0xc000; address < 0xd000; address++) {
    assert.equal(read(address), address >= 0xc600 && address < 0xc700 ? address & 255 : undefined);
  }
  assert.deepEqual(apple2MemoryAddresses(0xc00e, 4).map(read), Array(4).fill(undefined));
  assert.deepEqual(apple2MemoryAddresses(0xc0e8, 8).map(read), Array(8).fill(undefined));
  assert.deepEqual({ disk: machine.disk.snapshot(), language: machine.language.snapshot() }, before);
  machine.disk.eject();
  assert.equal(apple2StorageReader(machine)(0xc6ff), 255, "Eject removes media, not the card ROM");
});

test("memory windows stop at FFFF and reject invalid bounds", () => {
  assert.deepEqual(apple2MemoryAddresses(0xfffa, 128), [0xfffa, 0xfffb, 0xfffc, 0xfffd, 0xfffe, 0xffff]);
  assert.deepEqual(apple2MemoryAddresses(0, 10), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(apple2MemoryAddresses(0, 0), []);
  for (const value of [-1, 1.5, NaN, Infinity, 0x10001]) {
    assert.throws(() => apple2MemoryAddresses(value, 8), RangeError);
    assert.throws(() => apple2MemoryAddresses(0, value), RangeError);
  }
});

test("memory highlights follow the visible physical bank, without reading memory or operating switches", () => {
  const machine = storage();
  const writes: readonly Apple2MemoryChange[] = [
    { region: "ram", address: 0x10, before: 1, after: 2 },
    { region: "bank1", address: 0xd000, before: 0x11, after: 0x55 },
    { region: "bank2", address: 0xd000, before: 0x22, after: 0x66 },
    { region: "upper", address: 0xe000, before: 0x33, after: 0x77 },
  ];
  machine.ram.read = machine.bank1.read = machine.bank2.read = machine.upper.read = machine.firmware.read = () => { throw new Error("Unexpected memory read"); };
  assert.deepEqual([...apple2MemoryHighlights(machine, writes).values()], [writes[0]], "ROM must not be highlighted for hidden RAM writes");
  machine.language.read(0);
  assert.deepEqual([...apple2MemoryHighlights(machine, writes).values()], [writes[0], writes[2], writes[3]]);
  machine.language.read(8);
  const before = machine.language.snapshot();
  machine.language.read = machine.disk.read = () => { throw new Error("Unexpected device read"); };
  assert.deepEqual([...apple2MemoryHighlights(machine, writes).values()], [writes[0], writes[1], writes[3]]);
  assert.deepEqual(machine.language.snapshot(), before);
  assert.equal(apple2MemoryHighlights(machine, []).size, 0, "Changing the bank is not a write to its bytes");
});

test("memory highlights compare instruction boundaries when a byte is written more than once", () => {
  const changes = apple2MemoryHighlights(storage(), [
    { region: "ram", address: 0x100, before: 0x10, after: 0x20 },
    { region: "ram", address: 0x101, before: 0x30, after: 0x40 },
    { region: "ram", address: 0x100, before: 0x20, after: 0 },
    { region: "ram", address: 0x101, before: 0x40, after: 0x30 },
  ]);
  assert.deepEqual([...changes.values()], [{ region: "ram", address: 0x100, before: 0x10, after: 0 }]);
});

test("screen typing accepts Apple II keys while preserving browser shortcuts and composition", () => {
  const modifiers = { ctrlKey: false, metaKey: false, altKey: false, isComposing: false };
  for (const [key, expected] of [["a", 65], ["A", 65], ["2", 50], ["+", 43], [" ", 32], ["Enter", 13], ["Backspace", 8], ["ArrowRight", 21]] as const) {
    assert.equal(apple2ScreenKey({ ...modifiers, key }), expected);
  }
  assert.equal(apple2ScreenKey({ ...modifiers, key: "c", ctrlKey: true }), 3);
  for (const key of ["é", "ß", "Tab", "ArrowUp", "Shift"]) assert.equal(apple2ScreenKey({ ...modifiers, key }), undefined);
  for (const modifier of ["ctrlKey", "metaKey", "altKey", "isComposing"]) {
    assert.equal(apple2ScreenKey({ ...modifiers, key: "a", [modifier]: true }), undefined);
  }
});

test("a browser session exposes real RAM, stack, and devices before firmware is supplied", () => {
  const session = createApple2Session(), { machine } = session;
  const before = machine.snapshot();
  const read = apple2StorageReader(machine);
  assert.equal(session.hasFirmware, false);
  assert.equal(machine.cpu.snapshot().sp, 0xff, "No reset-vector reads or stack adjustment yet");
  assert.equal(read(0), 0); assert.equal(read(0x100), 0); assert.equal(read(0xbfff), 0);
  assert.equal(read(0xc600), undefined); assert.equal(read(0xd000), undefined); assert.equal(read(0xffff), undefined);
  assert.deepEqual(apple2MemoryAddresses(0xcff8, 16).map(read), Array(16).fill(undefined));
  session.send([65]);
  assert.throws(() => session.step(), /Install firmware/);
  assert.throws(() => session.reset(), /Install firmware/);
  assert.deepEqual(machine.snapshot(), before);
  assert.equal(session.pendingInput, 1);
  machine.language.read(0); // RAM mapped at D000 is still available, even without ROM.
  assert.equal(apple2StorageReader(machine)(0xd000), 0);
  machine.ram.write(0x400, 0x5a);
  assert.equal(read(0x400), 0x5a);
  session.powerOn();
  assert.notEqual(session.machine, machine);
  assert.equal(session.pendingInput, 0);
  assert.equal(session.machine.ram.read(0x400), 0); assert.equal(session.hasFirmware, false);
  assert.equal(session.machine.cpu.snapshot().sp, 0xff);
});
