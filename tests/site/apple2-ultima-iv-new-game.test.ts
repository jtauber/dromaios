import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { readApple2Rom, readApple2Disk } from "../../site/interactive/apple2-media.js";
import type { Apple2Media } from "../../site/interactive/apple2-media.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { encodeApple2SavedState, prepareApple2SavedState } from "../../site/interactive/apple2-saved-state.js";
import { apple2StorageReader } from "../../site/interactive/apple2-inspection.js";
import { apple2HiresFrame } from "../../site/interactive/apple2-screen.js";
import { Apple2DiskSet } from "../../site/interactive/apple2-disk-set.js";
import { checkUltima4Save, ultima4Binary } from "../helpers/ultima-iv.js";
import type { Ultima4SaveFile } from "../helpers/ultima-iv.js";
import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";

interface Identity { readonly bytes: number; readonly sha256: string }
interface Stop { readonly address: number; readonly bytes: readonly number[] }
interface Scene { readonly x: number; readonly y: number; readonly terrainSha256: string }
function record(path: string): unknown {
  const fences = [...readFileSync(path, "utf8").matchAll(/^```json\n([\s\S]*?)^```$/gm)];
  assert.equal(fences.length, 1); return JSON.parse(fences[0]![1]!);
}
const media = record("src/machines/6502/apple2.md") as Apple2Media;
const guide = record("docs/software/ultima-iv.md") as {
  boot: Identity; britannia: Identity;
  stops: Record<"title" | "menu" | "exchange" | "command", Stop>;
  terrain: { x: number; y: number; width: number; height: number };
  save: { start: Stop; returned: Stop; partyLoaded: Stop; rosterLoaded: Stop; files: readonly Ultima4SaveFile[] };
  newGame: { name: string; sexKey: string; sex: number; class: number; roster: readonly number[];
    attributes: readonly number[]; virtues: readonly number[];
    storyAdvances: number; pairs: readonly (readonly number[])[];
    stops: Record<"name" | "codeLoaded" | "story" | "question" | "cards" | "chosen" | "lastStory" | "templates" | "created" | "newParty", Stop>;
    arrival: Scene; slow: Scene; moved: Scene; resumed: Scene; continuation: Scene };
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function file(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  return { name: path, size: bytes.length, async arrayBuffer() { return bytes.buffer; } };
}
const romPath = process.env.APPLE2_ROM, bootPath = process.env.APPLE2_ULTIMA_IV_BOOT;
const britanniaPath = process.env.APPLE2_ULTIMA_IV_BRITANNIA;

test("Ultima IV creates a new character, saves it, and resumes it after a cold boot", {
  skip: !romPath || !bootPath || !britanniaPath
    ? "Set APPLE2_ROM, APPLE2_ULTIMA_IV_BOOT and APPLE2_ULTIMA_IV_BRITANNIA for character creation" : false,
}, async t => {
  assert.ok(romPath); assert.ok(bootPath); assert.ok(britanniaPath);
  async function disk(path: string, identity: Identity, writable = false) {
    const selected = file(path);
    assert.equal(selected.size, identity.bytes);
    assert.equal(hash(new Uint8Array(await selected.arrayBuffer())), identity.sha256);
    return (await readApple2Disk(selected, media.disk, writable ? "writable-copy" : "read-only")).disk;
  }
  const rom = await readApple2Rom(file(romPath), romImages.firmware, media); assert.ok(rom.bootstrap);
  const boot = await disk(bootPath, guide.boot), britannia = await disk(britanniaPath, guide.britannia, true);
  let session = createApple2Session(rom.image, { bootstrap: rom.bootstrap, image: boot });
  let diskName = "ultima_iv_boot.dsk", set = new Apple2DiskSet();
  set.add([{ name: diskName, disk: boot }, { name: "ultima_iv_br-new-game.dsk", disk: britannia }]);
  const creation = guide.newGame, stops = creation.stops;
  const ram = (address: number, length: number) => Uint8Array.from({ length }, (_, i) => session.machine.ram.read(address + i));
  const upper = (address: number, length: number) => Uint8Array.from({ length }, (_, i) => session.machine.upper.read(address - 0xe000 + i));
  function runTo(stop: Stop, key?: string | number, limit = 30_000_000, observe?: (step: Cpu6502StepRecord) => void): void {
    if (key !== undefined) session.send([typeof key === "string" ? key.charCodeAt(0) : key]);
    for (let i = 0; i < limit; i++) {
      const step = session.step(); assert.equal(step.outcome, "executed"); observe?.(step);
      if (step.after.pc !== stop.address) continue;
      assert.deepEqual([...ram(stop.address, stop.bytes.length)], stop.bytes);
      t.diagnostic(`Reached $${stop.address.toString(16).toUpperCase()} after ${(i + 1).toLocaleString()} instructions`);
      return;
    }
    assert.fail(`Did not reach $${stop.address.toString(16)}; PC=$${session.machine.cpu.snapshot().pc.toString(16)}`);
  }
  async function snapshot(name: string) {
    return encodeApple2SavedState({ machine: "apple2-plus", name, savedAt: "2026-11-09T00:00:00Z", diskName,
      flash: false, state: session.snapshot(), diskSet: set.snapshot(session.machine.disk.medium) });
  }
  async function checkpoint(name: string): Promise<void> {
    const directory = process.env.APPLE2_ULTIMA_IV_CHECKPOINTS;
    if (!directory) return;
    mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, `${name}.json`), JSON.stringify(await snapshot(name)));
  }
  function checkCharacter(): void {
    assert.equal(session.machine.ram.read(15), 1, "The new party has one member");
    assert.deepEqual([...upper(0xec00, 16)], [...creation.name].map(c => c.charCodeAt(0) | 128).concat(Array(16 - creation.name.length).fill(0)));
    assert.deepEqual([...upper(0xec10, 3)], [creation.sex, creation.class, 0xc7], "Male/female glyph, class, and Good status");
  }
  function checkScene(scene: Scene): void {
    checkCharacter(); assert.deepEqual([...ram(0, 2)], [scene.x, scene.y]);
    assert.deepEqual(session.machine.video.snapshot(), { text: false, mixed: false, page2: false, hires: true });
    assert.equal(session.pendingInput, 0); assert.equal(session.machine.disk.inspect().motor, false);
    const { x: left, y: top, width, height } = guide.terrain;
    const dots = Uint8Array.from({ length: width * height }, (_, i) => {
      const x = left + i % width, y = top + Math.floor(i / width);
      const address = 0x2000 + y % 8 * 0x400 + Math.floor(y / 8) % 8 * 0x80 + Math.floor(y / 64) * 40 + Math.floor(x / 7);
      return session.machine.ram.read(address) >> x % 7 & 1;
    });
    assert.equal(hash(dots), scene.terrainSha256);
    const displayed = apple2HiresFrame(session.machine.ram, session.machine.video, true);
    assert.deepEqual(displayed.slice(top, top + height).flatMap(row => row!.slice(left, left + width)), [...dots]);
  }
  await t.test("a cold boot accepts the name and sex and loads the character-creation program", async () => {
    runTo(guide.stops.title, undefined, 200_000_000); runTo(guide.stops.menu, " ");
    await checkpoint("ultima-iv-new-game-menu");
    runTo(stops.name, "I"); for (const key of creation.name) runTo(stops.name, key);
    runTo(guide.stops.menu, 13); assert.deepEqual([...ram(0x300, 16)], [...creation.name].map(c => c.charCodeAt(0) | 128).concat(Array(16 - creation.name.length).fill(0)));
    runTo(stops.codeLoaded, creation.sexKey, 50_000_000);
    const code = ultima4Binary(boot, "N·EWGAME"); assert.equal(code.length, 13141);
    assert.deepEqual(ram(0x6400, code.length), code, "BRUN honors the explicit $6400 load address");
    runTo(stops.story); await checkpoint("ultima-iv-new-game-story");
  });
  await t.test("the story and seven A answers create the mage with decimal attributes", async () => {
    for (let page = 0; page < creation.storyAdvances; page++) runTo(stops.story, " ");
    runTo(stops.question, " ");
    for (let question = 0; question < 7; question++) {
      assert.equal(session.machine.ram.read(0x67f8), question);
      assert.deepEqual([...ram(0x67f6, 2)], creation.pairs[question]);
      if (question === 0) await checkpoint("ultima-iv-new-game-question");
      const saved = question === 3 ? await snapshot("Fourth question") : undefined;
      const next = question === 6 ? stops.chosen : stops.cards;
      runTo(next, "A");
      if (saved) {
        const answered = session.snapshot(), restored = await prepareApple2SavedState(JSON.parse(JSON.stringify(saved)), rom.image, media);
        session = restored.session; set = restored.diskSet;
        assert.deepEqual(session.snapshot(), saved.state); runTo(next, "A");
        assert.deepEqual(session.snapshot(), answered, "Replaying the answer preserves every hardware and input byte");
      }
      if (question < 6) runTo(stops.question, " ");
    }
    assert.equal(session.machine.ram.read(0x67f5), creation.class);
    // The old emulator ignores decimal mode; these expectations come from the game's tables.
    assert.deepEqual([...ram(0x6809, 3)], creation.attributes);
    assert.deepEqual([...ram(0x6824, 8)], creation.virtues);
    runTo(stops.lastStory, " "); runTo(stops.templates, " ");
    assert.deepEqual(ram(0, 32), ultima4Binary(boot, "N·PRT"));
    assert.deepEqual(upper(0xee00, 256), ultima4Binary(boot, "N·LST"));
    assert.deepEqual(upper(0xec00, 384), ultima4Binary(boot, "N·RST"));
    runTo(stops.created); checkCharacter(); await checkpoint("ultima-iv-new-game-created");
  });
  await t.test("Britannia preserves the new party instead of reading the old save and accepts a move", async () => {
    runTo(guide.stops.exchange, undefined, 80_000_000); await checkpoint("ultima-iv-new-game-exchange");
    const medium = set.entries[1]!; session.swapDisk(medium.disk); diskName = medium.name;
    runTo(stops.newParty, 27); checkCharacter();
    let readOldParty = false;
    runTo(guide.stops.command, undefined, 10_000_000, step => { if (step.before.pc === guide.save.partyLoaded.address) readOldParty = true; });
    assert.equal(readOldParty, false, "Nonzero party size bypasses BLOAD PRTY");
    checkScene(creation.arrival); assert.deepEqual([...upper(0xec00, 32)], creation.roster);
    await checkpoint("ultima-iv-new-game-world");
    runTo(guide.stops.command, 10); checkScene(creation.slow);
    runTo(guide.stops.command, 10); checkScene(creation.moved);
    assert.equal(hash(session.machine.disk.exportImage()), guide.britannia.sha256, "Creation and movement have not yet saved to Britannia");
    assert.equal(hash(set.entries[0]!.disk.exportImage()), guide.boot.sha256);
  });
  await t.test("Q saves the new party and a fresh Journey onward restores every saved block", async () => {
    const original = session.machine.disk.exportImage(); runTo(guide.save.start, "Q");
    const read = apple2StorageReader(session.machine);
    const saved = guide.save.files.map(file => ({ ...file, payload: Uint8Array.from({ length: file.bytes + 1 }, (_, i) => {
      const byte = read(file.address + i); assert.notEqual(byte, undefined); return byte!;
    }) }));
    const writes: number[][] = [], sourceReads: number[][] = [];
    const detach = session.machine.disk.medium!.observeWrites(w => writes.push([w.track, w.sector]));
    try { runTo(guide.save.returned, undefined, 50_000_000, step => {
      if (step.before.pc !== 0xacc7) return;
      const access = step.accesses.filter(a => a.kind === "read").at(-1)!; sourceReads.push([access.address, access.value]);
    }); } finally { detach(); }
    assert.deepEqual(sourceReads, saved.flatMap(file => Array.from(file.payload, (value, i) => [file.address + i, value])));
    assert.deepEqual(writes, saved.flatMap(file => [...file.sectors.map(sector => [file.track, sector]), [17, 13]]));
    const exported = session.machine.disk.exportImage(); checkUltima4Save(original, exported, saved);
    runTo(guide.stops.command); await checkpoint("ultima-iv-new-game-saved");
    const directory = process.env.APPLE2_ULTIMA_IV_CHECKPOINTS;
    if (directory) writeFileSync(join(directory, "ultima_iv_br-new-game-saved.dsk"), exported);
    session = createApple2Session(rom.image, { bootstrap: rom.bootstrap!, image: set.entries[0]!.disk }); diskName = "ultima_iv_boot.dsk";
    runTo(guide.stops.title, undefined, 200_000_000); runTo(guide.stops.menu, " "); runTo(guide.stops.exchange, "J", 80_000_000);
    const loaded = await readApple2Disk({ name: "ultima_iv_br-new-game-saved.dsk", size: exported.length,
      async arrayBuffer() { return new Uint8Array(exported).buffer; } }, media.disk, "read-only");
    set.add([{ name: loaded.name, disk: loaded.disk }]); session.swapDisk(loaded.disk); diskName = loaded.name;
    runTo(guide.save.partyLoaded, 27);
    assert.deepEqual(ram(0, 32), saved.find(file => file.name === "PRTY")!.payload.slice(0, 32));
    runTo(guide.save.rosterLoaded);
    for (const file of saved.filter(file => file.name !== "PRTY")) assert.deepEqual(upper(file.address, file.bytes), file.payload.slice(0, file.bytes));
    runTo(guide.stops.command); checkScene(creation.resumed); await checkpoint("ultima-iv-new-game-resumed");
    runTo(guide.stops.command, 10); checkScene(creation.continuation); await checkpoint("ultima-iv-new-game-continued");
    assert.deepEqual(session.machine.disk.exportImage(), exported);
    assert.equal(hash(set.entries[0]!.disk.exportImage()), guide.boot.sha256);
  });
});
