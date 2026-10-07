import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { editApple2Register } from "../../site/interactive/apple2-register-edit.js";
import { addMemoryWatch, decodeMemoryWatches, sampleMemoryWatches } from "../../site/interactive/apple2-watches.js";
import { createWorkspacePosition, monitorWorkspace, memoryValue } from "../../site/interactive/apple2-workspace-values.js";
import { apple2StorageReader } from "../../site/interactive/apple2-inspection.js";
import type { Apple2MemoryChange } from "../../site/interactive/apple2-inspection.js";
import type { MemoryLabel } from "../../site/interactive/apple2-explorer.js";

const { labels }: { labels: readonly MemoryLabel[] } = JSON.parse(readFileSync("docs/software/apple2p-rom.md", "utf8").match(/```json\n([\s\S]*?)```/)![1]!);

test("register edits preserve the whole machine except the requested register and remain connected to its bus", () => {
  const session = createApple2Session(), { machine } = session;
  session.send([65]); machine.keyboard.offer(66); machine.language.read(1);
  machine.ram.write(0x200, 0xe8); // INX
  const parts = { ...machine }, before = machine.snapshot();
  const read = machine.memory.read.bind(machine.memory), write = machine.memory.write.bind(machine.memory);
  machine.memory.read = machine.memory.write = () => { throw new Error("Editing accessed the bus"); };
  for (const [register, value] of [["a", "ff"], ["x", "$2A"], ["y", "80"], ["sp", "FE"], ["pc", "0200"]] as const) {
    editApple2Register(machine, register, value);
  }
  assert.deepEqual(machine.snapshot(), { ...before, cpu: { ...before.cpu, a: 255, x: 42, y: 128, sp: 254, pc: 512 } });
  for (const name of ["ram", "keyboard", "video", "firmware", "language", "bank1", "bank2", "upper", "disk", "memory"] as const) {
    assert.equal(machine[name], parts[name]);
  }
  assert.equal(session.pendingInput, 1);
  machine.memory.read = read; machine.memory.write = write;
  machine.cpu.step(); assert.equal(machine.cpu.snapshot().x, 43);
  assert.equal(machine.snapshot().cpu.x, 43, "machine snapshots follow the replacement CPU");
});

test("invalid register edits are atomic and reject overflow, partial parsing, negatives, and decimal-like notation", () => {
  const { machine } = createApple2Session();
  for (const text of ["100", "-1", "0x10", "1z", "", "1.5", "$", "FF00"]) {
    const cpu = machine.cpu, before = machine.snapshot();
    assert.throws(() => editApple2Register(machine, "a", text), RangeError);
    assert.equal(machine.cpu, cpu); assert.deepEqual(machine.snapshot(), before);
  }
  assert.throws(() => editApple2Register(machine, "pc", "10000"), RangeError);
});

test("watches validate persisted addresses, update duplicate labels, and compare only available samples", () => {
  let watches = addMemoryWatch([], "$0028", " text pointer ");
  watches = addMemoryWatch(watches, "28", "BASL");
  watches = addMemoryWatch(watches, "C010", "keyboard strobe");
  assert.deepEqual(decodeMemoryWatches(JSON.stringify(watches)), watches);
  assert.equal(watches.length, 2);
  assert.equal(watches[0]!.label, "BASL");
  for (const invalid of [null, "no", "null", "{}", '[{"address":-1,"label":"x"}]', '[{"address":1.5,"label":"x"}]']) {
    assert.deepEqual(decodeMemoryWatches(invalid), []);
  }
  assert.equal(decodeMemoryWatches(JSON.stringify([...watches, ...watches])).length, 2);
  assert.throws(() => addMemoryWatch(watches, "10000", ""), RangeError);
  const sample = sampleMemoryWatches(watches, address => address === 0x28 ? 0x80 : undefined, new Map([[0x28, 0x40], [0xc010, 1]]));
  assert.equal(sample[0]!.changed, true); assert.equal(sample[0]!.before, 0x40);
  assert.equal(sample[1]!.value, undefined); assert.equal(sample[1]!.changed, false);
  assert.equal(sampleMemoryWatches(watches, () => 1)[0]!.changed, false);
});

test("Monitor names group only explicitly declared little-endian words and do not operate devices", () => {
  const { machine } = createApple2Session(), entries = monitorWorkspace(labels);
  const bas = entries.find(entry => entry.address === 0x28)!;
  assert.equal(bas.name, "BASL/BASH"); assert.equal(bas.bytes, 2);
  assert.equal(entries.some(entry => entry.address === 0x29), false);
  assert.equal(entries.find(entry => entry.address === 0x24)?.bytes, 1);
  machine.ram.write(0x28, 0x80); machine.ram.write(0x29, 4);
  machine.keyboard.offer(65); machine.language.read(1);
  const before = machine.snapshot();
  machine.memory.read = machine.keyboard.read = machine.language.read = () => { throw new Error("Inspector operated a device"); };
  const read = apple2StorageReader(machine);
  assert.equal(memoryValue(bas.address, bas.bytes, read), 0x480);
  assert.equal(memoryValue(0x28, 2, address => address === 0x28 ? 0 : undefined), undefined);
  const samples = sampleMemoryWatches([{ address: 0xc010, label: "" }, { address: 0x28, label: "" }], read);
  assert.equal(samples[0]!.value, undefined); assert.equal(samples[1]!.value, 0x80);
  assert.deepEqual(machine.snapshot(), before);
});

test("named workspace following retains the latest changed entry, including either byte of a word", () => {
  const position = createWorkspacePosition(monitorWorkspace(labels));
  const write = (address: number, before: number, after: number): Apple2MemoryChange => ({ region: "ram", address, before, after });
  assert.equal(position.target, undefined);
  position.observe([write(0x29, 0, 5)]);
  assert.equal(position.target, 0x28, "The high byte follows the paired BASL/BASH row");
  position.observe([]);
  position.observe([write(0x200, 0, 1), write(0x00, 0, 1)]);
  assert.equal(position.target, 0x28, "Non-writing instructions and unnamed bytes retain the last named target");
  position.observe([write(0x24, 0, 1), write(0x28, 0, 1), write(0x24, 1, 2)]);
  assert.equal(position.target, 0x24, "Use write order, not address order");
  position.observe([write(0x28, 1, 2), write(0x25, 0, 1), write(0x25, 1, 0)]);
  assert.equal(position.target, 0x28, "Ignore a byte restored within the instruction");
  position.observe([write(0x25, 3, 3), { ...write(0x24, 0, 1), region: "bank1" }]);
  assert.equal(position.target, 0x28, "Unchanged or non-main-RAM writes cannot move the view");
  position.reset(); assert.equal(position.target, undefined);
});
