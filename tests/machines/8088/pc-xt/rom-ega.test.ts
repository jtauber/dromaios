import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create8088PcXtEga, romImages } from "../../../../src/machines/generated/8088/pc-xt-ega.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";
import { renderEgaTextFrame } from "../../../../src/machines/8088/pc-xt/video.js";
import { scanCodes } from "./rom-console.js";

const { XT_BIOS_ROM, XT_BASIC_ROM, XT_EGA_ROM, XT_DOS_DISK } = process.env;

test("IBM EGA passes POST, installs INT 10h, and draws a DOS prompt with its uploaded font", {
  skip: !(XT_BIOS_ROM && XT_BASIC_ROM && XT_EGA_ROM && XT_DOS_DISK) && "Set XT_BIOS_ROM, XT_BASIC_ROM, XT_EGA_ROM and XT_DOS_DISK.",
}, async () => {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const rom = readFileSync(XT_EGA_ROM!), disk = readFileSync(XT_DOS_DISK!);
  assert.equal(await digest(disk), "d79f283ebd2cd68e8dede44ed876da13c25024f7000bcb576177820388c424f4");
  const m = create8088PcXtEga({
    bios: await RomImage.verify(readFileSync(XT_BIOS_ROM!), romImages.bios, digest),
    basic: await RomImage.verify(readFileSync(XT_BASIC_ROM!), romImages.basic, digest),
    option: await RomImage.verify(rom, romImages.option, digest),
  });
  m.io.setDiskette(disk); m.reset();
  const rows = () => Array.from({ length: m.ega.rows }, (_, row) => String.fromCharCode(...Array.from(
    { length: m.ega.columns }, (_, column) => m.ega.character(row, column))).trimEnd());

  // The XT calls the option ROM. Its POD14 raster/colour test takes the success exit.
  // The adapter returns to POST, which subsequently loads the DOS boot sector from A.
  const milestones = [0xc0003, 0xc0466, 0x7c00];
  for (let n = 0; n < 28_000_000 && milestones.length; n++) {
    const { record } = stepTimedXtCpu(m);
    assert.notEqual(record.outcome, "unsupported");
    if (record.before.pc === milestones[0]) milestones.shift();
    if (record.before.pc === 0xc0448) assert.fail("IBM POD14 reported display failure " + record.before.bx.toString(16));
  }
  assert.deepEqual(milestones, []);
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => m.ram.read(0x40 + i)), [0xd7, 0x0c, 0x00, 0xc0]);
  assert.equal(m.ram.read(0x487) & 0x60, 0x60); // IBM detected four 64 KiB banks.
  assert.equal(m.ram.read(0x488) & 15, 9); // off/on/on/off
  assert.equal(m.ram.read(0x449), 3);
  assert.deepEqual([m.ega.columns, m.ega.rows, m.ega.cellWidth, m.ega.cellHeight], [80, 25, 8, 14]);

  function awaitLine(input: string, expected: string) {
    const keys = scanCodes(input);
    for (let n = 0; n < 3_000_000; n++) {
      if (keys.length && m.io.offerScanCode(keys[0]!)) keys.shift();
      const { record } = stepTimedXtCpu(m);
      assert.notEqual(record.outcome, "unsupported");
      if (n % 2048 === 0 && !keys.length && rows().filter(Boolean).at(-1) === expected) return;
    }
    assert.fail(`Expected ${expected} at ${m.cpu.snapshot().pc.toString(16)}: ${rows().join("\n")}`);
  }
  awaitLine("", "Enter new date (mm-dd-yy):");
  awaitLine("\n", "Enter new time:");
  awaitLine("\n", "A>");
  assert.ok(rows().includes("Microsoft(R) MS-DOS(R)  Version 3.30"));
  const row = rows().indexOf("A>"), frame = renderEgaTextFrame(m.ega);
  assert.deepEqual([frame.width, frame.height], [640, 350]);
  // Compare every displayed dot against the independent 8×14 table in this ROM.
  for (const [column, ch] of [..."A>"].entries()) for (let line = 0; line < 14; line++) {
    const bits = rom[0x2230 + ch.charCodeAt(0) * 14 + line]!;
    for (let dot = 0; dot < 8; dot++) {
      const offset = (row * 14 + line) * 640 + column * 8 + dot;
      assert.equal(frame.pixels[offset], bits & (0x80 >> dot) ? 7 : 0, `${ch} row ${line} dot ${dot}`);
    }
  }
  awaitLine("VER", "A>VER"); awaitLine("\n", "A>");
  assert.ok(rows().includes("MS-DOS Version 3.30"));
});
