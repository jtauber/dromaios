import assert from "node:assert/strict";
import { test } from "node:test";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { apple2StorageReader } from "../../site/interactive/apple2-inspection.js";
import { memoryValue } from "../../site/interactive/apple2-workspace-values.js";
import { addMemoryWatch, decodeMemoryWatches, sampleMemoryWatches } from "../../site/interactive/apple2-watches.js";

test("saved word widths round-trip while legacy byte watches and stop choices survive", () => {
  const legacy = { address: 0x36, label: "output", stop: ["read"] as const };
  const words = addMemoryWatch([legacy], "36", "output", undefined, 2);
  assert.deepEqual(words, [{ ...legacy, bytes: 2 }]);
  assert.deepEqual(decodeMemoryWatches(JSON.stringify(words)), words);
  assert.deepEqual(decodeMemoryWatches(JSON.stringify([legacy])), [legacy]);
  assert.deepEqual(addMemoryWatch(words, "36", "renamed", "write"), [{ ...legacy, label: "renamed", bytes: 2, stop: ["read", "write"] }]);
  assert.equal(addMemoryWatch(words, "36", "output", undefined, 1)[0]!.bytes, 1);
  for (const bytes of [0, 3, -1, 1.5, true, "2", null]) {
    assert.deepEqual(decodeMemoryWatches(JSON.stringify([{ ...legacy, bytes }])), []);
  }
});

test("word watches require consecutive storage through FFFE and do not wrap FFFF", () => {
  assert.throws(() => addMemoryWatch([], "FFFF", "", undefined, 2), /two consecutive bytes/);
  const last = addMemoryWatch([], "FFFF", "");
  assert.throws(() => addMemoryWatch(last, "FFFF", "", undefined, 2));
  assert.deepEqual(decodeMemoryWatches(JSON.stringify([{ address: 0xffff, label: "", bytes: 2 }])), []);
  assert.equal(addMemoryWatch([], "FFFE", "", undefined, 2)[0]!.address, 0xfffe);
  assert.equal(memoryValue(0xffff, 2, () => { throw new Error("Out-of-range word must not read"); }), undefined);
  const addresses: number[] = [];
  assert.equal(memoryValue(0xff, 2, address => { addresses.push(address); return address === 0xff ? 0x34 : 0x12; }), 0x1234);
  assert.deepEqual(addresses, [0xff, 0x100], "Storage words do not inherit zero-page or JMP-indirect wrapping");
});

test("little-endian samples detect either changed byte and require both bytes to be available", () => {
  const word = { address: 0x36, label: "", bytes: 2 as const };
  const first = sampleMemoryWatches([word], address => address === 0x36 ? 0xf0 : 0xfd)[0]!;
  assert.equal(first.value, 0xfdf0); assert.equal(first.changed, false);
  const previous = new Map([[0x36, first.value]]);
  assert.equal(sampleMemoryWatches([word], address => address === 0x36 ? 0xed : 0xfd, previous)[0]!.changed, true);
  assert.equal(sampleMemoryWatches([word], address => address === 0x36 ? 0xf0 : 0x03, previous)[0]!.changed, true);
  for (const missing of [0x36, 0x37]) {
    const sample = sampleMemoryWatches([word], address => address === missing ? undefined : 0xff, previous)[0]!;
    assert.equal(sample.value, undefined); assert.equal(sample.changed, false);
  }
  assert.equal(sampleMemoryWatches([word], () => 0, new Map([[0x36, undefined]]))[0]!.changed, false);
});

test("word samples use visible physical banks and never read device addresses through the guest bus", () => {
  const { machine } = createApple2Session();
  machine.ram.write(0xbfff, 0x42); machine.bank1.write(0, 0x34); machine.bank1.write(1, 0x12);
  machine.bank2.write(0, 0x78); machine.bank2.write(1, 0x56); machine.keyboard.offer(65);
  machine.language.read(8); const before = machine.snapshot();
  machine.memory.read = machine.keyboard.read = () => { throw new Error("Inspection must not operate hardware"); };
  const word = { address: 0xd000, label: "banked", bytes: 2 as const };
  const read = apple2StorageReader(machine);
  assert.equal(sampleMemoryWatches([word], read)[0]!.value, 0x1234);
  assert.equal(memoryValue(0xbfff, 2, read), undefined);
  assert.equal(memoryValue(0xc00f, 2, read), undefined);
  assert.deepEqual(machine.snapshot(), before);
  machine.language.read(0);
  assert.equal(sampleMemoryWatches([word], apple2StorageReader(machine))[0]!.value, 0x5678);
  assert.equal(sampleMemoryWatches([word], read)[0]!.value, 0x1234, "A held observation retains its selected bank");
});
