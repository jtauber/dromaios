import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create8088PcXt, romImages } from "../../../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { renderXtGraphicsFrame } from "../../../../src/machines/8088/pc-xt/video.js";
import { ultimaVParty } from "./ultima-v-party.js";
import { dosTransfer } from "./dos-transfer.js";
import { runInput, scanCodes } from "./rom-console.js";

const { XT_BIOS_ROM, XT_BASIC_ROM, XT_ULTIMA_PROGRAM, XT_ULTIMA_PLAYER } = process.env;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type Firmware = Parameters<typeof create8088PcXt>[0];

function journeyOnward(firmware: Firmware, program: Uint8Array, player: Uint8Array) {
  const machine = create8088PcXt(firmware);
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

  const loaded = dosTransfer(machine, [], "read", 4192);
  runInput(machine, [], { limit: 6_000_000, until: n => {
    if (n % 16384) return false;
    const frame = renderXtGraphicsFrame(machine);
    // Elwood, Shamino and Iolo in the party panel, independently captured from CGA RAM.
    const names = createHash("sha256");
    for (let y = 8; y < 30; y++) names.update(frame.pixels.subarray(y * 320 + 192, y * 320 + 314));
    return names.digest("hex") === "12be222dca4713f658204384521405c4fef3cb6685c4c1e9e18bf97f5206d85e";
  } });
  return { party: ultimaVParty(machine, loaded.base), loaded: loaded.bytes };
}

test("Ultima V saves in Britannia and resumes from the exported Player disk on a fresh XT", {
  skip: !(XT_BIOS_ROM && XT_BASIC_ROM && XT_ULTIMA_PROGRAM && XT_ULTIMA_PLAYER)
    && "Set XT_BIOS_ROM, XT_BASIC_ROM, XT_ULTIMA_PROGRAM and XT_ULTIMA_PLAYER to the audited images.",
}, async () => {
  const program = readFileSync(XT_ULTIMA_PROGRAM!), player = readFileSync(XT_ULTIMA_PLAYER!);
  assert.equal(sha256(program), "5ebb13692c5b41e71a4ee5006050d2cf4994e98c2b90e7a6711cde82eac800ce");
  assert.equal(sha256(player), "135c06d4193b1f01062b27d0f884e2045d0ea0dec667e88b281f0ef466bc9b7a");
  const digest = async (bytes: Uint8Array) => sha256(bytes);
  const firmware = {
    bios: await RomImage.verify(readFileSync(XT_BIOS_ROM!), romImages.bios, digest),
    basic: await RomImage.verify(readFileSync(XT_BASIC_ROM!), romImages.basic, digest), font: null,
  };
  const { party } = journeyOnward(firmware, program, player);
  assert.deepEqual(party.position(), [13, 15, 15]);
  party.move(0x50, 13, 15, 16);
  party.leaveHut();
  party.move(0x4d, 0, 46, 62);
  const saved = party.save();
  assert.equal(saved.disk.length, player.length);
  const resumed = journeyOnward(firmware, program, saved.disk);
  assert.deepEqual(resumed.loaded, saved.record);
  assert.deepEqual(resumed.party.position(), [0, 46, 62]);
  resumed.party.move(0x4b, 0, 45, 62);
});
