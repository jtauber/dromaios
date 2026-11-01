import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create8088PcXt, romImages } from "../../../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";
import { makeXtDataDisk } from "../../../../scripts/make-xt-data-disk.js";
import { runInput, scanCodes, screen } from "./rom-console.js";

type Machine = ReturnType<typeof create8088PcXt>;
const { XT_BIOS_ROM, XT_BASIC_ROM, XT_DOS_DISK } = process.env;
const diskHash = "d79f283ebd2cd68e8dede44ed876da13c25024f7000bcb576177820388c424f4";

// Both 360 KiB FAT12 disks have 112 root entries beginning at sector five.
function visibleRootFiles(disk: Buffer) {
  const files: [string, string, number][] = [];
  for (let i = 0; i < 112; i++) {
    const offset = 5 * 512 + i * 32;
    if (disk[offset] === 0) break;
    if (disk[offset] === 0xe5 || (disk[offset + 11]! & 0x1e) !== 0) continue;
    files.push([disk.toString("ascii", offset, offset + 8).trimEnd(),
      disk.toString("ascii", offset + 8, offset + 11).trimEnd(), disk.readUInt32LE(offset + 28)]);
  }
  return files;
}

function runToBootSector(machine: Machine, disk: Buffer) {
  let bytes = 0, readCompleted = false;
  for (let step = 0; step < 25_000_000; step++) {
    const { record, dma } = stepTimedXtCpu(machine);
    if (dma?.channel === 2) {
      assert.equal(dma.address, 0x7c00 + bytes);
      assert.equal(dma.value, disk[bytes]);
      bytes++;
    }
    if (bytes === 512 && record.outcome === "accepted" && record.vector === 14) readCompleted = true;
    if (record.after.pc === 0x7c00) {
      assert.deepEqual([record.after.cs, record.after.ip], [0, 0x7c00]);
      assert.equal(bytes, 512); assert.ok(readCompleted, "BIOS must accept IRQ6 after the boot sector transfer");
      return;
    }
    if (record.outcome === "unsupported") assert.fail(`POST stopped at ${record.before.pc.toString(16)}`);
  }
  assert.fail("BIOS did not hand control to the boot sector");
}

// Keep completed CGA rows as they scroll off the screen. On entry to the original
// BIOS teletype service for LF, the preceding line is drawn and the cursor is still on it.
function consoleUntil(machine: Machine, input: string, prompt: string, expectedLine?: string) {
  const keys = scanCodes(input), lines: string[] = [];
  const { keyboardInterrupts } = runInput(machine, keys, { limit: 3_000_000, until: (steps, { after }) => {
    if (after.pc === 0xff065 && after.ax === 0x0e0a) lines.push(screen(machine)[machine.ram.read(0x451)]!);
    if (steps % 1024 !== 0) return false;
    return (!expectedLine || lines.includes(expectedLine)) && screen(machine).filter(Boolean).at(-1) === prompt;
  } });
  assert.equal(keyboardInterrupts, keys.length);
  return lines;
}

// Wait for DOS to echo each key so long commands cannot overrun the BIOS typeahead buffer.
function dosCommand(machine: Machine, command: string, expectedLine: string) {
  let echo = "A>";
  for (const key of command) {
    echo += key;
    consoleUntil(machine, key, echo.trimEnd());
  }
  return consoleUntil(machine, "\n", "A>", expectedLine);
}

function checkDirectory(machine: Machine, disk: Buffer, volume: string, totals: string) {
  const listing = dosCommand(machine, "DIR", ` Volume in drive A is ${volume}`);
  assert.ok(listing.includes("A>DIR"));
  assert.equal(listing.find(row => row.includes("File(s)"))?.trim().replace(/\s+/g, " "), totals);
  assert.ok(listing.includes(" Directory of  A:\\"));
  const files = listing.flatMap(row => {
    const file = /^(\S+)\s+(\S+)\s+(\d+)\s+\d+-\d+-\d+/.exec(row);
    return file ? [[file[1], file[2], Number(file[3])]] : [];
  });
  assert.deepEqual(files, visibleRootFiles(disk));
}

test("original XT boots MS-DOS 3.30, lists the system disk, then reads and runs files from a replacement disk", {
  skip: !(XT_BIOS_ROM && XT_BASIC_ROM && XT_DOS_DISK) && "Set XT_BIOS_ROM, XT_BASIC_ROM and XT_DOS_DISK to the selected images.",
}, async () => {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const disk = readFileSync(XT_DOS_DISK!);
  assert.equal(disk.length, 360 * 1024);
  assert.equal(await digest(disk), diskHash, "Expected Microsoft MS-DOS 3.30 Disk 1 (MS330PP01)");
  const machine = create8088PcXt({
    bios: await RomImage.verify(readFileSync(XT_BIOS_ROM!), romImages.bios, digest),
    basic: await RomImage.verify(readFileSync(XT_BASIC_ROM!), romImages.basic, digest),
    font: null,
  });
  machine.io.setDiskette(disk);
  machine.reset();
  runToBootSector(machine, disk);
  consoleUntil(machine, "", "Enter new date (mm-dd-yy):");
  consoleUntil(machine, "\n", "Enter new time:");
  consoleUntil(machine, "\n", "A>", "Microsoft(R) MS-DOS(R)  Version 3.30");

  const version = dosCommand(machine, "VER", "MS-DOS Version 3.30");
  assert.ok(version.includes("A>VER"));
  checkDirectory(machine, disk, "MS330PP01", "34 File(s) 5120 bytes free");

  // On the original drive DOS can still trust the old FAT while the motor is running.
  // Let the BIOS timer interrupt turn drive A off before opening the drive door.
  if (machine.io.snapshot().diskette.dor & 0x10) {
    runInput(machine, [], { limit: 2_000_000, until: (_, { accesses }) =>
      accesses.some(access => access.kind === "output" && access.port === 0x3f2 && (access.value & 0x10) === 0) });
  }
  const dataDisk = makeXtDataDisk();
  machine.io.setDiskette(dataDisk);
  const readme = dosCommand(machine, "TYPE README.TXT", "DOS read this file from drive A.");
  assert.deepEqual(readme, ["A>TYPE README.TXT", "Dromaios XT data disk.", "DOS read this file from drive A.", ""]);
  const hello = dosCommand(machine, "HELLO.COM", "Hello from HELLO.COM on drive A.");
  assert.deepEqual(hello, ["A>HELLO.COM", "Hello from HELLO.COM on drive A.", ""]);
  checkDirectory(machine, dataDisk, "DROMAIOS", "2 File(s) 360448 bytes free");
});
