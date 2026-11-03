import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create8088PcXt, romImages } from "../../../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { renderXtGraphicsFrame } from "../../../../src/machines/8088/pc-xt/video.js";
import { runInput, scanCodes } from "./rom-console.js";

const { XT_BIOS_ROM, XT_BASIC_ROM, XT_ULTIMA_PROGRAM, XT_ULTIMA_PLAYER } = process.env;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("Ultima V loads its Player disk, leaves Iolo’s hut and walks east in Britannia", {
  skip: !(XT_BIOS_ROM && XT_BASIC_ROM && XT_ULTIMA_PROGRAM && XT_ULTIMA_PLAYER)
    && "Set XT_BIOS_ROM, XT_BASIC_ROM, XT_ULTIMA_PROGRAM and XT_ULTIMA_PLAYER to the audited images.",
}, async () => {
  const program = readFileSync(XT_ULTIMA_PROGRAM!), player = readFileSync(XT_ULTIMA_PLAYER!);
  assert.equal(sha256(program), "5ebb13692c5b41e71a4ee5006050d2cf4994e98c2b90e7a6711cde82eac800ce");
  assert.equal(sha256(player), "135c06d4193b1f01062b27d0f884e2045d0ea0dec667e88b281f0ef466bc9b7a");
  const digest = async (bytes: Uint8Array) => sha256(bytes);
  const machine = create8088PcXt({
    bios: await RomImage.verify(readFileSync(XT_BIOS_ROM!), romImages.bios, digest),
    basic: await RomImage.verify(readFileSync(XT_BASIC_ROM!), romImages.basic, digest), font: null,
  });
  machine.io.setDiskette(program); machine.reset();
  runInput(machine, [], { limit: 28_000_000, until: n => n % 16384 === 0 && machine.cga.graphicsSupported()
    && renderXtGraphicsFrame(machine).pixels.includes(3) }); // First cyan pixels of the Origin logo.
  runInput(machine, scanCodes(" "), { limit: 5_000_000, until: n => {
    if (n % 16384) return false;
    const strip = renderXtGraphicsFrame(machine).pixels.slice(128 * 320);
    return sha256(strip.map(rgb => rgb >> 1)) === "3bbffd83042b0d0062a60f57bab4baddae4846a47689967b824b1264ed148550";
  } });
  // The first failed open of SAVED.GAM returns to the game's disk search loop.
  runInput(machine, scanCodes("\n"), { limit: 4_000_000, until: (_, { after }) =>
    after.cs === 0x0c6f && after.ip === 0x7249 && after.flags.cf && after.ax === 2 });
  machine.io.setDiskette(player, { writable: true });

  // DOS reads this edition's 4192-byte SAVED.GAM into DS:DX. Observe that buffer in place.
  let saveBase = 0;
  runInput(machine, [], { limit: 2_000_000, until: (_, { before, instruction }) => {
    if (before.ax >> 8 !== 0x3f || before.cx !== 4192 || instruction?.bytes[0] !== 0xcd || instruction.bytes[1] !== 0x21) return false;
    saveBase = ((before.ds << 4) + before.dx) & 0xfffff;
    return true;
  } });
  const position = () => [0x2ed, 0x2f0, 0x2f1].map(offset => machine.ram.read(saveBase + offset));
  runInput(machine, [], { limit: 6_000_000, until: n => {
    if (n % 16384) return false;
    const frame = renderXtGraphicsFrame(machine);
    // Elwood, Shamino and Iolo in the party panel, independently captured from CGA RAM.
    const names = createHash("sha256");
    for (let y = 8; y < 30; y++) names.update(frame.pixels.subarray(y * 320 + 192, y * 320 + 314));
    return names.digest("hex") === "12be222dca4713f658204384521405c4fef3cb6685c4c1e9e18bf97f5206d85e";
  } });
  assert.deepEqual(position(), [13, 15, 15]);
  // Wait for DOS to consume the key and the game to poll again. In particular
  // the O command loads its overlay before it asks for a direction.
  function press(scan: number) {
    let consumed = false;
    runInput(machine, [scan, scan | 0x80], { limit: 2_000_000, until: (_, { before, instruction }) => {
      if (instruction?.bytes[0] !== 0xcd || instruction.bytes[1] !== 0x16) return false;
      if (before.ax >> 8 === 0) consumed = true;
      return consumed && before.cs === 0x0c6f && before.ax >> 8 === 1;
    } });
  }
  function move(scan: number, location: number, x: number, y: number) {
    press(scan); assert.deepEqual(position(), [location, x, y]);
  }
  for (let y = 16; y <= 18; y++) move(0x50, 13, 15, y);
  press(0x18); press(0x50); // O, Down opens the south door.
  for (let y = 19; y <= 31; y++) move(0x50, 13, 15, y);
  press(0x50); // "Dost thou wish to leave?"
  move(0x15, 0, 45, 62); // Y, for yes.
  move(0x4d, 0, 46, 62); // Right on the outdoor map.
  move(0x4b, 0, 45, 62);
});
