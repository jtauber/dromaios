import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { readApple2Rom, readApple2Disk } from "../../site/interactive/apple2-media.js";
import type { Apple2Media } from "../../site/interactive/apple2-media.js";
import { createApple2Session, apple2ControlKey } from "../../site/interactive/apple2-session.js";
import { apple2HiresFrame } from "../../site/interactive/apple2-screen.js";
import { encodeApple2SavedState, prepareApple2SavedState } from "../../site/interactive/apple2-saved-state.js";
import { apple2StorageReader } from "../../site/interactive/apple2-inspection.js";
import { dos33Catalogue, dos33FileSectors } from "../../site/interactive/dos33-catalogue.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";

interface Identity { readonly bytes: number; readonly sha256: string }
interface Stop { readonly address: number; readonly bytes: readonly number[] }
interface Scene { readonly name: string; readonly x: number; readonly y: number; readonly terrainSha256: string }
function record(path: string): unknown {
  const fences = [...readFileSync(path, "utf8").matchAll(/^```json\n([\s\S]*?)^```$/gm)];
  assert.equal(fences.length, 1, `${path} must own one acceptance record`);
  return JSON.parse(fences[0]![1]!);
}
const media = record("src/machines/6502/apple2.md") as Apple2Media;
const guide = record("docs/software/ultima-iv.md") as {
  boot: Identity; britannia: Identity; stops: Record<"title" | "menu" | "exchange" | "command", Stop>;
  terrain: { x: number; y: number; width: number; height: number }; scenes: readonly Scene[];
  save: { start: Stop; returned: Stop; partyLoaded: Stop; rosterLoaded: Stop;
    files: readonly { name: string; address: number; bytes: number; track: number; sectors: readonly number[] }[] };
  resumed: Scene; continuation: Scene;
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function file(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  return { name: path, size: bytes.length, async arrayBuffer() { return bytes.buffer; } };
}

const romPath = process.env.APPLE2_ROM, bootPath = process.env.APPLE2_ULTIMA_IV_BOOT;
const britanniaPath = process.env.APPLE2_ULTIMA_IV_BRITANNIA;
test("Ultima IV boots, exchanges disks, replays a move, and resumes a game from an exported disk", {
  skip: !romPath || !bootPath || !britanniaPath
    ? "Set APPLE2_ROM, APPLE2_ULTIMA_IV_BOOT and APPLE2_ULTIMA_IV_BRITANNIA to the guide's local media" : false,
}, async t => {
  assert.ok(romPath); assert.ok(bootPath); assert.ok(britanniaPath);
  async function disk(path: string, identity: Identity) {
    const selected = file(path);
    assert.equal(selected.size, identity.bytes);
    assert.equal(hash(new Uint8Array(await selected.arrayBuffer())), identity.sha256);
    return (await readApple2Disk(selected, media.disk, "read-only")).disk;
  }
  const rom = await readApple2Rom(file(romPath), romImages.firmware, media);
  assert.ok(rom.bootstrap, "Boot needs the 20 KiB container's slot-6 firmware");
  const boot = await disk(bootPath, guide.boot), britannia = await disk(britanniaPath, guide.britannia);
  let session = createApple2Session(rom.image, { bootstrap: rom.bootstrap, image: boot });
  let diskName = "ultima_iv_boot.dsk";
  function runTo(stop: Stop, limit: number, observe?: (step: Cpu6502StepRecord) => void): void {
    // Execute at least once: a move starts and finishes at the same command boundary.
    for (let i = 0; i < limit; i++) {
      const step = session.step();
      assert.equal(step.outcome, "executed");
      observe?.(step);
      if (step.after.pc !== stop.address) continue;
      assert.deepEqual(stop.bytes.map((_, offset) => session.machine.ram.read(stop.address + offset)), stop.bytes);
      t.diagnostic(`Reached $${stop.address.toString(16).toUpperCase()} after ${(i + 1).toLocaleString()} instructions`);
      return;
    }
    assert.fail(`Did not reach $${stop.address.toString(16)} after ${limit} instructions; PC=$${session.machine.cpu.snapshot().pc.toString(16)}`);
  }
  async function savedState(name: string) {
    return encodeApple2SavedState({ machine: "apple2-plus", name, savedAt: "2026-11-08T00:00:00Z",
      diskName, flash: false, state: session.snapshot() });
  }
  async function checkpoint(name: string): Promise<void> {
    const directory = process.env.APPLE2_ULTIMA_IV_CHECKPOINTS;
    if (!directory) return;
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${name}.json`), JSON.stringify(await savedState(name)));
  }
  function checkScene(scene: Scene): void {
    assert.deepEqual([session.machine.ram.read(0), session.machine.ram.read(1)], [scene.x, scene.y], scene.name);
    assert.deepEqual(session.machine.video.snapshot(), { text: false, mixed: false, page2: false, hires: true });
    const { x: left, y: top, width, height } = guide.terrain;
    // Independent hardware address equations, not the renderer's addressing helpers.
    const dots = Uint8Array.from({ length: width * height }, (_, i) => {
      const x = left + i % width, y = top + Math.floor(i / width);
      const address = 0x2000 + y % 8 * 0x400 + Math.floor(y / 8) % 8 * 0x80 + Math.floor(y / 64) * 40 + Math.floor(x / 7);
      return (session.machine.ram.read(address) >> (x % 7)) & 1;
    });
    assert.equal(hash(dots), scene.terrainSha256, "Terrain matches the independently executed game");
    const displayed = apple2HiresFrame(session.machine.ram, session.machine.video, true);
    assert.deepEqual(displayed.slice(top, top + height).flatMap(row => row!.slice(left, left + width)), [...dots]);
    assert.equal(session.pendingInput, 0);
    assert.equal(session.machine.disk.inspect().motor, false);
  }
  function moveEast(scene = guide.scenes[1]!): void {
    const key = apple2ControlKey({ key: "ArrowRight", ctrlKey: false, metaKey: false, altKey: false, isComposing: false });
    assert.equal(key, 21);
    session.send([key!]); runTo(guide.stops.command, 2_000_000); checkScene(scene);
  }
  function bootToExchange(): void {
    runTo(guide.stops.title, 200_000_000);
    session.send([32]); runTo(guide.stops.menu, 10_000_000);
    session.send([74]); runTo(guide.stops.exchange, 80_000_000);
    assert.equal(session.machine.disk.inspect().motor, false);
  }
  await t.test("cold boot reaches the title, menu, and Britannia disk request", bootToExchange);
  await checkpoint("ultima-iv-exchange");
  await t.test("disk exchange preserves the machine before Escape loads the world", () => {
    const { disk: beforeDisk, ...beforeHardware } = session.snapshot().hardware;
    const beforeInput = session.snapshot().input, machine = session.machine;
    session.swapDisk(britannia); diskName = "ultima_iv_br.dsk";
    const { disk: afterDisk, ...afterHardware } = session.snapshot().hardware;
    assert.equal(session.machine, machine);
    assert.deepEqual(afterHardware, beforeHardware);
    assert.deepEqual(session.snapshot().input, beforeInput);
    assert.deepEqual(afterDisk, { ...beforeDisk, media: britannia.snapshot(), position: 0, byteClocks: 0, latch: 0 });
    session.send([27]); runTo(guide.stops.command, 80_000_000); checkScene(guide.scenes[0]!);
  });
  await checkpoint("ultima-iv-britannia");
  await t.test("Right Arrow moves east and serialized checkpoint replay reproduces every hardware byte", async () => {
    const saved = await savedState("Ultima IV — Britannia");
    moveEast(); const east = session.snapshot();
    const restored = await prepareApple2SavedState(JSON.parse(JSON.stringify(saved)), rom.image, media);
    session = restored.session;
    assert.equal(restored.diskName, "ultima_iv_br.dsk");
    assert.equal(session.machine.disk.inspect().writable, false);
    checkScene(guide.scenes[0]!); moveEast();
    assert.deepEqual(session.snapshot(), east);
    assert.equal(hash(boot.exportImage()), guide.boot.sha256);
    assert.equal(hash(session.machine.disk.exportImage()), guide.britannia.sha256);
  });
  await checkpoint("ultima-iv-east");

  await t.test("Q saves the three declared files; an exported disk restores them after a cold boot and allows another move", async () => {
    const original = session.machine.disk.exportImage();
    session.swapDisk(new Dos33Disk(original, { writable: true }));
    session.send([81]); runTo(guide.save.start, 10_000_000);
    const read = apple2StorageReader(session.machine);
    const bytes = (address: number, length: number) => Uint8Array.from({ length }, (_, i) => {
      const byte = read(address + i); assert.notEqual(byte, undefined); return byte!;
    });
    // This disk's DOS BSAVE checks its count after copying: each file receives
    // its declared payload plus one trailing byte outside the binary length.
    const saved = guide.save.files.map(file => ({ ...file, payload: bytes(file.address, file.bytes + 1) }));
    const commands = saved.map(file => `\x04BSAVE ${file.name},A$${file.address.toString(16).toUpperCase()},L$${file.bytes.toString(16).toUpperCase()}\r`).join("") + "\0";
    assert.equal(String.fromCharCode(...bytes(guide.save.start.address + 3, commands.length).map(b => b & 0x7f)), commands);
    const sourceReads: number[][] = [], writes: number[][] = [];
    const detach = session.machine.disk.inspectMedium()!.observeWrites(w => writes.push([w.track, w.sector]));
    try {
      runTo(guide.save.returned, 50_000_000, step => {
        if (step.before.pc !== 0xacc7) return; // LDA ($42),Y: the last read is the source byte, after the pointer.
        const access = step.accesses.filter(a => a.kind === "read").at(-1)!;
        sourceReads.push([access.address, access.value]);
      });
    } finally { detach(); }
    assert.deepEqual(sourceReads, saved.flatMap(file => Array.from(file.payload, (value, i) => [file.address + i, value])));
    assert.deepEqual(writes, saved.flatMap(file => [...file.sectors.map(sector => [file.track, sector]), [17, 13]]));

    const exported = session.machine.disk.exportImage(), image = [...exported], expected = original.slice();
    for (const file of saved) {
      const entry = dos33Catalogue(image).files.find(entry => entry.name === file.name);
      assert.ok(entry); assert.equal(entry.type, "B"); assert.equal(entry.locked, false);
      const sectors = dos33FileSectors(image, entry).filter(sector => sector.fileSector !== undefined);
      assert.deepEqual(sectors.map(sector => sector.index), file.sectors.map(sector => file.track * 16 + sector));
      const contents = Uint8Array.from(sectors.flatMap(sector => image.slice(sector.index * 256, (sector.index + 1) * 256)));
      assert.deepEqual([...contents.slice(0, 4)], [file.address & 255, file.address >>> 8, file.bytes & 255, file.bytes >>> 8]);
      assert.deepEqual(contents.slice(4, 5 + file.bytes), file.payload);
      for (const [i, value] of file.payload.entries()) {
        const offset = 4 + i;
        expected[(file.track * 16 + file.sectors[Math.floor(offset / 256)]!) * 256 + offset % 256] = value;
      }
    }
    assert.deepEqual(exported, expected, "Only the three file payloads and their trailing bytes change; headers, catalogue and other sectors survive");
    assert.equal(hash(original), guide.britannia.sha256);
    runTo(guide.stops.command, 2_000_000);
    assert.equal(session.machine.disk.inspect().motor, false);
    assert.deepEqual([session.machine.ram.read(0), session.machine.ram.read(1)], [guide.resumed.x, guide.resumed.y]);
    await checkpoint("ultima-iv-saved");
    const directory = process.env.APPLE2_ULTIMA_IV_CHECKPOINTS;
    if (directory) writeFileSync(join(directory, "ultima_iv_br-saved.dsk"), exported);

    // Power on with the unchanged Boot disk, then insert the exported file at
    // the game's request. No checkpoint or game RAM enters the new machine.
    session = createApple2Session(rom.image, { bootstrap: rom.bootstrap!, image: boot });
    diskName = "ultima_iv_boot.dsk"; bootToExchange();
    await checkpoint("ultima-iv-reload-exchange");
    const mounted = await readApple2Disk({ name: "ultima_iv_br-saved.dsk", size: exported.length,
      async arrayBuffer() { return new Uint8Array(exported).buffer; } }, media.disk, "read-only");
    session.swapDisk(mounted.disk); diskName = mounted.name;
    session.send([27]); runTo(guide.save.partyLoaded, 30_000_000);
    const party = saved.find(file => file.name === "PRTY")!;
    assert.deepEqual(Uint8Array.from({ length: party.bytes }, (_, i) => session.machine.ram.read(i)), party.payload.slice(0, party.bytes));
    runTo(guide.save.rosterLoaded, 20_000_000);
    for (const file of saved.filter(file => file.name !== "PRTY")) {
      assert.deepEqual(Uint8Array.from({ length: file.bytes }, (_, i) => session.machine.upper.read(file.address - 0xe000 + i)),
        file.payload.slice(0, file.bytes));
    }
    runTo(guide.stops.command, 10_000_000); checkScene(guide.resumed);
    await checkpoint("ultima-iv-resumed");
    moveEast(guide.continuation);
    assert.deepEqual(session.machine.disk.exportImage(), exported, "Read-only resumption and movement preserve the export");
    assert.equal(session.machine.disk.inspect().writable, false);
    assert.equal(hash(boot.exportImage()), guide.boot.sha256);
    await checkpoint("ultima-iv-continued");
  });
});
