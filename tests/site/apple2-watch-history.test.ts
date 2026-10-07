import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../src/components/cpus/generated/6502-cpu.js";
import { families } from "../../src/components/cpus/semantics/generated/6502.js";
import { instructionCatalogue6502 } from "../../site/6502-instruction-catalogue.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { createApple2WatchHistory } from "../../site/interactive/apple2-watch-history.js";
import { createApple2ChangeLog } from "../../site/interactive/apple2-change-log.js";
import { apple2DebugLocation } from "../../site/interactive/apple2-debugger.js";
import type { MemoryWatch } from "../../site/interactive/apple2-watches.js";

const instructions = instructionCatalogue6502(Object.values(families).flat());
const word: MemoryWatch = { address: 0x36, bytes: 2, label: "output" };
function program(bytes: readonly number[], capacity?: number) {
  const { machine } = createApple2Session(), history = createApple2WatchHistory(instructions, capacity);
  bytes.forEach((byte, index) => machine.ram.write(0x200 + index, byte));
  machine.cpu = new Cpu6502(machine.memory, { ...machine.cpu.snapshot(), pc: 0x200 });
  const log = createApple2ChangeLog(machine); log.recording = false;
  let watches: readonly MemoryWatch[] = [];
  return { machine, history, log, watch(values: readonly MemoryWatch[]) { watches = values; }, step() {
    const caller = apple2DebugLocation(machine), record = log.capture(() => machine.cpu.step());
    history.observe(record, caller, watches, log.memoryWrites(record)); return record;
  } };
}

test("watch history records both halves once, excludes fetches, and works with Changes recording off", () => {
  const p = program([0xa9, 0x03, 0x85, 0x37, 0xa5, 0x36, 0x6c, 0x36, 0]);
  p.watch([word, { address: 0x37, label: "overlapping" }, { address: 0x200, bytes: 2, label: "instruction" }]);
  p.step(); p.step(); p.step(); p.step();
  const events = p.history.entries(word);
  assert.deepEqual(events.map(e => [e.sequence, e.caller.address, e.address, e.kind, e.value]), [
    [2, 0x202, 0x37, "write", 3], [3, 0x204, 0x36, "read", 0],
    [4, 0x206, 0x36, "read", 0], [4, 0x206, 0x37, "read", 3],
  ]);
  assert.deepEqual(events[0]!.storage, { region: "ram", address: 0x37, before: 0, after: 3 });
  assert.deepEqual(p.history.entries({ address: 0x200, bytes: 2 }), []);
  assert.deepEqual(p.log.entries(), []);
  p.machine.ram.write(0x202, 0xea);
  assert.deepEqual(events[0]!.bytes, [0x85, 0x37], "Later code changes cannot rewrite the captured instruction");
});

test("read-modify-write history preserves the read, unchanged dummy write, and final write with exact old values", () => {
  const p = program([0xe6, 0x37]); p.machine.ram.write(0x37, 0xff); p.watch([word]); p.step();
  assert.deepEqual(p.history.entries(word).map(e => [e.kind, e.value, e.storage?.before, e.storage?.after]), [
    ["read", 0xff, undefined, undefined], ["write", 0xff, 0xff, 0xff], ["write", 0, 0xff, 0],
  ]);
});

test("device and protected writes have captured bus values without invented RAM changes or repeated hardware access", () => {
  const p = program([0xad, 0, 0xc0, 0x8d, 0x10, 0xc0, 0x8d, 0, 0xd0]);
  const keyboard = { address: 0xc000, label: "key" }, strobe = { address: 0xc010, label: "strobe" }, rom = { address: 0xd000, label: "ROM" };
  p.watch([keyboard, strobe, rom]); p.machine.keyboard.offer(65); p.machine.language.read(2);
  let reads = 0;
  const read = p.machine.keyboard.read.bind(p.machine.keyboard);
  p.machine.keyboard.read = address => { reads++; return read(address); };
  p.step(); p.step(); p.step();
  p.machine.memory.read = () => { throw new Error("History must not replay the bus"); };
  assert.equal(p.history.entries(keyboard)[0]!.value, 0xc1); assert.equal(reads, 1);
  for (const target of [strobe, rom]) {
    const entry = p.history.entries(target)[0]!;
    assert.equal(entry.value, 0xc1); assert.equal(entry.storage, undefined);
  }
  assert.equal(p.machine.keyboard.snapshot().strobe, false);
});

test("hidden Language Card writes retain their physical bank even while ROM is mapped", () => {
  const p = program([0xa9, 0x55, 0x8d, 0, 0xd0, 0x8d, 0, 0xd0, 0x8d, 0, 0xe0]);
  const banked = { address: 0xd000, label: "banked" }, upper = { address: 0xe000, label: "upper" };
  p.watch([banked, upper]); p.step(); p.step();
  p.machine.language.read(9); p.machine.language.read(9); p.step(); p.step();
  assert.deepEqual(p.history.entries(banked).map(e => e.storage), [
    { region: "bank2", address: 0xd000, before: 0, after: 0x55 },
    { region: "bank1", address: 0xd000, before: 0, after: 0x55 },
  ]);
  assert.equal(p.history.entries(upper)[0]!.storage?.region, "upper");
  assert.equal(p.machine.language.ramRead(), false);
});

test("history only covers watched intervals, reports eviction, and distinguishes Clear from a fresh execution history", () => {
  const p = program([0xa5, 0x36, 0xa5, 0x37, 0xa5, 0x36, 0xa5, 0x37, 0xa5, 0x36], 2);
  p.step(); p.watch([word]); p.step(); p.step(); const record = p.step();
  assert.equal(p.history.counts(word).captured, 3); assert.equal(p.history.counts(word).discarded, 1);
  assert.deepEqual(p.history.entries(word).map(e => e.sequence), [3, 4]);
  p.watch([]); p.step(); assert.equal(p.history.counts(word).captured, 0);
  p.history.clear(); assert.deepEqual(p.history.entries(word), []); assert.equal(p.history.counts(word).discarded, 0);
  const caller = { address: record.instruction.address, space: "ram" };
  p.history.observe(record, caller, [word], []); assert.equal(p.history.entries(word)[0]!.sequence, 6);
  p.history.reset(); p.history.observe(record, caller, [word], []);
  assert.equal(p.history.entries(word)[0]!.sequence, 1);
  p.history.observe({ ...record, outcome: "unsupported", reason: "opcode" }, caller, [word], []);
  assert.equal(p.history.counts(word).captured, 1);
  for (const invalid of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => createApple2WatchHistory(instructions, invalid), RangeError);
});

test("each watch retains its own history; changing width preserves only accesses that were actually captured", () => {
  const p = program([0xa5, 0x36, 0xa5, 0x37, 0xa5, 0x32, 0xa5, 0x32, 0xa5, 0x32, 0xa5, 0x37], 2);
  const byte = { ...word, bytes: 1 as const }, busy = { address: 0x32, label: "busy" };
  p.watch([byte, busy]); for (let i = 0; i < 5; i++) p.step();
  assert.equal(p.history.entries(byte).length, 1); assert.equal(p.history.counts(byte).discarded, 0);
  assert.deepEqual(p.history.counts(busy), { captured: 3, discarded: 1 });
  p.watch([word, busy]); p.step();
  assert.deepEqual(p.history.entries(word).map(e => [e.sequence, e.address]), [[1, 0x36], [6, 0x37]]);
  assert.equal(p.history.entries(byte).length, 1, "Narrowing only changes the selected range");
  p.history.configure([busy]); p.history.configure([word, busy]);
  assert.deepEqual(p.history.entries(word), [], "Removing and re-adding a watch starts a new capture");
});
