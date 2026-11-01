import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create8088PcXt, romImages } from "../../../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";
import { runInput, scanCodes, screen } from "./rom-console.js";

type Machine = ReturnType<typeof create8088PcXt>;
const { XT_BIOS_ROM, XT_BASIC_ROM, XT_DOS_DISK } = process.env;
const diskHash = "d79f283ebd2cd68e8dede44ed876da13c25024f7000bcb576177820388c424f4";

// Independent expectation from the pinned FAT12 image. Its 112 root entries start at sector five.
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

test("original XT BIOS cold-boots MS-DOS 3.30 and VER and DIR return to A>", {
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

  const version = consoleUntil(machine, "VER\n", "A>", "MS-DOS Version 3.30");
  assert.ok(version.includes("A>VER"));
  const listing = consoleUntil(machine, "DIR\n", "A>", "       34 File(s)      5120 bytes free");
  assert.ok(listing.includes("A>DIR"));
  assert.ok(listing.includes(" Volume in drive A is MS330PP01"));
  assert.ok(listing.includes(" Directory of  A:\\"));
  const files = listing.flatMap(row => {
    const file = /^(\S+)\s+(\S+)\s+(\d+)\s+\d+-\d+-\d+/.exec(row);
    return file ? [[file[1], file[2], Number(file[3])]] : [];
  });
  assert.equal(files.length, 34);
  assert.deepEqual(files, visibleRootFiles(disk));
});
