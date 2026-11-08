import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { readApple2Rom, readApple2Disk } from "../../site/interactive/apple2-media.js";
import type { Apple2Media } from "../../site/interactive/apple2-media.js";
import { createApple2Session, apple2Input } from "../../site/interactive/apple2-session.js";
import { apple2HiresFrame } from "../../site/interactive/apple2-screen.js";
import { encodeApple2SavedState, prepareApple2SavedState } from "../../site/interactive/apple2-saved-state.js";
import { dos33Catalogue, dos33FileSectors } from "../../site/interactive/dos33-catalogue.js";
import { createDos33ReadTrace } from "../../site/interactive/dos33-reads.js";
import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";

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
  savedGame: Identity & { address: number; track: number; sectors: readonly number[] }; continuation: Scene;
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function file(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  return { name: path, size: bytes.length, async arrayBuffer() { return bytes.buffer; } };
}

const romPath = process.env.APPLE2_ROM, diskPath = process.env.APPLE2_MYSTERY_HOUSE_DISK;
test("Mystery House opens, replays a checkpoint, and restores a game from an exported disk", {
  skip: !romPath || !diskPath ? "Set APPLE2_ROM and APPLE2_MYSTERY_HOUSE_DISK to the guide's local media" : false,
}, async t => {
  assert.ok(romPath); assert.ok(diskPath);
  const selected = file(diskPath);
  assert.equal(selected.size, guide.disk.bytes);
  assert.equal(hash(new Uint8Array(await selected.arrayBuffer())), guide.disk.sha256);
  const rom = await readApple2Rom(file(romPath), romImages.firmware, media);
  assert.ok(rom.bootstrap, "Boot needs the 20 KiB container's slot-6 firmware");
  const disk = await readApple2Disk(selected, media.disk, "writable-copy");
  let session = createApple2Session(rom.image, { bootstrap: rom.bootstrap, image: disk.disk });
  async function checkpoint(name: string): Promise<void> {
    const directory = process.env.APPLE2_MYSTERY_HOUSE_CHECKPOINTS;
    if (!directory) return;
    mkdirSync(directory, { recursive: true });
    const saved = await encodeApple2SavedState({ machine: "apple2-plus", name,
      savedAt: new Date().toISOString(), diskName: "mystery-house.dsk", flash: false, state: session.snapshot() });
    writeFileSync(join(directory, `${name}.json`), JSON.stringify(saved));
  }
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
  function runUntil(done: (pc: number) => boolean, limit: number, observe?: (step: Cpu6502StepRecord) => void): void {
    for (let i = 0; i < limit; i++) {
      const step = session.step();
      assert.equal(step.outcome, "executed");
      observe?.(step);
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
  }
  const command = (scene: Scene) => { session.send(apple2Input(scene.command)); waitForInput(); checkScene(scene); };

  function bootToTitle(): void {
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
  }
  function enterGame(): void {
    session.send(apple2Input(guide.scenes[0]!.command));
    runUntil(pc => pc === 0x0800, 80_000_000);
    assert.equal(hash(bytes(0x0800, guide.adventure.bytes)), guide.adventure.sha256);
    waitForInput(20_000_000);
    checkScene(guide.scenes[0]!);
  }
  await t.test("cold boot reaches the notice, then executes the loaded title program", bootToTitle);
  await checkpoint("title");
  await t.test("DOS BRUN loads the exact game binary and draws the front yard", enterGame);
  await checkpoint("yard");
  await t.test("a serialized yard checkpoint replays GO STAIRS with identical hardware and input state", async () => {
    const saved = await encodeApple2SavedState({ machine: "apple2-plus", name: "Mystery House — yard",
      savedAt: "2026-11-07T00:00:00Z", diskName: "mystery-house.dsk", flash: false, state: session.snapshot() });
    command(guide.scenes[1]!);
    const porch = session.snapshot();
    session = (await prepareApple2SavedState(JSON.parse(JSON.stringify(saved)), rom.image, media)).session;
    assert.equal(session.machine.disk.inspect().writable, true);
    checkScene(guide.scenes[0]!);
    command(guide.scenes[1]!);
    assert.deepEqual(session.snapshot(), porch);
  });
  for (const scene of guide.scenes.slice(2)) await t.test(scene.name, () => command(scene));

  await t.test("SAVE GAME writes every byte to disk; a cold RESTORE GAME returns to the hall and allows EAST", async () => {
    assert.equal(hash(session.machine.disk.exportImage()), guide.disk.sha256, "Opening play must not change the disk");
    const { address, bytes: length, track, sectors } = guide.savedGame;
    session.send(apple2Input("SAVE GAME\n"));
    runUntil(pc => pc === 0x66b2, 1_000_000); // Game action, before it issues BSAVE.
    const saved = bytes(address, length);
    assert.equal(hash(saved), guide.savedGame.sha256, "All saved bytes match the independent game runner");
    const sourceReads: number[][] = [], writes: number[][] = [];
    const detach = session.machine.disk.inspectMedium()!.observeWrites(w => writes.push([w.track, w.sector]));
    try {
      runUntil(pc => pc === 0x66d4, 40_000_000, step => {
        if (step.before.pc !== 0xaccf) return; // DOS reads the next BSAVE payload byte.
        for (const a of step.accesses) if (a.kind === "read") sourceReads.push([a.address, a.value]);
      });
    } finally { detach(); }
    assert.deepEqual(sourceReads.filter(([at]) => at! >= address && at! < address + length),
      Array.from(saved, (value, i) => [address + i, value]));
    assert.deepEqual(writes, [...sectors.map(sector => [track, sector]), [17, 12]]);
    waitForInput();
    const hall = { ...guide.scenes[3]!, turn: 5 };
    checkScene(hall);

    const exported = session.machine.disk.exportImage(), image = [...exported];
    const entry = dos33Catalogue(image).files.find(f => f.name === "SAVED GAME");
    assert.ok(entry);
    assert.deepEqual(entry, { name: "SAVED GAME", type: "B", locked: false, count: 10, entry: 0x11c51 });
    const listed = dos33FileSectors(image, entry);
    assert.deepEqual(listed.map(s => s.index), [17 * 16 + 12, track * 16 + 14, ...sectors.map(s => track * 16 + s)]);
    const contents = Uint8Array.from(listed.filter(s => s.fileSector !== undefined)
      .flatMap(s => image.slice(s.index * 256, (s.index + 1) * 256)));
    assert.deepEqual([...contents.slice(0, 4)], [0x30, 0x08, 0xcf, 0x08]);
    assert.deepEqual(contents.slice(4, 4 + length), saved);
    // No bytes outside this binary file change, including its last sector's unused tail.
    const original = new Uint8Array(await selected.arrayBuffer());
    const expectedDisk = original.slice();
    for (const [i, sector] of sectors.entries()) {
      const start = (track * 16 + sector) * 256;
      const first = i === 0 ? 4 : 0, end = Math.min(256, 4 + length - i * 256);
      expectedDisk.set(contents.slice(i * 256 + first, i * 256 + end), start + first);
    }
    assert.deepEqual(exported, expectedDisk);
    assert.equal(hash(original), guide.disk.sha256, "The caller's original disk stays intact");

    const download = { name: "mystery-house-saved.dsk", size: exported.length,
      async arrayBuffer() { return new Uint8Array(exported).buffer; } };
    const mounted = await readApple2Disk(download, media.disk, "read-only");
    session = createApple2Session(rom.image, { bootstrap: rom.bootstrap!, image: mounted.disk });
    bootToTitle(); enterGame(); // Actual cold boot, with no restored hardware or injected RAM.
    const trace = createDos33ReadTrace(), restoredBytes: number[][] = [];
    session.send(apple2Input("RESTORE GAME\n"));
    runUntil(pc => pc === 0x66ff, 25_000_000, step => {
      trace.observe(session.machine, step);
      // This disk's load path copies the two partial sectors, but decodes the
      // seven full sectors directly into their destination RAM through RWTS.
      const pc = step.before.pc;
      if (pc !== 0xbeea && pc !== 0xb8d4 && pc !== 0xbf4e) return;
      for (const a of step.accesses) if (a.kind === "write" && a.address >= address && a.address < address + length) {
        restoredBytes.push([a.address, a.value, pc]);
      }
    });
    assert.deepEqual(bytes(address, length), saved, "BLOAD returns every saved byte before the game updates its workspace");
    assert.deepEqual(restoredBytes, Array.from(saved, (value, i) =>
      [address + i, value, i < 252 ? 0xbeea : i < 252 + 7 * 256 ? 0xb8d4 : 0xbf4e]));
    const search = [[17, 0, 0xb3bb], ...[15, 14, 13, 12].map(s => [17, s, 0xb4bb]), [track, 14, 0x9953]];
    assert.deepEqual(trace.reads.map(r => [r.track, r.sector, r.buffer]), [...search, ...search,
      ...sectors.map((sector, i) => [track, sector, i === 0 || i === 8 ? 0x9853 : address + i * 256 - 4])]);
    for (const read of trace.reads) {
      const at = (read.track * 16 + read.sector) * 256;
      assert.deepEqual(read.bytes, image.slice(at, at + 256));
    }
    waitForInput(); checkScene(hall);
    command(guide.continuation);
    assert.equal(session.machine.disk.inspect().writable, false);
    assert.deepEqual(session.machine.disk.exportImage(), exported, "Restoring and moving do not write to the exported disk");
  });
});
