import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { readApple2Rom, readApple2Disk } from "../../site/interactive/apple2-media.js";
import type { Apple2Media } from "../../site/interactive/apple2-media.js";
import { createApple2Session, apple2Input } from "../../site/interactive/apple2-session.js";
import { apple2HiresFrame } from "../../site/interactive/apple2-screen.js";
import { encodeApple2SavedState, prepareApple2SavedState } from "../../site/interactive/apple2-saved-state.js";

interface Identity { readonly bytes: number; readonly sha256: string }
interface Scene {
  readonly name: string; readonly command: string; readonly room: number;
  readonly turn: number; readonly picture: number; readonly text: string; readonly dotsSha256: string;
}
function record(path: string): unknown {
  const fences = [...readFileSync(path, "utf8").matchAll(/^```json\n([\s\S]*?)^```$/gm)];
  assert.equal(fences.length, 1, `${path} must own one acceptance record`);
  return JSON.parse(fences[0]![1]!);
}
const media = record("src/machines/6502/apple2.md") as Apple2Media;
const guide = record("docs/software/mystery-house.md") as {
  disk: Identity; title: Identity & { dotsSha256: string }; adventure: Identity; scenes: readonly Scene[];
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function file(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  return { name: path, size: bytes.length, async arrayBuffer() { return bytes.buffer; } };
}

const romPath = process.env.APPLE2_ROM, diskPath = process.env.APPLE2_MYSTERY_HOUSE_DISK;
test("Mystery House cold-boots, draws the opening rooms, and replays a saved command", {
  skip: !romPath || !diskPath ? "Set APPLE2_ROM and APPLE2_MYSTERY_HOUSE_DISK to the guide's local media" : false,
}, async t => {
  assert.ok(romPath); assert.ok(diskPath);
  const selected = file(diskPath);
  assert.equal(selected.size, guide.disk.bytes);
  assert.equal(hash(new Uint8Array(await selected.arrayBuffer())), guide.disk.sha256);
  const rom = await readApple2Rom(file(romPath), romImages.firmware, media);
  assert.ok(rom.bootstrap, "Boot needs the 20 KiB container's slot-6 firmware");
  const disk = await readApple2Disk(selected, media.disk, "read-only");
  let session = createApple2Session(rom.image, { bootstrap: rom.bootstrap, image: disk.disk });
  const bytes = (address: number, length: number) => Uint8Array.from({ length }, (_, i) => session.machine.ram.read(address + i));

  // Independent address equations, not the video device's address/character helpers.
  function text(): string {
    return Array.from({ length: 24 }, (_, y) => Array.from(bytes(0x400 + y % 8 * 128 + Math.floor(y / 8) * 40, 40), b => {
      const code = b & 63; return String.fromCharCode(code < 32 ? code + 64 : code);
    }).join("").trimEnd()).join("\n");
  }
  function checkPicture(expected: string): void {
    assert.deepEqual(session.machine.video.snapshot(), { text: false, mixed: true, page2: false, hires: true });
    const dots = Uint8Array.from({ length: 160 * 280 }, (_, i) => {
      const y = Math.floor(i / 280), x = i % 280;
      const address = 0x2000 + y % 8 * 0x400 + Math.floor(y / 8) % 8 * 0x80 + Math.floor(y / 64) * 40 + Math.floor(x / 7);
      return (session.machine.ram.read(address) >> (x % 7)) & 1;
    });
    assert.equal(hash(dots), expected, "Visible dots must match the independently executed game");
    const displayed = apple2HiresFrame(session.machine.ram, session.machine.video, true);
    assert.deepEqual(displayed.slice(0, 160).flat(), [...dots]);
    assert.ok(displayed.slice(160).every(row => row === undefined), "Mixed mode leaves four rows for text");
  }
  function runUntil(done: (pc: number) => boolean, limit: number): void {
    for (let i = 0; i < limit; i++) {
      const step = session.step();
      assert.equal(step.outcome, "executed");
      if (done(step.after.pc)) return;
    }
    assert.fail(`No stop after ${limit} instructions at $${session.machine.cpu.snapshot().pc.toString(16)}:\n${text()}`);
  }
  function waitForInput(limit = 10_000_000): void {
    let polls = 0;
    runUntil(pc => {
      // Stop just before KEYIN2 reads the keyboard, after the final queued key
      // has returned through ROM/DOS and the next input wait has begun.
      if (pc === 0xfd21 && !session.pendingInput && !session.machine.keyboard.snapshot().strobe) polls++;
      return polls === 10;
    }, limit);
  }
  function checkScene(scene: Scene): void {
    assert.equal(session.machine.ram.read(0x852), scene.room);
    assert.equal(session.machine.ram.read(0x853) | session.machine.ram.read(0x854) << 8, scene.turn);
    assert.equal(session.machine.ram.read(0x839), scene.picture);
    assert.ok(text().includes(scene.text), scene.text);
    assert.match(text(), /ENTER COMMAND\?\s*$/);
    checkPicture(scene.dotsSha256);
    assert.equal(session.machine.disk.inspect().writable, false);
    assert.equal(hash(session.machine.disk.exportImage()), guide.disk.sha256);
  }
  const command = (scene: Scene) => { session.send(apple2Input(scene.command)); waitForInput(); checkScene(scene); };

  await t.test("cold boot reaches the notice, then executes the loaded title program", () => {
    waitForInput(80_000_000);
    assert.ok(session.machine.video.snapshot().text);
    assert.match(text(), /DOMAIN IN 1987/);
    assert.match(text(), /PLAYED IT\./);
    session.send(apple2Input(" "));
    runUntil(pc => pc === 0x0ffd, 1_000_000);
    assert.equal(hash(bytes(0x0ffd, guide.title.bytes)), guide.title.sha256);
    waitForInput();
    assert.match(text(), /ENTER G FOR GAME OR I FOR INSTRUCTIONS/);
    checkPicture(guide.title.dotsSha256);
  });
  await t.test("DOS BRUN loads the exact game binary and draws the front yard", () => {
    session.send(apple2Input(guide.scenes[0]!.command));
    runUntil(pc => pc === 0x0800, 80_000_000);
    assert.equal(hash(bytes(0x0800, guide.adventure.bytes)), guide.adventure.sha256);
    waitForInput(20_000_000);
    checkScene(guide.scenes[0]!);
  });
  await t.test("a serialized yard checkpoint replays GO STAIRS with identical hardware and input state", async () => {
    const saved = await encodeApple2SavedState({ machine: "apple2-plus", name: "Mystery House — yard",
      savedAt: "2026-11-07T00:00:00Z", diskName: "mystery-house.dsk", flash: false, state: session.snapshot() });
    command(guide.scenes[1]!);
    const porch = session.snapshot();
    session = (await prepareApple2SavedState(JSON.parse(JSON.stringify(saved)), rom.image, media)).session;
    checkScene(guide.scenes[0]!);
    command(guide.scenes[1]!);
    assert.deepEqual(session.snapshot(), porch);
  });
  for (const scene of guide.scenes.slice(2)) await t.test(scene.name, () => command(scene));
});
