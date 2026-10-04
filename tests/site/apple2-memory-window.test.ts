import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryViewport, captureMemory } from "../../site/interactive/apple2-memory-window.js";
import { apple2StorageReader } from "../../site/interactive/apple2-inspection.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";

test("scrolling both row widths covers every byte without reading outside the 16-bit address space", () => {
  for (const width of [8, 16] as const) {
    for (let row = 0; row < 0x10000 / width; row++) {
      const view = memoryViewport(row * 20, 113, width, 20);
      assert.equal(view.address, row * width);
      assert.ok(view.start <= view.address && view.start + view.length > view.address);
      assert.ok(view.start >= 0 && view.start + view.length <= 0x10000);
      assert.ok(view.length <= 10 * width, "Only visible rows plus the margin are rendered");
      assert.equal(view.totalHeight, 0x10000 / width * 20);
    }
    assert.equal(memoryViewport(1e9, 113, width, 20).start + memoryViewport(1e9, 113, width, 20).length, 0x10000);
    assert.equal(memoryViewport(-20, 0, width, 20).address, 0);
  }
});

test("the scrolled memory image is detached and never reads I/O or changes mapping", () => {
  const { machine } = createApple2Session();
  machine.ram.write(0x400, 0x41); machine.language.read(1);
  const before = machine.snapshot();
  machine.memory.read = machine.disk.read = machine.language.read = () => { throw new Error("Guest device access"); };
  const image = captureMemory(apple2StorageReader(machine));
  assert.equal(image.length, 65536); assert.equal(image[0x400], 0x41);
  for (let address = 0xc000; address <= 0xffff; address++) assert.equal(image[address], -1);
  assert.deepEqual(machine.snapshot(), before);
  machine.ram.write(0x400, 0x42); assert.equal(image[0x400], 0x41);
});
