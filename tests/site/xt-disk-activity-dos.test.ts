import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { romImages } from "../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../src/machines/rom-image.js";
import { makeXtDataDisk } from "../../scripts/make-xt-data-disk.js";
import { screen } from "../machines/8088/pc-xt/rom-console.js";
import { createXtSession, type XtSessionState } from "../../site/interactive/xt-session.js";
import { createXtDiskActivity } from "../../site/interactive/xt-disk-activity.js";
import { xtDisketteResult } from "../../site/interactive/xt-diskette-decode.js";
import { fat12FileRegions, inspectFat12, readFat12File } from "../../site/interactive/fat12.js";
import { xtFileTransfers } from "../../site/interactive/xt-disk-file-transfers.js";

const { XT_BIOS_ROM, XT_BASIC_ROM, XT_CGA_ROM, XT_DOS_DISK } = process.env;
test("DOS file inspection links FAT12 to DMA, replays a checkpoint, rejects protected writes and reloads an exported save", {
  skip: !(XT_BIOS_ROM && XT_BASIC_ROM && XT_CGA_ROM && XT_DOS_DISK) && "Set the XT firmware and DOS disk paths.",
}, async () => {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const image = (slot: keyof typeof romImages, path: string) => RomImage.verify(readFileSync(path), romImages[slot], digest);
  const bindings = { bios: await image("bios", XT_BIOS_ROM!), basic: await image("basic", XT_BASIC_ROM!), font: await image("font", XT_CGA_ROM!) };
  const disk = readFileSync(XT_DOS_DISK!);
  assert.equal(await digest(disk), "d79f283ebd2cd68e8dede44ed876da13c25024f7000bcb576177820388c424f4");
  const session = createXtSession(bindings);
  session.insertDisk("DOS.IMG", disk); session.powerOn("quick");
  const activity = createXtDiskActivity(() => session.machine.io);
  activity.record(false);
  let boundaries = 0, halfway: { state: XtSessionState; boundaries: number; address: number } | undefined;
  let captureRead = false;
  function step() {
    const record = activity.capture(() => session.step()); boundaries++;
    // README's first data sector is independently known from the original FAT12 fixture.
    if (captureRead && !halfway && record.dma?.offset === 12 * 512 + 255) {
      halfway = { state: session.snapshot(), boundaries, address: record.dma.address - 255 };
    }
  }
  function until(done: () => boolean, limit = 3_000_000) {
    for (let n = 0; n < limit; n++) {
      step();
      if (n % 512 === 0 && !session.keyboard.pasteRemaining && !session.keyboard.queuedBytes && done()) return;
    }
    assert.fail(`XT did not reach the expected console state at ${session.machine.cpu.snapshot().pc.toString(16)}: ${screen(session.machine).join("\n")}`);
  }
  const lastLine = () => screen(session.machine).filter(Boolean).at(-1);
  until(() => lastLine() === "Enter new date (mm-dd-yy):", 25_000_000);
  session.keyboard.paste("\n"); until(() => lastLine() === "Enter new time:");
  session.keyboard.paste("\n"); until(() => lastLine() === "A>");
  until(() => !session.machine.io.disketteMotorOn);
  const dataDisk = makeXtDataDisk(); session.insertDisk("DATA.IMG", dataDisk);
  activity.reset(); activity.record(true); captureRead = true;
  session.keyboard.paste("TYPE README.TXT\n");
  until(() => lastLine() === "A>" && screen(session.machine).includes("DOS read this file from drive A."));
  assert.ok(halfway, "DOS must read the README sector through DMA");
  const end = session.snapshot(), finished = boundaries;
  const read = activity.entries().find(op => op.sectors.some(sector => sector.offset === 12 * 512))!;
  assert.equal(read.command, 0xe6); assert.equal(read.state, "complete"); assert.equal(read.consumed, 7); assert.equal(read.irq6, true);
  assert.match(xtDisketteResult(read.command, read.result), /^Normal termination/);
  const sector = read.sectors.find(sector => sector.offset === 12 * 512)!;
  assert.equal(sector.bytes, 512); assert.equal(sector.firstAddress, halfway.address);
  assert.deepEqual(end.hardware.ram.slice(sector.firstAddress, sector.firstAddress + 512), [...dataDisk.subarray(12 * 512, 13 * 512)]);
  const original = session.machine.io.inspectDiskette()!, volume = inspectFat12(original), readme = volume.entries.find(e => e.name === "README.TXT")!;
  const linkedRead = xtFileTransfers(fat12FileRegions(volume, readme), activity.entries()).find(t => t.kind === "data")!;
  assert.equal(linkedRead.address, sector.firstAddress); assert.equal(linkedRead.bytes, 58);
  assert.equal(Buffer.from(readFat12File(original, volume, readme)).toString("ascii"), "Dromaios XT data disk.\r\nDOS read this file from drive A.\r\n");

  session.restore(halfway.state); activity.reset(); captureRead = false;
  assert.equal(activity.entries()[0]!.continued, true); assert.equal(activity.entries()[0]!.bytes, 0);
  for (let n = halfway.boundaries; n < finished; n++) step();
  assert.deepEqual(session.snapshot(), end);
  const resumed = activity.entries()[0]!;
  assert.equal(resumed.sectors[0]!.firstByte, 256); assert.equal(resumed.sectors[0]!.bytes, 256);
  assert.deepEqual(resumed.result, read.result); assert.equal(resumed.irq6, true); assert.equal(resumed.state, "complete");
  // The observer must not affect CPU, RAM, devices, pixels, audio phase, or host keyboard pacing.
  const plain = createXtSession(bindings); plain.restore(halfway.state);
  for (let n = halfway.boundaries; n < finished; n++) plain.step();
  assert.deepEqual(plain.snapshot(), end);

  activity.reset(); session.keyboard.paste("ECHO HELLO>SAVE.TXT\n");
  until(() => screen(session.machine).some(line => /Abort, Retry, (?:Ignore, )?Fail/.test(line)));
  assert.ok(screen(session.machine).some(line => /Write protect error writing drive A/i.test(line)));
  const failed = activity.entries().filter(op => op.command !== undefined && (op.command & 0x3f) === 5);
  assert.ok(failed.length > 0, "DOS must actually issue a write command");
  for (const op of failed) {
    assert.equal(op.bytes, 0); assert.deepEqual(op.sectors, []); assert.equal(op.result[1]! & 2, 2);
    assert.match(xtDisketteResult(op.command, op.result), /Abnormal termination · write-protected/);
    assert.equal(op.state, "complete"); assert.equal(op.consumed, 7);
  }
  assert.deepEqual(session.machine.io.exportDiskette(), new Uint8Array(dataDisk));

  // Resume the verified prompt, then let DOS create a new file on a writable copy.
  session.restore(end); activity.reset(); until(() => !session.machine.io.disketteMotorOn);
  session.insertDisk("DATA.IMG", dataDisk, { writable: true }); activity.reset();
  session.keyboard.paste("ECHO HELLO>SAVE.TXT\n"); until(() => lastLine() === "A>");
  const edited = session.machine.io.inspectDiskette()!, savedVolume = inspectFat12(edited), savedFile = savedVolume.entries.find(e => e.name === "SAVE.TXT")!;
  assert.equal(savedFile.size, 7); assert.deepEqual(savedFile.clusters, [4]); assert.deepEqual(savedFile.issues, []);
  assert.deepEqual(savedVolume.warnings, []); assert.equal(savedFile.offset, 2560 + 96);
  const content = Buffer.from(readFat12File(edited, savedVolume, savedFile)); assert.equal(content.toString("ascii"), "HELLO\r\n");
  const linkedWrites = xtFileTransfers(fat12FileRegions(savedVolume, savedFile), activity.entries()).filter(t => t.direction === "memory-to-disk");
  assert.ok(linkedWrites.some(t => t.kind === "directory" && t.offset === 2656 && t.bytes === 32));
  for (const offset of [518, 1542]) assert.ok(linkedWrites.some(t => t.kind === "fat" && t.offset === offset && t.bytes === 2));
  assert.ok(linkedWrites.some(t => t.kind === "data" && t.offset === 8192 && t.bytes === 7));
  assert.equal(inspectFat12(original).entries.some(e => e.name === "SAVE.TXT"), false);
  until(() => !session.machine.io.disketteMotorOn);
  const exported = session.machine.io.exportDiskette();
  // Independent offsets from the fixture, not inferred from the inspector's region mapping.
  assert.equal(Buffer.from(exported.slice(2656, 2667)).toString("ascii"), "SAVE    TXT");
  assert.deepEqual(exported.slice(8192, 8199), new Uint8Array(content));
  assert.deepEqual(exported.slice(512, 1536), exported.slice(1536, 2560));

  // Fresh CPU/RAM/DOS buffers: only exported sectors carry the saved file to the second session.
  activity.record(false); session.insertDisk("DOS.IMG", disk); session.powerOn("quick"); activity.reset();
  until(() => lastLine() === "Enter new date (mm-dd-yy):", 25_000_000);
  session.keyboard.paste("\n"); until(() => lastLine() === "Enter new time:");
  session.keyboard.paste("\n"); until(() => lastLine() === "A>"); until(() => !session.machine.io.disketteMotorOn);
  session.insertDisk("EXPORTED.IMG", exported); activity.reset(); activity.record(true);
  session.keyboard.paste("TYPE SAVE.TXT\n"); until(() => lastLine() === "A>" && screen(session.machine).includes("HELLO"));
  const freshBytes = session.machine.io.inspectDiskette()!, freshVolume = inspectFat12(freshBytes), freshFile = freshVolume.entries.find(e => e.name === "SAVE.TXT")!;
  assert.deepEqual(freshFile, savedFile); assert.deepEqual(readFat12File(freshBytes, freshVolume, freshFile), new Uint8Array(content));
  const reloaded = xtFileTransfers(fat12FileRegions(freshVolume, freshFile), activity.entries()).find(t => t.kind === "data")!;
  assert.equal(reloaded.direction, "disk-to-memory"); assert.equal(reloaded.bytes, 7);
  assert.deepEqual(session.machine.snapshot().ram.slice(reloaded.address, reloaded.address + 7), [...content]);
  activity.dispose();
});
