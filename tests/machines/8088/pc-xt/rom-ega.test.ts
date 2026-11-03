import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create8088PcXtEga, romImages } from "../../../../src/machines/generated/8088/pc-xt-ega.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";
import { renderEgaGraphicsFrame, renderEgaTextFrame } from "../../../../src/machines/8088/pc-xt/video.js";
import { makeXtEgaBarsDisk } from "../../../../scripts/make-xt-ega-bars.js";
import { dosTransfer, partyPosition } from "./dos-transfer.js";
import { runInput, scanCodes, screen } from "./rom-console.js";

const { XT_BIOS_ROM, XT_BASIC_ROM, XT_EGA_ROM, XT_DOS_DISK, XT_ULTIMA_EGA_PROGRAM, XT_ULTIMA_PLAYER } = process.env;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hasFirmware = XT_BIOS_ROM && XT_BASIC_ROM && XT_EGA_ROM;

async function bootEga(disk: Uint8Array, quick = false) {
  const digest = async (bytes: Uint8Array) => sha256(bytes);
  const m = create8088PcXtEga({
    bios: await RomImage.verify(readFileSync(XT_BIOS_ROM!), romImages.bios, digest),
    basic: await RomImage.verify(readFileSync(XT_BASIC_ROM!), romImages.basic, digest),
    option: await RomImage.verify(readFileSync(XT_EGA_ROM!), romImages.option, digest),
  });
  if (quick) { m.ram.write(0x472, 0x34); m.ram.write(0x473, 0x12); }
  m.io.setDiskette(disk); m.reset();
  return m;
}

test("IBM EGA passes POST, installs INT 10h, and draws a DOS prompt with its uploaded font", {
  skip: !(hasFirmware && XT_DOS_DISK) && "Set XT_BIOS_ROM, XT_BASIC_ROM, XT_EGA_ROM and XT_DOS_DISK.",
}, async () => {
  const rom = readFileSync(XT_EGA_ROM!), disk = readFileSync(XT_DOS_DISK!);
  assert.equal(sha256(disk), "d79f283ebd2cd68e8dede44ed876da13c25024f7000bcb576177820388c424f4");
  const m = await bootEga(disk), rows = () => screen(m);

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

test("a DOS program queries the EGA, selects mode 0Dh and draws sixteen bands with its own palette", {
  skip: !(hasFirmware && XT_DOS_DISK) && "Set the XT firmware and XT_DOS_DISK.",
}, async () => {
  const m = await bootEga(makeXtEgaBarsDisk(readFileSync(XT_DOS_DISK!)), true);
  // BARS.COM waits through INT 16h only after the adapter query and all 16 bands succeed.
  runInput(m, [], { limit: 6_000_000, until: (_, { instruction, before }) => m.ega.graphicsSupported
    && before.cs < 0xa000 && before.ah === 0 && instruction?.bytes[0] === 0xcd && instruction.bytes[1] === 0x16 });
  assert.equal(m.ram.read(0x449), 0x0d); assert.equal(m.ram.read(0x462), 0);
  const frame = renderEgaGraphicsFrame(m.ega);
  assert.deepEqual([frame.width, frame.height], [320, 200]); assert.equal(m.ega.rgbiOutput, true);
  for (let y = 0; y < 200; y++) {
    const band = 2 * Math.floor(y / 25) + (y % 25 >= 12 ? 1 : 0);
    const colour = 15 - band, pins = (colour & 7) | ((colour & 8) << 1);
    assert.equal(m.ega.colour(band), pins);
    assert.ok(frame.pixels.subarray(y * 320, (y + 1) * 320).every(pixel => pixel === pins), `Band ${band}, line ${y}`);
  }
  runInput(m, scanCodes(" "), { limit: 1_000_000, until: n => n % 2048 === 0 && screen(m).filter(Boolean).at(-1) === "A>" });
  assert.equal(m.ram.read(0x449), 3);
});

type EgaXt = ReturnType<typeof create8088PcXtEga>;

function filenameAt(machine: EgaXt, ds: number, dx: number) {
  let name = "";
  for (let i = 0; i < 64; i++) {
    const byte = machine.memory.read(((ds << 4) + ((dx + i) & 0xffff)) & 0xfffff);
    if (!byte) break;
    name += String.fromCharCode(byte);
  }
  return name.toUpperCase();
}

test("Ultima V selects EGA.DRV automatically and draws both reference menu strips from a cold boot", {
  skip: !(hasFirmware && XT_ULTIMA_EGA_PROGRAM) && "Set the XT firmware and XT_ULTIMA_EGA_PROGRAM.",
}, async t => {
  const disk = readFileSync(XT_ULTIMA_EGA_PROGRAM!);
  assert.equal(sha256(disk), "96c2f57494a8e552251ac16b85ea15c043f29ca4b4deb15b3e39ac1dee923b35");
  const m = await bootEga(disk);
  const opened = new Set<string>(), calls: number[] = [];
  runInput(m, [], { limit: 34_000_000, until: (n, { before, instruction }) => {
    if (instruction?.bytes[0] === 0xcd) {
      if (instruction.bytes[1] === 0x21 && before.ah === 0x3d) {
        opened.add(filenameAt(m, before.ds, before.dx));
      }
      if (instruction.bytes[1] === 0x10 && opened.has("EGA.DRV") && before.cs < 0xa000
        && [0x000d, 0x1002, 0x0500].includes(before.ax)) calls.push(before.ax);
    }
    return opened.has("TITLE.BIT") && n % 16384 === 0 && m.ega.graphicsSupported
      && renderEgaGraphicsFrame(m.ega).pixels.some(pixel => pixel !== 0);
  } });
  assert.ok(opened.has("EGA.DRV")); assert.ok(!opened.has("CGA.DRV"));
  assert.deepEqual(calls, [0x000d, 0x1002, 0x0500]);
  const top = "3e6dbb8fe42ae4ba58f51c1d5c126bfb01b112032080aa5e81597a173668e324";
  const bottom = "dec3a7d5b6cee8381ccf5b37c0edbfeca79b1264e376afd92d3e2003e85c7ebc";
  runInput(m, scanCodes(" "), { limit: 7_000_000, until: n => {
    if (n % 32768 || !m.ega.graphicsSupported) return false;
    // Ultima's palette drives the RGBI pins in index order. Recover those four bits from the rendered frame.
    const pixels = renderEgaGraphicsFrame(m.ega).pixels.map(pins => (pins & 7) | ((pins >> 1) & 8));
    return sha256(pixels.subarray(0, 60 * 320)) === top && sha256(pixels.subarray(128 * 320)) === bottom;
  } });

  await t.test("Journey Onward exchanges disks and one Down key moves the party and scrolls the hut", {
    skip: !XT_ULTIMA_PLAYER && "Set XT_ULTIMA_PLAYER to the original Player disk.",
  }, () => {
    const player = readFileSync(XT_ULTIMA_PLAYER!);
    assert.equal(sha256(player), "135c06d4193b1f01062b27d0f884e2045d0ea0dec667e88b281f0ef466bc9b7a");
    runInput(m, scanCodes("\n"), { limit: 2_000_000, until: (_, { before, instruction }) =>
      before.ah === 0x3d && instruction?.bytes[0] === 0xcd && instruction.bytes[1] === 0x21
      && filenameAt(m, before.ds, before.dx) === "TILES.16" });
    const tiles = createHash("sha256");
    let length = 0;
    while (length < 30_414) {
      const { bytes } = dosTransfer(m, [], "read");
      assert.ok(bytes.length, "Premature end of TILES.16");
      tiles.update(bytes); length += bytes.length;
    }
    assert.equal(length, 30_414);
    assert.equal(tiles.digest("hex"), "bc5d33bdb92a9f054cabf95fc34293d65b181e23eabf041a08edf88027ea4f83");
    // The traced game takes another 2.4 million boundaries after the last tile read.
    runInput(m, [], { limit: 4_000_000, until: (_, { after }) =>
      after.cs === 0x0c6f && after.ip === 0x7249 && after.flags.cf && after.ax === 2 });
    const { ds, dx } = m.cpu.snapshot();
    assert.equal(filenameAt(m, ds, dx), "SAVED.GAM");
    m.io.setDiskette(player, { writable: true });
    const party = dosTransfer(m, [], "read", 4192);
    assert.equal(sha256(party.bytes), "e4cf6298c3f04151669d7948330ce85f51edec2c0efc9eeabe6c3b3ac3e7b740");

    // At this keyboard poll the game has finished drawing the map. The table east of the party
    // should scroll up by one 16-dot tile when the party moves south.
    const atInput = (cs: number, ip: number) => cs === 0x0c6f && ip === 0x1d6c;
    runInput(m, [], { limit: 5_000_000, until: (_, { after }) => atInput(after.cs, after.ip) });
    assert.deepEqual(partyPosition(m, party.base), [13, 15, 15]);
    const table = (y: number) => {
      const pixels = renderEgaGraphicsFrame(m.ega).pixels;
      return Buffer.concat(Array.from({ length: 16 }, (_, row) =>
        pixels.subarray((y + row) * 320 + 112, (y + row) * 320 + 128)));
    };
    const before = table(88);
    assert.notDeepEqual(before, table(72));
    const { keyboardInterrupts } = runInput(m, [0x50, 0xd0], { limit: 2_000_000, until: (_, { after }) =>
      atInput(after.cs, after.ip) && partyPosition(m, party.base)[2] === 16 });
    assert.equal(keyboardInterrupts, 2); // Down make and break
    assert.deepEqual(partyPosition(m, party.base), [13, 15, 16]);
    assert.deepEqual(table(72), before);
  });
});
