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
import { cocoDiskSize } from "../../src/machines/6809/coco/disk-controller.js";

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("version-7 disks migrate read-only; current write permission is mandatory and power-on preserves it", () => {
  const session = createCocoSession(), local = storage(), saved = cocoSavedState(() => local, session.machine.clock.hertz!);
  session.mountDisk("blank.dsk", new Uint8Array(cocoDiskSize).fill(0xff)); saved.save(session.snapshot());
  const [key, text] = [...local.values][0]!, legacy = JSON.parse(text);
  legacy.version = 7; delete legacy.state.hardware.cartridge; delete legacy.state.hardware.disk.circuit.writable;
  const old = JSON.stringify(legacy); local.setItem(key, old); const migrated = saved.read()!;
  assert.equal(migrated.version, 9); assert.equal(migrated.state.hardware.disk.circuit.writable, false);
  session.machine.disk.writableCopy(); session.restore(migrated.state);
  assert.equal(session.machine.disk.inspect().writable, false); assert.equal(local.getItem(key), old);
  legacy.version = 8; local.setItem(key, JSON.stringify(legacy)); const before = session.snapshot();
  assert.throws(() => session.restore(saved.read()!.state)); assert.deepEqual(session.snapshot(), before);
  session.machine.disk.writableCopy(); session.machine.disk.write(0, 0x29); session.machine.disk.write(8, 0xa0);
  session.machine.disk.advanceCpuClocks(session.machine.disk.clocksUntilEvent()); session.machine.disk.write(11, 0x42);
  saved.save(session.snapshot()); const checkpoint = saved.read()!.state;
  assert.equal(checkpoint.hardware.disk.circuit.phase, 6); assert.equal(checkpoint.hardware.disk.circuit.drq, false);
  session.powerOn(); assert.equal(session.machine.disk.inspect().writable, true); assert.equal(session.machine.disk.inspect().phase, 0);
  session.mountDisk("replacement.dsk", new Uint8Array(cocoDiskSize)); session.restore(checkpoint);
  assert.deepEqual(session.snapshot(), checkpoint); assert.equal(session.diskName, "blank.dsk");
  session.machine.disk.advanceCpuClocks(400); assert.equal(session.machine.disk.exportImage()[0], 0x42);
  session.powerOn(); assert.equal(session.machine.disk.exportImage()[0], 0x42); assert.equal(session.machine.disk.inspect().writable, true);
  session.configureRoms({ firmware: null, extended: null, dos: null }); assert.equal(session.machine.disk.inspect().writable, true);
  const packed = JSON.parse(local.getItem(key)!);
  for (const writable of [undefined, 1, false]) {
    const invalid = structuredClone(packed); invalid.state.hardware.disk.circuit.writable = writable;
    local.setItem(key, JSON.stringify(invalid)); const held = session.snapshot();
    assert.throws(() => session.restore(saved.read()!.state)); assert.deepEqual(session.snapshot(), held);
  }
});

const needsRoms = !(process.env.COCO_ROM && process.env.COCO_EXTENDED_ROM && process.env.COCO_DISK_ROM)
  && "Set COCO_ROM, COCO_EXTENDED_ROM and COCO_DISK_ROM for the SAVE/export/reload transcript.";

test("a version-7 checkpoint with an unread sector byte keeps that transfer when migrated", () => {
  const session = createCocoSession(), local = storage(), saved = cocoSavedState(() => local, session.machine.clock.hertz!);
  session.mountDisk("old.dsk", new Uint8Array(cocoDiskSize).fill(0x5a));
  session.machine.disk.write(0, 0xa9); session.machine.disk.write(8, 0x80); session.machine.disk.advanceCpuClocks(60);
  const expected = session.snapshot(); assert.equal(expected.hardware.disk.circuit.drq, true);
  saved.save(expected); const [key, text] = [...local.values][0]!, legacy = JSON.parse(text);
  legacy.version = 7; delete legacy.state.hardware.cartridge; delete legacy.state.hardware.disk.circuit.writable; local.setItem(key, JSON.stringify(legacy));
  session.powerOn(); session.machine.disk.writableCopy(); session.restore(saved.read()!.state);
  assert.deepEqual(session.snapshot(), expected); assert.equal(session.machine.disk.read(11), 0x5a);
});

test("Disk BASIC SAVE creates ANSWER, write checkpoints replay, and the exported disk LOADs and RUNs after fresh boot", { skip: needsRoms }, async () => {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware, digest);
  const extended = await RomImage.verify(readFileSync(process.env.COCO_EXTENDED_ROM!), romImages.extended, digest);
  const dos = await RomImage.verify(readFileSync(process.env.COCO_DISK_ROM!), romImages.dos, digest);
  const session = createCocoSession(firmware, extended, dos), local = storage(), saved = cocoSavedState(() => local, session.machine.clock.hertz!);
  // Independent empty Disk BASIC format: free FAT granules and end-of-directory markers are FF.
  const original = new Uint8Array(cocoDiskSize).fill(0xff);
  session.mountDisk("blank.dsk", original); session.machine.disk.writableCopy();
  let writes = 0;
  function step() {
    const phase = session.machine.disk.inspect().phase, record = session.step();
    if (phase === 6 || phase === 7) writes += record.accesses.filter(a => a.kind === "write" && a.address === 0xff4b).length;
    return record;
  }
  function run(count: number) { for (let i = 0; i < count; i++) step(); }
  function until(done: () => boolean): number {
    for (let i = 1; i <= 3_000_000; i++) { step(); if (done()) return i; }
    assert.fail(cocoScreenText(session.machine));
  }
  const prompt = () => session.inputSettled && session.machine.disk.inspect().phase === 0 && /\nOK(?:\n█)?$/.test(cocoScreenText(session.machine));
  function line(text: string) {
    session.send(cocoTextInput(text + "\n")); until(() => session.inputSettled); run(20_000);
    if (!/^\d/.test(text)) until(prompt); // Numbered program lines return to input without printing OK.
  }
  function boot() { run(720_000); assert.match(cocoScreenText(session.machine), /^DISK EXTENDED COLOR BASIC 1\.1/); }
  boot(); line("DIR"); assert.doesNotMatch(cocoScreenText(session.machine), /ANSWER/);
  line("10 PRINT 42"); line("20 END"); writes = 0;
  session.send(cocoTextInput('SAVE "ANSWER"\n')); until(() => writes === 128);
  saved.save(session.snapshot()); const halfway = saved.read()!.state;
  assert.equal(halfway.hardware.disk.circuit.phase, 7); assert.equal(halfway.hardware.disk.circuit.writable, true);
  assert.ok(halfway.hardware.disk.circuit.byte_index > 0 && halfway.hardware.disk.circuit.byte_index < 256);
  const remaining = until(prompt), completed = session.snapshot(), exported = session.machine.disk.exportImage();
  assert.doesNotMatch(cocoScreenText(session.machine), /\?(?:IO|WP|FC|FS) ERROR/);
  assert.ok(writes >= 3 * 256, "SAVE writes data, allocation, and directory sectors through FF4B");
  assert.notDeepEqual(exported, original); assert.ok(original.every(byte => byte === 255));
  const entry = (17 * 18 + 2) * 256;
  assert.equal(Buffer.from(exported.slice(entry, entry + 11)).toString("ascii"), "ANSWER  BAS");
  assert.equal(exported[entry + 11], 0); assert.equal(exported[entry + 12], 0, "default SAVE creates tokenized BASIC");
  assert.ok(exported[(17 * 18 + 1) * 256 + exported[entry + 13]!]! >= 0xc1, "the directory refers to an allocated final granule");
  session.powerOn(); session.mountDisk("replacement.dsk", original); session.restore(halfway); run(remaining);
  assert.deepEqual(session.snapshot(), completed); assert.deepEqual(session.machine.disk.exportImage(), exported);
  line("DIR"); assert.match(cocoScreenText(session.machine), /ANSWER\s+BAS\s+0 B 1/);
  line("RUN"); assert.match(cocoScreenText(session.machine), /RUN\n 42\nOK/);
  session.powerOn(); assert.equal(session.machine.disk.inspect().writable, true);
  // File import is a new, protected medium; boot from its bytes, without the old RAM/program.
  session.mountDisk("ANSWER-saved.dsk", exported); assert.equal(session.machine.disk.inspect().writable, false);
  boot(); line("DIR"); line('LOAD "ANSWER"'); line("RUN");
  assert.match(cocoScreenText(session.machine), /RUN\n 42\nOK/);
  assert.deepEqual(session.machine.disk.exportImage(), exported);
  if (process.env.COCO_SAVE_EXPORT) writeFileSync(process.env.COCO_SAVE_EXPORT, exported);
});
