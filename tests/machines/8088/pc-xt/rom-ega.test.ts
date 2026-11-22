import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { create8088PcXtEga, romImages } from "../../../../src/machines/generated/8088/pc-xt-ega.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";
import { renderEgaGraphicsFrame, renderEgaTextFrame } from "../../../../src/machines/8088/pc-xt/video.js";
import { makeXtEgaBarsDisk } from "../../../../scripts/make-xt-ega-bars.js";
import type { XtDisketteTransfer } from "../../../../src/machines/8088/pc-xt/io.js";
import { inspectFat12, fat12FileRegions, readFat12File } from "../../../../site/interactive/fat12.js";
import { matchesUltimaObservation } from "../../../../site/interactive/xt-ultima-v.js";
import { xtEgaPixelReadout } from "../../../../site/interactive/xt-ega-pixel.js";
import { createXtDebugger } from "../../../../site/interactive/xt-debugger.js";
import { createXtPaletteCapture } from "../../../../site/interactive/xt-ega-palette.js";
import { createXtIoTrace } from "../../../../site/interactive/xt-io-trace.js";
import type { UltimaObservation } from "../../../../site/interactive/xt-ultima-v.js";
import { ultimaSteps } from "../../../helpers/ultima-v-guide.js";
import { ultimaVParty } from "./ultima-v-party.js";
import { traceHutStep } from "./ultima-v-hut.js";
import { dosTransfer } from "./dos-transfer.js";
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
  // Stop at the program's INT 10h with AX=1002h, just before the palette load.
  runInput(m, [], { limit: 6_000_000, until: (_, { after, instruction }) => m.ega.graphicsSupported
    && after.cs < 0xa000 && after.ip === 0x012f && after.ax === 0x1002 && instruction?.bytes[0] === 0xb8 });
  const debug = createXtDebugger(() => m);
  const palette = createXtPaletteCapture(m)!, trace = createXtIoTrace();
  trace.recording = true;
  debug.runUntilPixelChanges(0, 0);
  while (!debug.beforeStep()) {
    const record = debug.capture(() => palette.capture(() => stepTimedXtCpu(m).record));
    trace.observe(record, m.io.clock.ticks);
  }
  assert.equal(debug.stop?.kind, "event");
  const hit = debug.pixelHit!;
  assert.equal(hit.store, undefined, "The BIOS changed the palette with the plane bytes untouched.");
  assert.equal(hit.afterBlanking, true);
  assert.deepEqual([hit.record.before.cs, hit.record.before.ip, hit.record.instruction?.bytes], [0xc000, 0x1db4, [0xee]]);
  assert.deepEqual(hit.record.accesses.filter(a => a.kind === "output"), [{ kind: "output", port: 0x3c0, value: 0x20 }]);
  assert.deepEqual(hit.before.planeBytes, [0, 0, 0, 0]); assert.deepEqual(hit.after.planeBytes, hit.before.planeBytes);
  assert.deepEqual([hit.before.paletteIndex, hit.after.paletteIndex, hit.before.pins, hit.after.pins], [0, 0, 0, 0x17]);
  assert.deepEqual([hit.before.colour, hit.after.colour, renderEgaGraphicsFrame(m.ega).pixels[0]], ["#000000", "#FFFFFF", 0x17]);
  const entries = trace.entries().filter(({ transfer }) => transfer.kind === "output" && transfer.port === 0x3c0);
  assert.deepEqual(entries.map(e => [e.caller.space, e.transfer]), [
    ["CS:IP C000:1DAE", { kind: "output", port: 0x3c0, value: 0 }],
    ["CS:IP C000:1DB1", { kind: "output", port: 0x3c0, value: 0x17, paletteIndex: 0, before: 0, after: 0x17 }],
    ["CS:IP C000:1DB4", { kind: "output", port: 0x3c0, value: 0x20 }],
  ]);
  assert.equal(hit.paletteWrite!.transfer, entries[1]!.transfer);
  assert.deepEqual(hit.paletteWrite!.caller, entries[1]!.caller);
  assert.deepEqual(hit.paletteWrite!.bytes, [0xee]);
  assert.equal(hit.paletteWrite!.ticks, entries[1]!.ticks);
  // With the palette installed, the ninth nonzero band turns a white dot brown.
  debug.runUntilPixelChanges(137, 112);
  while (!debug.beforeStep()) debug.capture(() => stepTimedXtCpu(m).record);
  assert.equal(debug.stop?.kind, "event");
  const band = debug.pixelHit!;
  assert.deepEqual([band.record.before.cs, band.record.before.ip, band.record.instruction?.bytes], [0x0c5f, 0x0151, [0xf3, 0xaa]]);
  assert.deepEqual(band.store, { source: "CPU", operand: { kind: "register", name: "AL", value: 9 }, write: {
    address: 0x1191, offset: 0x1191, value: 9, writeMode: 2, enabledPlanes: 15, bitMask: 255,
    before: [0, 0, 0, 0], after: [255, 0, 0, 255],
  } });
  assert.deepEqual([band.before.colour, band.after.colour, renderEgaGraphicsFrame(m.ega).pixels[112 * 320 + 137]], ["#FFFFFF", "#AA5500", 6]);
  palette.dispose(); debug.dispose();
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
  assert.match(xtEgaPixelReadout(m.ega, 0, 0), /bit 7: 0 0 0 0 · index 0 · palette\[0\] = \$17 · #FFFFFF$/);
  assert.match(xtEgaPixelReadout(m.ega, 137, 112), /bit 6: 1 0 0 1 · index 9 · palette\[9\] = \$06 · #AA5500$/);
  assert.match(xtEgaPixelReadout(m.ega, 319, 199), /bit 0: 1 1 1 1 · index 15 · palette\[15\] = \$00 · #000000$/);
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

async function bootUltimaTitle(disk: Uint8Array) {
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

  return m;
}

function journeyOnward(m: EgaXt, player: Uint8Array, onDiskByte?: (transfer: XtDisketteTransfer) => void) {
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
  const party = dosTransfer(m, [], "read", 4192, onDiskByte);
  return { party: ultimaVParty(m, party.base), record: party.bytes };
}

function waitForMap(m: EgaXt) {
  // At this keyboard poll the game has finished drawing the map.
  runInput(m, [], { limit: 6_000_000, until: (_, { after }) => after.cs === 0x0c6f && after.ip === 0x1d6c });
}

/** One map tile, in row order, from the frame rendered by the adapter. */
function tile(m: EgaXt, x: number, y: number) {
  const pixels = renderEgaGraphicsFrame(m.ega).pixels;
  return Buffer.concat(Array.from({ length: 16 }, (_, row) => {
    const start = (y + row) * 320 + x;
    return pixels.subarray(start, start + 16);
  }));
}

test("Ultima V selects EGA.DRV automatically and draws both reference menu strips from a cold boot", {
  skip: !(hasFirmware && XT_ULTIMA_EGA_PROGRAM) && "Set the XT firmware and XT_ULTIMA_EGA_PROGRAM.",
}, async t => {
  const disk = readFileSync(XT_ULTIMA_EGA_PROGRAM!);
  assert.equal(sha256(disk), "96c2f57494a8e552251ac16b85ea15c043f29ca4b4deb15b3e39ac1dee923b35");
  const m = await bootUltimaTitle(disk);
  await t.test("the EGA party leaves the hut, saves in Britannia and resumes from the exported disk on a fresh XT", {
    skip: !XT_ULTIMA_PLAYER && "Set XT_ULTIMA_PLAYER to the original Player disk.",
  }, async () => {
    const player = readFileSync(XT_ULTIMA_PLAYER!);
    assert.equal(sha256(player), "135c06d4193b1f01062b27d0f884e2045d0ea0dec667e88b281f0ef466bc9b7a");
    const { party, record } = journeyOnward(m, player);
    waitForMap(m);
    assert.equal(sha256(record), "e4cf6298c3f04151669d7948330ce85f51edec2c0efc9eeabe6c3b3ac3e7b740");
    assert.deepEqual(party.position(), [13, 15, 15]);
    const table = tile(m, 120, 88);
    assert.notDeepEqual(table, tile(m, 120, 72));
    traceHutStep(m);
    assert.deepEqual(tile(m, 120, 72), table);

    party.leaveHut();
    party.move(0x4d, 0, 46, 62);
    const forest = tile(m, 56, 72);
    assert.ok(forest.some(colour => colour !== 0));
    assert.notDeepEqual(forest, tile(m, 72, 72));
    const saved = party.save();
    assert.equal(saved.disk.length, player.length);

    const fresh = await bootUltimaTitle(disk);
    const resumed = journeyOnward(fresh, saved.disk);
    assert.deepEqual(resumed.record, saved.record);
    assert.deepEqual(resumed.party.position(), [0, 46, 62]);
    waitForMap(fresh);
    assert.deepEqual(tile(fresh, 56, 72), forest);
    resumed.party.move(0x4b, 0, 45, 62);
    assert.deepEqual(tile(fresh, 72, 72), forest);

    // Resolve the exported file again: the game recreates it on each save.
    const beforeSave = fresh.io.exportDiskette(), oldVolume = inspectFat12(beforeSave);
    assert.deepEqual(readFat12File(beforeSave, oldVolume, oldVolume.entries.find(e => e.name === "SAVED.GAM")!), saved.record);
    const writes: XtDisketteTransfer[] = [], reads: XtDisketteTransfer[] = [];
    const west = resumed.party.save(byte => { if (byte.direction === "memory-to-disk") writes.push(byte); });
    assert.equal(west.base, 0x212d6);
    const volume = inspectFat12(west.disk), entry = volume.entries.find(e => e.name === "SAVED.GAM")!;
    const file = readFat12File(west.disk, volume, entry);
    assert.deepEqual(file, west.record);
    const first = fat12FileRegions(volume, entry).find(region => region.fileOffset === 0)!;
    assert.equal(first.cluster, 355); // The audited second export, not a fixed game sector.
    assert.equal(first.offset, 718 * 512);

    const reboot = await bootUltimaTitle(disk);
    const reload = journeyOnward(reboot, west.disk, byte => { if (byte.direction === "disk-to-memory") reads.push(byte); });
    const cpu = reboot.cpu.snapshot();
    const steps = ultimaSteps<UltimaObservation>("ultima-v");
    const stop = steps.find(step => step.title === "Read the westward step from disk")!;
    assert.equal(stop.execution, [cpu.cs, cpu.ip].map(n => n.toString(16).toUpperCase().padStart(4, "0")).join(":"));
    assert.ok(matchesUltimaObservation(stop.expect, cpu, reboot.ram));
    assert.deepEqual(reload.record, file);

    for (const [offset, before, after] of [[0x2ed, 0, 0], [0x2f0, 46, 45], [0x2f1, 62, 62]] as const) {
      assert.equal(saved.record[offset], before);
      const image = first.offset + offset;
      assert.equal(west.disk[image], after);
      const written = writes.filter(byte => byte.offset === image).at(-1);
      const read = reads.find(byte => byte.offset === image);
      // These three bytes crossed channel 2 directly at the party buffer, in both directions.
      assert.deepEqual([written?.address, written?.value], [west.base + offset, after]);
      assert.deepEqual([read?.address, read?.value], [west.base + offset, after]);
    }
    waitForMap(reboot);
    assert.deepEqual(tile(reboot, 72, 72), forest);

    const directory = process.env.XT_ULTIMA_SAVE_EXPORTS;
    if (directory) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "PLAYER-46-62.IMG"), saved.disk);
      writeFileSync(join(directory, "PLAYER-45-62.IMG"), west.disk);
    }
  });
});
