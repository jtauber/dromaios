import assert from "node:assert/strict";
import { test } from "node:test";
import { create6809Coco } from "../../src/machines/generated/6809/coco.js";
import { Cpu6809 } from "../../src/components/cpus/generated/6809-cpu.js";
import { stepCoco } from "../../src/machines/6809/coco/runtime.js";
import { createCocoChangeLog } from "../../site/interactive/coco-change-log.js";
import { createCocoWatchHistory } from "../../site/interactive/coco-watch-history.js";
import { createCocoDebugger, cocoDebugLocation } from "../../site/interactive/coco-debugger.js";
import { catalogue6809, state6809 } from "./6809-inspection-fixture.js";

function fixture(bytes: readonly number[], capacity = 500) {
  const machine = create6809Coco({ firmware: null, extended: null });
  machine.cpu = new Cpu6809(machine.memory, state6809({ pc: 0x2000, s: 0x3100, dp: 0 }));
  bytes.forEach((byte, index) => machine.ram.write(0x2000 + index, byte));
  const log = createCocoChangeLog(machine, capacity), history = createCocoWatchHistory(2);
  const debug = createCocoDebugger(() => machine, catalogue6809);
  const step = () => {
    const caller = cocoDebugLocation(machine), record = log.capture(() => debug.capture(() => stepCoco(machine)));
    history.observe(record, caller, debug.watchpoints, log.memoryWrites(record)); return record;
  };
  return { machine, log, history, debug, step };
}

test("CoCo uses the shared change log for registers, flags, PC and ordered big-endian stores", () => {
  const p = fixture([0xcc, 0x80, 0x01, 0xfd, 0x12, 0x10, 0x4f]); // LDD #$8001; STD $1210; CLRA
  p.step(); const stored = p.step(); p.step();
  const entries = p.log.entries();
  assert.deepEqual(entries.map(entry => entry.instruction!.address), [0x2006, 0x2003, 0x2000]);
  assert.deepEqual(entries[0]!.changes, [
    { kind: "register", target: "A", before: 0x80, after: 0, width: 2 },
    { kind: "pc", target: "PC", before: 0x2006, after: 0x2007, width: 4 },
    { kind: "flag", target: "N", before: 1, after: 0, width: 1 },
    { kind: "flag", target: "Z", before: 0, after: 1, width: 1 },
  ]);
  assert.deepEqual(entries[1]!.changes.filter(change => change.kind === "memory"), [
    { kind: "memory", target: "RAM $1210", before: 0, after: 0x80, width: 2 },
    { kind: "memory", target: "RAM $1211", before: 0, after: 1, width: 2 },
  ]);
  assert.equal(entries.flatMap(entry => entry.changes).some(change => change.target === "D"), false, "A/B changes do not appear twice under their D alias");
  p.machine.ram.write(0x2003, 0x12); assert.deepEqual(entries[1]!.instruction!.bytes, [0xfd, 0x12, 0x10]);
  assert.deepEqual(p.log.memoryWrites(stored), [], "Only the latest completed boundary supplies highlights");
});

test("disabled CoCo stops still retain bounded write history with Changes recording off", () => {
  const p = fixture([0x86, 0x55, 0xb7, 0x12, 0x10, 0xb7, 0x12, 0x10, 0x7c, 0x12, 0x10, 0x12]);
  const watch = { address: 0x1210, enabled: false }; p.debug.setWatchpoints([watch]); p.log.recording = false;
  p.step(); p.step(); p.step(); p.step();
  assert.deepEqual(p.log.entries(), []); assert.equal(p.debug.hit, undefined);
  assert.deepEqual(p.history.entries(watch).map(entry => [entry.sequence, entry.caller.address, entry.storage!.before, entry.storage!.after]), [
    [3, 0x2005, 0x55, 0x55], [4, 0x2008, 0x55, 0x56],
  ]);
  assert.deepEqual(p.history.counts(watch), { captured: 3, discarded: 1 });
  p.log.clear(); assert.equal(p.history.counts(watch).captured, 3);
  p.history.clear(); assert.deepEqual(p.history.entries(watch), []); p.log.recording = true; p.step();
  assert.equal(p.log.entries()[0]!.sequence, 1, "Clear log restarts its numbering independently");
  p.history.configure([]); p.history.configure([watch]); assert.equal(p.history.counts(watch).captured, 0);
});

test("CoCo interrupt entry retains all stack effects without inventing an instruction", () => {
  const p = fixture([0x12]);
  const watch = { address: 0x30ff, enabled: true }; p.debug.setWatchpoints([watch]);
  p.machine.cpu = new Cpu6809(p.machine.memory, { ...p.machine.cpu.snapshot(), flags: { ...p.machine.cpu.snapshot().flags, f: false } });
  p.machine.pias.write(0x21, 5); p.machine.pias.setCarrierDetect(false);
  const record = p.step(); assert.equal(record.instruction, null); assert.equal(p.debug.stop?.kind, "watchpoint");
  const entry = p.log.entries()[0]!;
  assert.equal(entry.instruction, undefined); assert.equal(entry.event, "FIRQ"); assert.equal(entry.outcome, "accepted");
  assert.deepEqual(entry.caller, { address: 0x2000, space: "ram" });
  assert.equal(p.log.memoryWrites(record).length, 3, "The complete short frame, including unchanged stores");
  const transfer = p.history.entries(watch)[0]!;
  assert.equal(transfer.event, "FIRQ · accepted"); assert.deepEqual(transfer.bytes, []);
  assert.deepEqual(transfer.storage, { address: 0x30ff, before: 0, after: 0 });
  p.machine.memory.read = () => { throw new Error("History cannot reread hardware"); };
  assert.equal(p.history.entries(watch)[0]!.storage!.after, 0);
});

test("RAM history never records fetches, device/ROM writes or host writes as CPU stores", () => {
  const p = fixture([0x86, 5, 0xb7, 0xff, 0x01, 0xb7, 0xa0, 0, 0xb6, 0x12, 0x10]);
  const watch = { address: 0x1210, enabled: false }; p.debug.setWatchpoints([watch, { address: 0x2000, enabled: false }]);
  p.machine.ram.write(0x1210, 0x44);
  let writes = 0; const write = p.machine.pias.write.bind(p.machine.pias);
  p.machine.pias.write = (address, value) => { writes++; write(address, value); };
  for (let i = 0; i < 4; i++) p.step();
  assert.equal(writes, 1); assert.equal(p.machine.pias.snapshot().pia0.cra, 5);
  assert.deepEqual(p.history.entries(watch), []); assert.deepEqual(p.history.entries({ address: 0x2000 }), []);
  assert.equal(p.log.entries().flatMap(entry => entry.changes).filter(change => change.kind === "memory").length, 0);
});

test("partial failures retain completed RAM effects, while reset and disposal discard stale observations", () => {
  const p = fixture([0xbd, 0x21, 0x00], 2);
  assert.throws(() => p.log.capture(() => { stepCoco(p.machine); throw new Error("After call"); }), /After call/);
  assert.equal(p.log.entries()[0]!.outcome, "interrupted");
  assert.equal(p.log.entries()[0]!.changes.filter(change => change.kind === "memory").length, 2);
  p.machine.ram.write(0x1210, 0x77); assert.equal(p.log.entries().length, 1);
  p.machine.ram.write(0x2100, 0x12); const record = p.log.capture(() => stepCoco(p.machine));
  p.log.reset(); assert.deepEqual(p.log.entries(), []); assert.deepEqual(p.log.memoryWrites(record), []);
  p.log.dispose(); p.log.capture(() => stepCoco(p.machine)); assert.deepEqual(p.log.entries(), []);
});
