import assert from "node:assert/strict";
import { test } from "node:test";
import { Ram } from "../../src/components/memory/ram.js";
import { createLessonsAltairMemory } from "../../src/machines/generated/lessons/altair-memory.js";
import { createAltairMemoryPanel } from "../../site/interactive/altair-panel.js";

function setSwitches(panel: ReturnType<typeof createAltairMemoryPanel>, value: number): void {
  for (let bit = 0; bit < 16; bit++) {
    if ((panel.switches ^ value) & (1 << bit)) panel.toggleSwitch(bit);
  }
}

test("the Altair lesson supplies fresh zero-filled RAM and independent switches and selected address", () => {
  const { ram } = createLessonsAltairMemory();
  assert.equal(ram.size, 0x10000);
  for (let address = 0; address < ram.size; address++) assert.equal(ram.read(address), 0);
  const panel = createAltairMemoryPanel(ram);
  assert.deepEqual([panel.switches, panel.address, panel.data], [0, 0, 0]);
  for (let bit = 0; bit < 16; bit++) {
    panel.toggleSwitch(bit);
    assert.equal(panel.switches, 2 ** (bit + 1) - 1);
    assert.deepEqual([panel.address, panel.data], [0, 0]);
  }
  for (const bit of [-1, 16, 0.5, NaN, Infinity]) {
    assert.throws(() => panel.toggleSwitch(bit), RangeError);
    assert.equal(panel.switches, 0xffff);
  }
  assert.throws(() => createAltairMemoryPanel(new Ram(256)), RangeError);
  panel.examine();
  panel.deposit();
  assert.deepEqual([panel.address, panel.data], [0xffff, 255]);
  const fresh = createLessonsAltairMemory();
  const freshPanel = createAltairMemoryPanel(fresh.ram);
  assert.notEqual(fresh.ram, ram);
  assert.deepEqual([freshPanel.switches, freshPanel.address, freshPanel.data], [0, 0, 0]);
  assert.equal(fresh.ram.read(0xffff), 0);
  assert.equal(ram.read(0xffff), 255);
});

test("the lesson deposits 41 at 3 and 42 at 4, then examines them without moving switches or changing RAM", () => {
  const { ram } = createLessonsAltairMemory();
  const panel = createAltairMemoryPanel(ram);
  setSwitches(panel, 3);
  assert.deepEqual([panel.address, panel.data], [0, 0]);
  panel.examine();
  assert.deepEqual([panel.switches, panel.address, panel.data], [3, 3, 0]);
  setSwitches(panel, 41);
  assert.deepEqual([panel.address, panel.data, ram.read(41)], [3, 0, 0]);
  panel.deposit();
  assert.deepEqual([panel.switches, panel.address, panel.data, ram.read(41)], [41, 3, 41, 0]);
  setSwitches(panel, 42);
  panel.depositNext();
  assert.deepEqual([panel.switches, panel.address, panel.data], [42, 4, 42]);
  setSwitches(panel, 3);
  panel.examine();
  assert.deepEqual([panel.switches, panel.address, panel.data], [3, 3, 41]);
  panel.examineNext();
  assert.deepEqual([panel.switches, panel.address, panel.data], [3, 4, 42]);
  for (let address = 0; address < ram.size; address++) {
    assert.equal(ram.read(address), address === 3 ? 41 : address === 4 ? 42 : 0, `address ${address}`);
  }
});

test("EXAMINE uses all sixteen switches while DEPOSIT uses only the low byte and the already selected address", () => {
  const { ram } = createLessonsAltairMemory();
  const panel = createAltairMemoryPanel(ram);
  setSwitches(panel, 0x1234);
  panel.examine();
  for (let byte = 0; byte < 256; byte++) {
    setSwitches(panel, 0xa500 + byte);
    panel.deposit();
    assert.deepEqual([panel.address, panel.data, ram.read(0x1234)], [0x1234, byte, byte]);
    assert.equal(ram.read(0xa500 + byte), 0);
  }
  ram.write(0xa5ff, 72);
  panel.examine();
  assert.deepEqual([panel.switches, panel.address, panel.data], [0xa5ff, 0xa5ff, 72]);
  ram.write(0xa5ff, 73);
  assert.equal(panel.data, 73); // The lights read RAM, not a second copy of its byte.
});

test("both NEXT operations advance before accessing memory and wrap after FFFF", () => {
  for (const action of ["examineNext", "depositNext"] as const) {
    const { ram } = createLessonsAltairMemory();
    const panel = createAltairMemoryPanel(ram);
    ram.write(0xffff, 11);
    ram.write(0, 22);
    ram.write(1, 33);
    setSwitches(panel, 0xffff);
    panel.examine();
    setSwitches(panel, 0xab2a);
    panel[action]();
    assert.deepEqual([panel.switches, panel.address, panel.data], [0xab2a, 0, action === "depositNext" ? 42 : 22]);
    panel[action]();
    assert.deepEqual([panel.switches, panel.address, panel.data], [0xab2a, 1, action === "depositNext" ? 42 : 33]);
    assert.equal(ram.read(0xffff), 11);
    assert.equal(ram.read(0), action === "depositNext" ? 42 : 22);
    assert.equal(ram.read(0xab2a), 0);
  }
});
