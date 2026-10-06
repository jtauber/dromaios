import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileDeviceChapter } from "../../src/components/devices/semantics/compile.js";
import { parseMachine } from "../../src/machines/machine-language.js";
import { machineChapterSource } from "../../src/machines/machine-chapter.js";
import { apple2HardwareCatalogue } from "../../site/apple2-hardware-catalogue.js";
import { apple2HardwareState, apple2MemoryMap, apple2DeviceAccess } from "../../site/interactive/apple2-hardware.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";

const file = "src/machines/6502/apple2.md";
const machine = parseMachine(machineChapterSource(readFileSync(file, "utf8"), file), file);
assert.ok("connection" in machine);
const chapters = Object.fromEntries(["apple2-keyboard", "apple2-video", "apple2-language-card"].map(kind => {
  const file = `src/components/devices/specifications/${kind}.md`;
  return [kind, compileDeviceChapter(readFileSync(file, "utf8"), file)];
}));
const catalogue = apple2HardwareCatalogue(machine, chapters);

test("the hardware catalogue covers every address and retains separate declared read and write routes", () => {
  let next = 0;
  for (const region of catalogue.regions) { assert.equal(region.start, next); next += region.size; }
  assert.equal(next, 0x10000);
  assert.equal(catalogue.undriven, 0);
  const state = apple2HardwareState(createApple2Session().machine), map = apple2MemoryMap(catalogue, state);
  const row = (start: number) => map.find(row => row.start === start)!;
  assert.deepEqual(row(0), { start: 0, end: 0xbfff, read: "Main RAM", write: "Main RAM" });
  assert.deepEqual(row(0xd000), { start: 0xd000, end: 0xdfff, read: "ROM absent · $00", write: "LC bank 2" });
  assert.equal(row(0xe000).write, "LC upper RAM");
  assert.equal(row(0xc020).read, "Unmapped · $00");
  assert.equal(row(0xc600).read, "Disk II absent · $00");
  assert.equal(row(0xc600).write, "Discarded");
  assert.equal(apple2MemoryMap(catalogue, { ...state, firmware: true }).find(row => row.start === 0xd000)!.read, "ROM");
});

test("the live map agrees with actual Language Card routing through protection, arming, and bank changes", () => {
  const { machine } = createApple2Session();
  machine.bank1.write(0, 0x11); machine.bank2.write(0, 0x22); machine.upper.write(0, 0x33);
  const cases = [
    { switch: 0xc082, read: "ROM absent · $00", write: "Discarded", value: 0 },
    { switch: 0xc083, read: "LC bank 2", write: "Discarded", value: 0x22 },
    { switch: 0xc083, read: "LC bank 2", write: "LC bank 2", value: 0x22 },
    { switch: 0xc08b, read: "LC bank 1", write: "LC bank 1", value: 0x11 },
    { switch: 0xc088, read: "LC bank 1", write: "Discarded", value: 0x11 },
  ];
  for (const scenario of cases) {
    machine.memory.read(scenario.switch);
    const map = apple2MemoryMap(catalogue, apple2HardwareState(machine));
    const low = map.find(row => row.start === 0xd000)!, upper = map.find(row => row.start === 0xe000)!;
    assert.equal(low.read, scenario.read); assert.equal(low.write, scenario.write);
    assert.equal(machine.memory.read(0xd000), scenario.value);
    assert.equal(upper.write, scenario.write === "Discarded" ? "Discarded" : "LC upper RAM");
    const before = [machine.bank1.read(0), machine.bank2.read(0), machine.upper.read(0)];
    machine.memory.write(0xd000, 0xaa); machine.memory.write(0xe000, 0xbb);
    assert.equal(machine.bank1.read(0), scenario.write === "LC bank 1" ? 0xaa : before[0]);
    assert.equal(machine.bank2.read(0), scenario.write === "LC bank 2" ? 0xaa : before[1]);
    assert.equal(machine.upper.read(0), scenario.write === "Discarded" ? before[2] : 0xbb);
    machine.bank1.write(0, 0x11); machine.bank2.write(0, 0x22); machine.upper.write(0, 0x33);
  }
});

test("hardware observation does not read the guest bus, acknowledge keys, change selectors, or snapshot disk media", () => {
  const { machine } = createApple2Session();
  machine.keyboard.offer(65); machine.language.read(1);
  machine.disk.install(new Array(256).fill(0)); machine.disk.insert(new Dos33Disk(new Uint8Array(Dos33Disk.size)));
  machine.disk.read(9); machine.disk.read(12);
  const before = apple2HardwareState(machine);
  const fail = () => { throw new Error("Inspection touched guest state or copied memory"); };
  machine.memory.read = machine.keyboard.read = machine.video.read = machine.language.read = machine.disk.read = fail;
  machine.disk.snapshot = fail;
  const state = apple2HardwareState(machine), map = apple2MemoryMap(catalogue, state);
  for (let address = 0xc000; address < 0xd000; address++) {
    apple2DeviceAccess(catalogue, address, "read"); apple2DeviceAccess(catalogue, address, "write");
  }
  assert.deepEqual(state, before);
  assert.equal(map.find(row => row.start === 0xc600)!.read, "Disk II bootstrap ROM");
  assert.equal(state.keyboard.strobe, true); assert.equal(state.language.prewrite, true); assert.equal(state.disk.position, 1);
});

test("device descriptions and aliases come from executable chapters, including unbound and unmapped directions", () => {
  const poll = apple2DeviceAccess(catalogue, 0xc000, "read")!, acknowledge = apple2DeviceAccess(catalogue, 0xc010, "write")!;
  assert.match(poll.description, /character and strobe/i); assert.match(acknowledge.description, /strobe|acknowledge/i);
  for (let alias = 0; alias < 16; alias++) {
    assert.deepEqual(apple2DeviceAccess(catalogue, 0xc000 + alias, "read"), poll);
    assert.deepEqual(apple2DeviceAccess(catalogue, 0xc010 + alias, "write"), acknowledge);
  }
  assert.match(apple2DeviceAccess(catalogue, 0xc000, "write")!.description, /Unbound write/);
  assert.equal(apple2DeviceAccess(catalogue, 0xc030, "read")!.device, "unmapped");
  assert.match(apple2DeviceAccess(catalogue, 0xc600, "read")!.description, /bootstrap ROM/);
  assert.match(apple2DeviceAccess(catalogue, 0xc600, "write")!.description, /discarded/);
  assert.equal(apple2DeviceAccess(catalogue, 0xd000, "read"), undefined);
  const chapter = chapters["apple2-keyboard"]!;
  const source = chapter.interface.reads.get(0)!.source;
  const changed = { ...chapter, sources: { ...chapter.sources, [source]: { ...chapter.sources[source]!, name: "Revised authored description" } } };
  const updated = apple2HardwareCatalogue(machine, { ...chapters, "apple2-keyboard": changed });
  assert.equal(apple2DeviceAccess(updated, 0xc005, "read")!.description, "Revised authored description");
});
