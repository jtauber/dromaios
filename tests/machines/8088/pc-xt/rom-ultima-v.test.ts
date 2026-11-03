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

type Xt = ReturnType<typeof create8088PcXt>;
type Firmware = Parameters<typeof create8088PcXt>[0];

// Capture the party record when DOS returns from its read or write. The same
// buffer holds the live coordinates after the game resumes.
function partyTransfer(machine: Xt, input: number[], operation: "read" | "write") {
  const functionNumber = operation === "read" ? 0x3f : 0x40, size = 4192;
  let returnCs = -1, returnIp = -1, base = 0;
  runInput(machine, input, { limit: 2_000_000, until: (_, { before, after, instruction }) => {
    if (before.ah === functionNumber && before.cx === size && instruction?.bytes[0] === 0xcd && instruction.bytes[1] === 0x21) {
      base = ((before.ds << 4) + before.dx) & 0xfffff;
      returnCs = before.cs; returnIp = (before.ip + 2) & 0xffff;
    }
    if (after.cs !== returnCs || after.ip !== returnIp) return false;
    assert.equal(after.flags.cf, false); assert.equal(after.ax, size);
    return true;
  } });
  return { base, bytes: Uint8Array.from({ length: size }, (_, i) => machine.ram.read(base + i)) };
}

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

  const loaded = partyTransfer(machine, [], "read");
  const position = () => [0x2ed, 0x2f0, 0x2f1].map(offset => machine.ram.read(loaded.base + offset));
  runInput(machine, [], { limit: 6_000_000, until: n => {
    if (n % 16384) return false;
    const frame = renderXtGraphicsFrame(machine);
    // Elwood, Shamino and Iolo in the party panel, independently captured from CGA RAM.
    const names = createHash("sha256");
    for (let y = 8; y < 30; y++) names.update(frame.pixels.subarray(y * 320 + 192, y * 320 + 314));
    return names.digest("hex") === "12be222dca4713f658204384521405c4fef3cb6685c4c1e9e18bf97f5206d85e";
  } });
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
  return { machine, position, loaded: loaded.bytes, press, move };
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
  const { machine, position, press, move } = journeyOnward(firmware, program, player);
  assert.deepEqual(position(), [13, 15, 15]);
  for (let y = 16; y <= 18; y++) move(0x50, 13, 15, y);
  press(0x18); press(0x50); // O, Down opens the south door.
  for (let y = 19; y <= 31; y++) move(0x50, 13, 15, y);
  press(0x50); // "Dost thou wish to leave?"
  move(0x15, 0, 45, 62); // Y, for yes.
  move(0x4d, 0, 46, 62); // Right on the outdoor map.
  press(0x10); // Q: Quit and Save.
  const saved = partyTransfer(machine, [0x15, 0x95], "write"); // Y at "Save game?"
  // SAVED.OOL follows SAVED.GAM. Wait for the game to finish both transfers
  // and for the BIOS to release the motor, as Drive A requires for export.
  runInput(machine, [], { limit: 2_000_000, until: (_, { before, instruction }) =>
    !machine.io.disketteMotorOn && before.cs === 0x0c6f && before.ah === 1
    && instruction?.bytes[0] === 0xcd && instruction.bytes[1] === 0x16 });
  const exported = machine.io.exportDiskette();
  assert.equal(exported.length, player.length);
  const resumed = journeyOnward(firmware, program, exported);
  assert.deepEqual(resumed.loaded, saved.bytes);
  assert.deepEqual(resumed.position(), [0, 46, 62]);
  resumed.move(0x4b, 0, 45, 62);
});
