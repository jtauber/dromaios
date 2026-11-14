import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoSavedState } from "../../site/interactive/coco-saved-state.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import { cocoScreenText } from "../../site/interactive/coco-inspection.js";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/6809/coco-disk.js";
import { cocoBinaryFile } from "../helpers/coco-disk.js";
import { cocoDiskSize } from "../../src/machines/6809/coco/disk-controller.js";

const needsRoms = !(process.env.COCO_ROM && process.env.COCO_EXTENDED_ROM && process.env.COCO_DISK_ROM)
  && "Set COCO_ROM, COCO_EXTENDED_ROM and COCO_DISK_ROM for the SAVEM/LOADM/EXEC round trip.";

test("SAVEM spans three granules; exported LOADM restores all 5120 bytes and EXEC uses the saved entry, with write/read checkpoint replay", { skip: needsRoms }, async () => {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware, digest);
  const extended = await RomImage.verify(readFileSync(process.env.COCO_EXTENDED_ROM!), romImages.extended, digest);
  const dos = await RomImage.verify(readFileSync(process.env.COCO_DISK_ROM!), romImages.dos, digest);
  const session = createCocoSession(firmware, extended, dos), storage = new Map<string, string>();
  const saved = cocoSavedState(() => ({ getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } }), session.machine.clock.hertz!);
  const original = new Uint8Array(cocoDiskSize).fill(0xff);
  session.mountDisk("blank.dsk", original); session.machine.disk.writableCopy();
  const expected = Array.from({ length: 0x1400 }, (_, i) => (i + (i >> 8)) & 255);
  expected.splice(0x1200, 19, 0xb6, 0x50, 0x0e, 0xbb, 0x59, 0x01, 0xbb, 0x63, 0xff,
    0xb7, 0x64, 0x00, 0x86, 0x4d, 0xad, 0x9f, 0xa0, 0x02, 0x39);
  const programBytes = () => Array.from({ length: expected.length }, (_, i) => session.machine.ram.read(0x5000 + i));
  let direction: "read" | "write" | undefined, transfers = new Map<number, number>();
  const transferred = () => [...transfers.values()].reduce((a, b) => a + b, 0);
  function step() {
    const disk = direction ? session.machine.disk.inspect() : undefined;
    const record = session.step();
    // DATA also carries seek targets. Count only actual sector transfers, using
    // the phase before this boundary can retire the sector's final byte.
    if (!disk || !(direction === "read" ? disk.phase === 3 : disk.phase === 6 || disk.phase === 7)) return;
    if (direction) for (const access of record.accesses) if (access.kind === direction && access.address === 0xff4b) {
      if (disk.cylinder === 17) continue; // Count file data, separately from directory/FAT traffic.
      const sector = disk.cylinder * 18 + disk.sector - 1;
      transfers.set(sector, (transfers.get(sector) ?? 0) + 1);
    }
  }
  function run(count: number) { for (let i = 0; i < count; i++) step(); }
  function until(done: () => boolean, limit = 3_000_000, sampleEvery = 1): number {
    for (let i = 0; i < limit; i++) { if (i % sampleEvery === 0 && done()) return i; step(); }
    assert.fail(`CoCo did not reach its stop: ${cocoScreenText(session.machine)}`);
  }
  const prompt = () => session.inputSettled && session.machine.disk.inspect().phase === 0 && /\nOK(?:\n█)?$/.test(cocoScreenText(session.machine));
  // Screen decoding is needed only at a prompt; transfer stops still sample every boundary.
  const untilPrompt = (limit?: number) => until(prompt, limit, 256);
  function line(text: string, limit?: number) {
    session.send(cocoTextInput(text + "\n")); until(() => session.inputSettled); run(20_000);
    if (!/^\d/.test(text)) untilPrompt(limit);
    assert.doesNotMatch(cocoScreenText(session.machine), /\?[A-Z/]+ ERROR/);
  }
  function boot() { run(720_000); assert.match(cocoScreenText(session.machine), /^DISK EXTENDED COLOR BASIC 1\.1/); }
  function replay(remaining: number, complete: ReturnType<typeof session.snapshot>) {
    direction = undefined;
    session.powerOn(); session.mountDisk("replacement.dsk", new Uint8Array(cocoDiskSize));
    session.restore(saved.read()!.state); run(remaining); assert.deepEqual(session.snapshot(), complete);
  }

  boot();
  const chapter = readFileSync("src/machines/6809/coco.md", "utf8");
  const setup = chapter.split("### Machine code across disk granules\n")[1]!.match(/```text\n([^`]+)\n```/)![1]!.split("\n");
  // Building 5 KiB with interpreted arithmetic takes longer than a disk command.
  for (const command of setup) line(command, command === "RUN" ? 60_000_000 : undefined);
  assert.deepEqual(programBytes(), expected); assert.equal(session.machine.ram.read(0x6400), 0);
  direction = "write"; session.send(cocoTextInput('SAVEM "SPAN",&H5000,&H63FF,&H6200\n'));
  until(() => transferred() === 9 * 256 + 128); saved.save(session.snapshot());
  const writing = saved.read()!.state.hardware.disk;
  assert.equal(writing.circuit.phase, 7); assert.equal(writing.circuit.writable, true);
  assert.equal(writing.circuit.drq, false, "checkpoint holds a supplied DATA byte waiting for its deadline");
  assert.ok(writing.circuit.byte_index > 0 && writing.circuit.byte_index < 256);
  const saveSteps = untilPrompt(), written = session.snapshot(), exported = session.machine.disk.exportImage();
  const file = cocoBinaryFile(exported, "SPAN    BIN");
  assert.equal(file.granules.length, 3); assert.equal(file.sectors.length, 21); assert.equal(file.finalBytes, 10);
  assert.deepEqual(file.bytes, [0, 0x14, 0, 0x50, 0, ...expected, 0xff, 0, 0, 0x62, 0]);
  assert.deepEqual([...transfers.keys()], file.sectors); assert.ok([...transfers.values()].every(count => count === 256));
  assert.ok(original.every(byte => byte === 255)); replay(saveSteps, written);
  assert.deepEqual(session.machine.disk.exportImage(), exported); assert.equal(session.machine.disk.inspect().writable, true);
  line("DIR"); assert.match(cocoScreenText(session.machine), /SPAN\s+BIN\s+2 B 3/);

  session.powerOn(); session.mountDisk("SPAN-saved.dsk", exported); boot(); line("CLEAR200,&H4FFF");
  assert.ok(programBytes().every(byte => byte === 0), "fresh boot did not retain the old program");
  assert.equal(session.machine.ram.read(0x6400), 0); assert.equal(session.machine.disk.inspect().writable, false);
  transfers = new Map(); direction = "read"; session.send(cocoTextInput('LOADM "SPAN"\n'));
  until(() => transferred() === 9 * 256 + 128); saved.save(session.snapshot());
  const reading = saved.read()!.state.hardware.disk;
  assert.equal(reading.circuit.phase, 3); assert.equal(reading.circuit.writable, false);
  assert.ok(reading.circuit.byte_index > 0 && reading.circuit.byte_index < 256);
  // The ROM stacks the old buffer's final byte while it refills the next sector;
  // LOADM has not received that byte yet (in addition to the five-byte preamble).
  assert.deepEqual(programBytes().slice(0, 9 * 256 - 6), expected.slice(0, 9 * 256 - 6));
  assert.equal(session.machine.ram.read(0x58fa), 0, "the first granule's last payload byte is still pending in the ROM");
  assert.equal(session.machine.ram.read(0x6200), 0, "the third granule's entry point has not loaded yet");
  const loadSteps = untilPrompt(), loaded = session.snapshot();
  assert.deepEqual(programBytes(), expected); assert.deepEqual([...transfers.keys()], file.sectors);
  assert.ok([...transfers.values()].every(count => count === 256));
  replay(loadSteps, loaded); assert.deepEqual(programBytes(), expected);
  assert.deepEqual(session.machine.disk.exportImage(), exported); assert.equal(session.machine.disk.inspect().writable, false);
  assert.equal(session.machine.ram.read(0x6400), 0, "LOADM loads but does not execute");
  session.send(cocoTextInput("EXEC\n")); until(() => session.machine.cpu.snapshot().pc === 0x6200);
  until(() => session.inputSettled); run(20_000); untilPrompt();
  assert.equal(session.machine.ram.read(0x6400), 42); assert.match(cocoScreenText(session.machine), /EXEC\nM\nOK/);
  assert.deepEqual(programBytes(), expected); line("PRINT PEEK(&H6400)"); assert.match(cocoScreenText(session.machine), /\n 42\nOK/);
  if (process.env.COCO_BINARY_EXPORT) writeFileSync(process.env.COCO_BINARY_EXPORT, exported);
});
