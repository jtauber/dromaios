import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { create8088PcXt, romImages } from "../../src/machines/generated/8088/pc-xt.js";
import { Cpu8088 } from "../../src/components/cpus/generated/8088-cpu.js";
import { RomImage } from "../../src/machines/rom-image.js";
import { createXtSession, stepXtSessionCpu } from "../../site/interactive/xt-session.js";
import { XtKeyboard } from "../../site/interactive/xt-keyboard.js";
import { createXtDebugger, describeXtWriteHit, parseXtDebugAddress } from "../../site/interactive/xt-debugger.js";
import { createXtIoTrace } from "../../site/interactive/xt-io-trace.js";
import { createXtChangeLog, createXtWatchHistory } from "../../site/interactive/xt-history.js";
import { encodeStoredXtCheckpoint, decodeStoredXtCheckpoint } from "../../site/interactive/xt-checkpoint-storage.js";
import type { XtCheckpoint } from "../../site/interactive/xt-rom-guide.js";
import { xtCatalogue, xtRomGuide } from "./xt-inspection-fixture.js";

function fixture(writing = false) {
  const machine = create8088PcXt({ bios: null, basic: null, font: null }), { io, ram } = machine;
  machine.cpu = new Cpu8088(machine.memory, { ...machine.cpu.snapshot(), cs: 0, ip: 0x2000 });
  // The CPU writes the same byte after DMA, so attribution cannot be inferred from address alone.
  [0xc6, 6, 0, 0x30, 0x99].forEach((byte, i) => ram.write(0x2000 + i, byte));
  const disk = new Uint8Array(360 * 1024); disk[512] = 0xa6;
  ram.write(0x3000, 0x71); io.setDiskette(disk, { writable: writing });
  io.write(0xf2, 0x1c); io.advanceOscillatorTicks(29324); io.write(0xf5, 8); io.read(0xf5); io.read(0xf5);
  for (const [port, value] of [[4, 0], [4, 0x30], [5, 0], [5, 0], [0x0b, writing ? 0x4a : 0x46], [0x0a, 2]] as const) io.write(port, value);
  for (const byte of [writing ? 0xc5 : 0xe6, 0, 0, 0, 2, 2, 9, 0x2a, 0xff]) io.write(0xf5, byte);
  io.advanceOscillatorTicks(470);
  return machine;
}

test("DMA2 inspection is detached, side-effect free, and omits media copies and status reads", t => {
  const machine = fixture(), before = machine.snapshot();
  t.mock.method(machine.io, "snapshot", () => assert.fail("Copied the board/media"));
  t.mock.method(machine.io, "read", () => assert.fail("Read a device port"));
  t.mock.method(machine.memory, "read", () => assert.fail("Read the bus"));
  for (let i = 0; i < 10; i++) {
    const state = machine.io.disketteState();
    assert.equal(state.dreq, true); assert.equal(state.dma.count[2], 0); assert.equal(state.diskette.byte_offset, 0);
    assert.equal(state.status, 0x10); assert.equal(state.page, 0);
    (state.dma.address as unknown as number[])[2] = 1; (state.diskette.parameters as unknown as number[])[3] = 9;
  }
  t.mock.restoreAll(); assert.deepEqual(machine.snapshot(), before);
});

test("DMA records, watchpoints and history distinguish the DMA byte from a following CPU store", () => {
  for (const writing of [false, true]) {
    const machine = fixture(writing), keys = new XtKeyboard(), trace = createXtIoTrace(); trace.recording = true;
    const debug = createXtDebugger(() => machine), log = createXtChangeLog(machine, xtCatalogue.storage), history = createXtWatchHistory();
    debug.setWatchpoints([{ address: 0x3000, enabled: true }]);
    debug.setReadWatchpoints([{ address: 0x3000, enabled: true }]); debug.run();
    const record = log.capture(() => debug.capture(() => stepXtSessionCpu(machine, keys)));
    trace.observe(record, machine.io.clock.ticks); history.observe(record, debug.watchpoints, log.memoryWrites(record));
    assert.deepEqual(trace.entries()[0]!.transfer, { kind: "dma", channel: 2, address: 0x3000,
      value: writing ? 0x71 : 0xa6, direction: writing ? "memory-to-disk" : "disk-to-memory", offset: 512, terminal: true, oscillatorTicks: 15 });
    assert.match(describeXtWriteHit(debug.hit!), writing ? /^Instruction/ : /^DMA2/);
    assert.equal(debug.readHit, undefined); // The CPU only stores here, even when DMA reads the same byte.
    assert.deepEqual(history.entries({ address: 0x3000 }).map(e => e.event), writing ? [undefined] : ["DMA2 before CPU boundary", undefined]);
    assert.deepEqual(log.entries()[0]!.changes.filter(c => c.kind === "memory").map(c => c.target), writing ? ["RAM $03000"] : ["DMA2 · RAM $03000", "RAM $03000"]);
    assert.equal(machine.ram.read(0x3000), 0x99);
    assert.equal(machine.io.disketteState().dma.terminal & 4, 4);
    assert.equal(machine.io.disketteState().dma.terminal & 4, 4); // Inspection did not consume TC.
    log.dispose(); debug.dispose();
  }
});

test("DMA event stops work without recording and temporary requests expire or cancel", () => {
  const machine = fixture(), debug = createXtDebugger(() => machine, 2), keys = new XtKeyboard();
  debug.runToEvent({ kind: "dma", address: 0x3000 });
  debug.capture(() => stepXtSessionCpu(machine, keys));
  assert.equal(debug.stop?.kind, "event"); assert.equal(debug.eventHit?.event.kind, "dma");
  assert.match(debug.stop!.detail!, /before the CPU boundary/);
  debug.runToEvent({ kind: "dma", address: 0x3001 });
  while (!debug.beforeStep()) debug.capture(() => stepXtSessionCpu(machine, keys));
  assert.equal(debug.stop?.kind, "limit");
  debug.run(); assert.equal(debug.request, undefined); assert.equal(debug.eventHit, undefined);
  debug.dispose();
});

const optional = { skip: !(process.env.XT_BIOS_ROM && process.env.XT_BASIC_ROM && process.env.XT_CGA_ROM)
  && "Set the three XT firmware paths for the original BIOS DMA walkthrough." };
test("original BIOS sector read follows the chapter, replays from byte 256, and agrees with unobserved execution", optional, async () => {
  const image = (slot: keyof typeof romImages, path: string) => RomImage.verify(readFileSync(path), romImages[slot],
    async bytes => createHash("sha256").update(bytes).digest("hex"));
  const bindings = { bios: await image("bios", process.env.XT_BIOS_ROM!), basic: await image("basic", process.env.XT_BASIC_ROM!),
    font: await image("font", process.env.XT_CGA_ROM!) };
  const session = createXtSession(bindings), disk = new Uint8Array(360 * 1024);
  disk.set(Uint8Array.from({ length: 512 }, (_, i) => (i * 13 + (i >>> 8) * 7 + 0x5a) & 255));
  disk.set([0xfa, 0xf4]); disk.set([0x55, 0xaa], 510); // Original CLI; HLT witness sector, never a bundled ROM.
  session.insertDisk("DMA-WITNESS.IMG", disk); session.powerOn("quick");
  const debug = createXtDebugger(() => session.machine), trace = createXtIoTrace();
  const tour = xtRomGuide.walkthroughs.find(tour => tour.id === "bios-sector-read")!;
  let count = 0;
  function step() { const record = debug.capture(() => session.step()); trace.observe(record, session.machine.io.clock.ticks); count++; return record; }
  function reach(index: number) {
    const point = tour.steps[index] as XtCheckpoint;
    if (point.event) debug.runToEvent(point.event); else debug.runTo(parseXtDebugAddress(point.execution!));
    while (!debug.beforeStep()) step();
    assert.equal(debug.stop?.kind, point.event ? "event" : "target", point.title);
  }
  reach(0); trace.recording = true;
  const start = session.snapshot(), started = count;
  reach(1); const programmed = session.machine.io.disketteState();
  assert.equal(programmed.dma.address[2], 0x7c00); assert.equal(programmed.dma.count[2], 511); assert.equal(programmed.dma.mode[2], 0x44);
  reach(2);
  const saved = await encodeStoredXtCheckpoint(session.snapshot()), halfway = count, savedSequence = trace.captured;
  assert.deepEqual(session.machine.snapshot().ram.slice(0x7c00, 0x7d00), [...disk.slice(0, 256)]);
  assert.equal(session.machine.io.disketteState().dma.address[2], 0x7d00);
  assert.equal(session.machine.io.disketteState().dma.count[2], 255);
  assert.equal(session.machine.io.disketteState().diskette.byte_offset, 256);
  reach(3); assert.equal(session.machine.io.disketteState().dma.terminal & 4, 4);
  assert.equal(session.machine.io.disketteState().dma.count[2], 0xffff);
  assert.equal(session.machine.io.disketteState().diskette.result_left, 7);
  reach(4); assert.equal(session.machine.io.interruptState().pic.isr & 0x40, 0x40);
  reach(5); assert.equal(session.machine.io.interruptState().pic.isr & 0x40, 0);
  assert.equal(session.machine.ram.read(0x43e) & 0x80, 0x80);
  reach(6); const end = session.snapshot(), finished = count;
  assert.deepEqual(end.hardware.ram.slice(0x7c00, 0x7e00), [...disk.slice(0, 512)]);
  assert.equal(end.hardware.cpu.ax >>> 8, 0); assert.equal(end.hardware.cpu.flags.cf, false);
  assert.equal(end.hardware.io.diskette.phase, 0); assert.equal(end.hardware.io.pic.isr & 0x40, 0);
  const entries = trace.entries(), transfers = entries.flatMap(e => e.transfer.kind === "dma" ? [e.transfer] : []);
  assert.equal(transfers.length, 512); assert.equal(trace.discarded, 0);
  transfers.forEach((transfer, i) => assert.deepEqual([transfer.address, transfer.offset, transfer.value, transfer.terminal], [0x7c00 + i, i, disk[i], i === 511]));
  assert.ok(entries.some(e => e.transfer.kind === "acknowledge" && e.transfer.value === 14));
  assert.equal(entries.filter(e => e.sequence > savedSequence && e.transfer.kind === "input" && e.transfer.port === 0x3f5).length, 7);
  const remaining = entries.filter(e => e.sequence > savedSequence).map(({ sequence, ...e }) => e);
  session.restore(await decodeStoredXtCheckpoint(saved)); debug.reset(); trace.clear();
  for (let i = halfway; i < finished; i++) step();
  assert.deepEqual(session.snapshot(), end);
  assert.deepEqual(trace.entries().map(({ sequence, ...e }) => e), remaining);
  assert.equal(trace.entries().filter(e => e.transfer.kind === "dma").length, 256);
  const plain = createXtSession(bindings); plain.restore(start);
  for (let i = started; i < finished; i++) plain.step();
  assert.deepEqual(plain.snapshot(), end);
  reach(7); debug.step(); step(); assert.equal(session.machine.cpu.snapshot().pc, 0x7c00);
  debug.dispose();
});
