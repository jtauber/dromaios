import assert from "node:assert/strict";
import { test } from "node:test";
import { create8088PcXt } from "../../src/machines/generated/8088/pc-xt.js";
import { Cpu8088 } from "../../src/components/cpus/generated/8088-cpu.js";
import { XtKeyboard } from "../../site/interactive/xt-keyboard.js";
import { stepXtSessionCpu } from "../../site/interactive/xt-session.js";
import { createXtDiskActivity } from "../../site/interactive/xt-disk-activity.js";
import { xtDisketteCommand, xtDisketteResult } from "../../site/interactive/xt-diskette-decode.js";

function fixture(writing = false, start = 0x24000, count = 1024) {
  let machine = create8088PcXt({ bios: null, basic: null, font: null });
  const { io } = machine, keys = new XtKeyboard();
  io.setDiskette(Uint8Array.from({ length: 360 * 1024 }, (_, i) => i & 255));
  io.write(0xf2, 0x1c); io.advanceOscillatorTicks(29324); io.write(0xf5, 8); io.read(0xf5); io.read(0xf5);
  for (const [port, value] of [[4, start & 255], [4, start >>> 8 & 255], [5, count - 1 & 255], [5, count - 1 >>> 8],
    [0x81, start >>> 16], [11, writing ? 0x4a : 0x46], [10, 2]]) io.write(port!, value!);
  const activity = createXtDiskActivity(() => machine.io, 3);
  function program(bytes: readonly number[]) {
    bytes.forEach((byte, i) => machine.ram.write(0x2000 + i, byte));
    machine.cpu = new Cpu8088(machine.memory, { ...machine.cpu.snapshot(), cs: 0, ip: 0x2000, dx: 0x3f5 }, { ports: machine.ports });
  }
  const command = [writing ? 0xc5 : 0xe6, 0, 0, 0, 1, 2, 9, 0x2a, 0xff];
  program([...command.flatMap(byte => [0xb0, byte, 0xee]), 0xeb, 0xfe]);
  function step() { return activity.capture(() => stepXtSessionCpu(machine, keys)); }
  function until(done: () => boolean) {
    for (let i = 0; i < 30000; i++) { if (done()) return; step(); }
    assert.fail("Disk transfer did not reach the expected boundary");
  }
  function drain() { program([...Array(7).fill(0xec), 0xeb, 0xfe]); for (let i = 0; i < 7; i++) step(); }
  return { get machine() { return machine; }, activity, step, until, program, drain,
    restore: (state: ReturnType<typeof machine.snapshot>) => { machine = create8088PcXt({ bios: null, basic: null, font: null }, state); activity.reset(); } };
}

test("sector activity groups actual DMA spans and decodes a complete two-sector read", () => {
  const f = fixture();
  f.until(() => f.activity.entries()[0]?.bytes === 1024);
  let op = f.activity.entries()[0]!;
  assert.equal(op.command, 0xe6); assert.equal(op.continued, false); assert.equal(op.state, "result");
  assert.deepEqual(op.parameters, [0, 0, 0, 1, 2, 9, 0x2a, 0xff]);
  assert.deepEqual(op.sectors.map(s => [s.offset, s.firstAddress, s.lastAddress, s.bytes, s.terminal]),
    [[0, 0x24000, 0x241ff, 512, false], [512, 0x24200, 0x243ff, 512, true]]);
  assert.deepEqual(op.result, [0, 0, 0, 0, 0, 3, 2]); assert.equal(op.consumed, 0);
  assert.match(xtDisketteResult(op.command, op.result), /Normal termination.*0\/0\/3\/2/);
  f.drain(); op = f.activity.entries()[0]!;
  assert.equal(op.state, "complete"); assert.equal(op.consumed, 7);
  f.activity.dispose();
});

test("write protection produces a decoded error with zero DMA bytes and leaves the disk intact", () => {
  const f = fixture(true), before = f.machine.io.exportDiskette();
  f.until(() => f.activity.entries()[0]?.state === "result");
  const op = f.activity.entries()[0]!;
  assert.equal(op.bytes, 0); assert.deepEqual(op.sectors, []); assert.deepEqual(op.result, [0x40, 2, 0, 0, 0, 1, 2]);
  assert.match(xtDisketteResult(op.command, op.result), /Abnormal termination · write-protected/);
  f.drain(); assert.deepEqual(f.machine.io.exportDiskette(), before);
  assert.equal(f.activity.entries()[0]!.state, "complete"); f.activity.dispose();
});

test("restoration starts an explicitly partial observation and reproduces the remaining sector spans", () => {
  const f = fixture(); f.until(() => f.activity.entries()[0]?.bytes === 256);
  const saved = f.machine.snapshot();
  f.until(() => f.activity.entries()[0]?.bytes === 1024); f.drain(); const end = f.machine.snapshot();
  f.restore(saved);
  assert.equal(f.activity.entries()[0]!.continued, true); assert.equal(f.activity.entries()[0]!.bytes, 0);
  f.until(() => f.activity.entries()[0]?.bytes === 768); f.drain();
  assert.deepEqual(f.machine.snapshot(), end);
  assert.deepEqual(f.activity.entries()[0]!.sectors.map(s => [s.firstByte, s.lastByte, s.bytes, s.firstAddress]), [[256, 511, 256, 0x24100], [0, 511, 512, 0x24200]]);
  f.activity.dispose();
});

test("a 64 KiB DMA wrap splits RAM spans without inventing a different disk sector", () => {
  const f = fixture(false, 0x2ff00, 512); f.until(() => f.activity.entries()[0]?.bytes === 512);
  assert.deepEqual(f.activity.entries()[0]!.sectors.map(s => [s.offset, s.firstAddress, s.lastAddress, s.bytes]),
    [[0, 0x2ff00, 0x2ffff, 256], [0, 0x20000, 0x200ff, 256]]); f.activity.dispose();
});

test("pausing capture cannot join unobserved bytes, and bounded history and copies stay independent", () => {
  const f = fixture(); f.until(() => f.activity.entries()[0]?.bytes === 256);
  f.activity.record(false); const revision = f.activity.revision;
  for (let i = 0; i < 100; i++) f.step();
  assert.equal(f.activity.revision, revision);
  f.activity.record(true); assert.equal(f.activity.entries().at(-1)!.continued, true);
  f.until(() => f.activity.entries().at(-1)?.state === "result"); f.drain();
  for (let i = 0; i < 6; i++) {
    f.program([0xb0, 8, 0xee, 0xec, 0xec]); for (let n = 0; n < 4; n++) f.step();
  }
  assert.equal(f.activity.entries().length, 3); assert.ok(f.activity.discarded >= 3);
  const entries = f.activity.entries(); (entries[0]!.result as number[])[0] = 99;
  assert.notEqual(f.activity.entries()[0]!.result[0], 99); f.activity.dispose();
});

test("command and status descriptions distinguish data, control and error results", () => {
  assert.equal(xtDisketteCommand(0x46), "Read Data"); assert.equal(xtDisketteCommand(0xc5), "Write Data");
  assert.equal(xtDisketteCommand(0x4a), "Read ID"); assert.equal(xtDisketteCommand(8), "Sense Interrupt Status");
  assert.match(xtDisketteResult(8, [0x20, 3]), /seek end · PCN 3/);
  assert.match(xtDisketteResult(4, [0x78]), /write-protected · track zero/);
  assert.match(xtDisketteResult(0xe6, [0x40, 4, 0x10, 2, 0, 1, 2]), /no data · wrong cylinder/);
});

test("checkpoints during command and result phases preserve protocol position without stale command attribution", () => {
  const f = fixture(); f.until(() => f.activity.entries()[0]?.parameters.length === 4);
  const parameters = f.machine.snapshot(); f.restore(parameters);
  assert.deepEqual(f.activity.entries()[0]!.parameters, [0, 0, 0, 1]);
  f.until(() => f.activity.entries()[0]?.bytes === 1024);
  f.program([...Array(7).fill(0xec), 0xeb, 0xfe]);
  for (let i = 0; i < 3; i++) f.step();
  const result = f.machine.snapshot(); f.restore(result);
  assert.equal(f.activity.entries()[0]!.consumed, 3);
  for (let i = 0; i < 4; i++) f.step();
  assert.equal(f.activity.entries()[0]!.consumed, 7); assert.equal(f.activity.entries()[0]!.state, "complete");
  f.program([0xb0, 8, 0xee]); f.step(); f.step();
  assert.equal(f.activity.entries().at(-1)!.command, 8);
  f.activity.reset();
  assert.equal(f.activity.entries()[0]!.command, undefined);
  assert.deepEqual(f.activity.entries()[0]!.parameters, []);
  f.activity.dispose();
});

test("uncaptured accesses break continuity and a captured controller reset interrupts the active command", () => {
  const f = fixture(); f.until(() => f.activity.entries()[0]?.bytes === 256);
  f.machine.io.read(0xf5); // Even an out-of-phase data read must not silently bridge an uncaptured access.
  assert.equal(f.activity.entries()[0]!.state, "interrupted"); f.step();
  assert.equal(f.activity.entries().at(-1)!.continued, true);
  f.program([0xba, 0xf2, 3, 0xb0, 0, 0xee]); f.step(); f.step(); f.step();
  assert.equal(f.activity.entries().at(-1)!.state, "interrupted");
  assert.match(f.activity.entries().at(-1)!.note!, /Controller reset/);
  f.activity.dispose();
});
