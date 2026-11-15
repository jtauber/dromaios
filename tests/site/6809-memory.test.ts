import assert from "node:assert/strict";
import { test } from "node:test";
import { create6809MemoryObservation, stack6809Rows } from "../../site/interactive/6809-memory.js";
import { readCocoStorage } from "../../site/interactive/coco-inspection.js";
import { create6809Coco } from "../../src/machines/generated/6809/coco.js";
import { Cpu6809 } from "../../src/components/cpus/generated/6809-cpu.js";
import { captureMemory } from "../../site/interactive/memory-window.js";

test("tools can share a captured image while holding independent pointers and change histories", () => {
  const ram = new Uint8Array(0x10000), pointers = { s: 0x100, u: 0x200, dp: 0x30 };
  const live = create6809MemoryObservation(), held = create6809MemoryObservation();
  const first = captureMemory(address => ram[address]);
  live.refreshImage(first, pointers); held.refreshImage(first, pointers);
  ram[0x100] = 0x42; pointers.s = 0x101;
  const second = captureMemory(address => ram[address]);
  live.refreshImage(second, pointers);
  assert.deepEqual(live.byte(0x100), { address: 0x100, value: 0x42, before: 0, changed: true });
  assert.equal(held.byte(0x100).value, 0); assert.equal(held.pointer("s"), 0x100);
  ram[0x100] = 0x43;
  assert.equal(live.byte(0x100).value, 0x42, "later hardware changes cannot alter captured bytes");
  held.refreshImage(second, pointers);
  assert.deepEqual(held.byte(0x100), live.byte(0x100));
  live.refreshImage(second, pointers);
  assert.equal(live.byte(0x100).changed, false);
  assert.equal(held.byte(0x100).changed, true, "refreshing one tool cannot clear another's highlights");
});

test("held 6809 observations own pointers and bytes; changes compare physical addresses across page moves", () => {
  const image = new Uint8Array(65536), pointers = { s: 0x200, u: 0xffff, dp: 0x30 };
  image[0x3020] = 0x56; image[0x3120] = 0x78; image[0xffff] = 0x12; image[0] = 0x34;
  const view = create6809MemoryObservation(); view.refresh(address => image[address], pointers);
  assert.equal(view.byte(0x3020).changed, false); assert.equal(view.word(0xffff), 0x1234);
  image[0x3020] = 0x99; pointers.dp = 0x31;
  assert.equal(view.pointer("dp"), 0x30); assert.equal(view.byte(0x3020).value, 0x56);
  view.refresh(address => image[address], pointers);
  assert.deepEqual(view.byte(0x3020), { address: 0x3020, value: 0x99, before: 0x56, changed: true });
  assert.equal(view.pointer("dp"), 0x31); assert.equal(view.byte(0x3120).changed, false);
  view.reset(); image[0x3020] = 0;
  view.refresh(address => image[address], pointers); assert.equal(view.byte(0x3020).changed, false);
  view.refresh(address => address === 0 ? undefined : image[address], pointers);
  assert.equal(view.word(0xffff), undefined); assert.equal(view.byte(0).changed, false);
});

test("S and U windows wrap, preserve odd alignment, and reflect real pushes and pulls in high/low order", () => {
  const machine = create6809Coco({ firmware: null, extended: null });
  const cpu = new Cpu6809(machine.memory, { ...machine.cpu.snapshot(), pc: 0x2000, s: 0x101, u: 0x303, a: 0x12, b: 0x34 });
  [0x34, 0x06, 0x36, 0x06, 0x35, 0x06, 0x37, 0x06].forEach((byte, i) => machine.ram.write(0x2000 + i, byte)); // Push/pull D on each stack.
  const view = create6809MemoryObservation(), read = (address: number) => readCocoStorage(machine, address);
  view.refresh(read, cpu.snapshot());
  cpu.step(); cpu.step(); view.refresh(read, cpu.snapshot());
  assert.equal(view.pointer("s"), 0xff); assert.equal(view.pointer("u"), 0x301);
  for (const pointer of [0xff, 0x301]) {
    assert.equal(view.word(pointer), 0x1234); assert.equal(view.byte(pointer).changed, true);
    const row = stack6809Rows(pointer, 2).find(row => row.offset === 0)!;
    assert.equal(row.address, pointer);
  }
  cpu.step(); cpu.step(); view.refresh(read, cpu.snapshot());
  assert.equal(view.pointer("s"), 0x101); assert.equal(view.pointer("u"), 0x303);
  assert.equal(view.word(0xff), 0x1234, "Pull does not erase RAM or prove an empty-stack boundary");
  assert.equal(view.byte(0xff).changed, false);
  assert.deepEqual(stack6809Rows(0, 2).slice(0, 3), [
    { offset: -2, address: 0xfffe }, { offset: 0, address: 0 }, { offset: 2, address: 2 },
  ]);
  assert.equal(stack6809Rows(0xffff, 1).find(row => row.offset === 1)?.address, 0);
});

test("pointer views observe a CoCo with pending IRQ and held keys without reading its guest bus", () => {
  const machine = create6809Coco({ firmware: null, extended: null }), view = create6809MemoryObservation();
  machine.pias.write(1, 5); machine.pias.setHorizontalSync(false); machine.pias.setKey("A", true);
  assert.equal(machine.pias.irq, true); const before = machine.snapshot();
  machine.memory.read = machine.memory.write = () => { throw new Error("Guest bus accessed"); };
  view.refresh(address => readCocoStorage(machine, address), { s: 0xff00, u: 0xffc0, dp: 0xff });
  for (const address of [0x8000, 0xa000, 0xff00, 0xffc0, 0xffff]) assert.equal(view.byte(address).value, undefined);
  assert.deepEqual(machine.snapshot(), before);
  machine.sam.write(0x1d, 0); // M1: unsupported physical memory configuration.
  view.refresh(address => readCocoStorage(machine, address), machine.cpu.snapshot());
  assert.equal(view.byte(0).value, undefined);
});
