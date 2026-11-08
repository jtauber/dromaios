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
import { Apple2DiskSet } from "../../site/interactive/apple2-disk-set.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";

interface Identity { readonly bytes: number; readonly sha256: string }
interface Stop { readonly address: number; readonly bytes: readonly number[] }
interface Rectangle { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
interface Scene { readonly name: string; readonly x: number; readonly y: number; readonly terrainSha256?: string }
function record(path: string): unknown {
  const fences = [...readFileSync(path, "utf8").matchAll(/^```json\n([\s\S]*?)^```$/gm)];
  assert.equal(fences.length, 1, `${path} must own one acceptance record`);
  return JSON.parse(fences[0]![1]!);
}
const media = record("src/machines/6502/apple2.md") as Apple2Media;
const guide = record("docs/software/ultima-iv.md") as {
  boot: Identity; britannia: Identity; stops: Record<"title" | "menu" | "exchange" | "command", Stop>;
  terrain: Rectangle; scenes: readonly Scene[];
  save: { start: Stop; returned: Stop; partyLoaded: Stop; rosterLoaded: Stop;
    files: readonly { name: string; address: number; bytes: number; track: number; sectors: readonly number[] }[] };
  resumed: Scene; continuation: Scene;
  town: { image: Identity; stops: Record<"cast" | "input" | "mapLoaded" | "mapCopied" | "mix" | "mixLoaded" | "talk" | "talkLoaded" | "listLoaded" | "print", Stop>;
    gate: Scene; outside: Scene; entrance: Scene; conversation: Scene;
    location: number; greeting: string; answer: string; farewell: string;
    resumed: Scene; continuation: Scene };
  dungeon: { image: Identity; stops: Record<"codeLoaded" | "mapLoaded", Stop>;
    gate: Scene; blink: Scene; outside: Scene; location: number; viewport: Rectangle;
    scenes: readonly (Scene & { readonly direction: number; readonly viewSha256: string })[];
    resumed: Scene; continuation: Scene };
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
  let diskName = "ultima_iv_boot.dsk", diskSet = new Apple2DiskSet();
  diskSet.add([{ name: diskName, disk: boot }, { name: "ultima_iv_br.dsk", disk: britannia }]);
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
      diskName, flash: false, state: session.snapshot(), diskSet: diskSet.snapshot(session.machine.disk.medium) });
  }
  async function checkpoint(name: string): Promise<void> {
    const directory = process.env.APPLE2_ULTIMA_IV_CHECKPOINTS;
    if (!directory) return;
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${name}.json`), JSON.stringify(await savedState(name)));
  }
  function checkDisplay({ x: left, y: top, width, height }: Rectangle, expected?: string): void {
    // Independent hardware address equations, not the renderer's addressing helpers.
    const dots = Uint8Array.from({ length: width * height }, (_, i) => {
      const x = left + i % width, y = top + Math.floor(i / width);
      const address = 0x2000 + y % 8 * 0x400 + Math.floor(y / 8) % 8 * 0x80 + Math.floor(y / 64) * 40 + Math.floor(x / 7);
      return (session.machine.ram.read(address) >> (x % 7)) & 1;
    });
    if (expected !== undefined) assert.equal(hash(dots), expected, "The view matches the independently executed game");
    const displayed = apple2HiresFrame(session.machine.ram, session.machine.video, true);
    assert.deepEqual(displayed.slice(top, top + height).flatMap(row => row!.slice(left, left + width)), [...dots]);
  }
  function checkScene(scene: Scene): void {
    assert.deepEqual([session.machine.ram.read(0), session.machine.ram.read(1)], [scene.x, scene.y], scene.name);
    assert.deepEqual(session.machine.video.snapshot(), { text: false, mixed: false, page2: false, hires: true });
    checkDisplay(guide.terrain, scene.terrainSha256);
    assert.equal(session.pendingInput, 0);
    assert.equal(session.machine.disk.inspect().motor, false);
  }
  function binary(disk: Dos33Disk, name: string): Uint8Array {
    const image = [...disk.exportImage()];
    const entry = dos33Catalogue(image).files.find(file => file.name === name);
    assert.ok(entry);
    const sectors = dos33FileSectors(image, entry).filter(sector => sector.fileSector !== undefined);
    const contents = Uint8Array.from(sectors.flatMap(sector => image.slice(sector.index * 256, (sector.index + 1) * 256)));
    return contents.slice(4, 4 + contents[2]! + 256 * contents[3]!);
  }
  const ram = (address: number, length: number) => Uint8Array.from({ length }, (_, i) => session.machine.ram.read(address + i));
  const upper = (address: number, length: number) => Uint8Array.from({ length }, (_, i) => session.machine.upper.read(address - 0xe000 + i));
  const party = () => Array.from({ length: 8 }, (_, i) => [...upper(0xec00 + i * 32, 18)]);
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
    session = restored.session; diskSet = restored.diskSet;
    assert.equal(restored.diskName, "ultima_iv_br.dsk");
    assert.equal(session.machine.disk.inspect().writable, false);
    checkScene(guide.scenes[0]!); moveEast();
    assert.deepEqual(session.snapshot(), east);
    assert.equal(hash(boot.exportImage()), guide.boot.sha256);
    assert.equal(hash(session.machine.disk.exportImage()), guide.britannia.sha256);
  });
  await checkpoint("ultima-iv-east");

  async function saveAndResume(prefix: string, exportName: string, resumed: Scene, continuation: Scene,
    continueGame = () => moveEast(continuation)): Promise<void> {
    const original = session.machine.disk.exportImage();
    if (!session.machine.disk.inspect().writable) {
      const working = new Dos33Disk(original, { writable: true });
      diskSet.add([{ name: diskName, disk: working }]); session.swapDisk(working);
    }
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
    runTo(guide.stops.command, 2_000_000);
    assert.equal(session.machine.disk.inspect().motor, false);
    assert.deepEqual([session.machine.ram.read(0), session.machine.ram.read(1)], [resumed.x, resumed.y]);
    await checkpoint(`${prefix}-saved`);
    const directory = process.env.APPLE2_ULTIMA_IV_CHECKPOINTS;
    if (directory) writeFileSync(join(directory, exportName), exported);

    // Power on with the unchanged Boot disk, then insert the exported file at
    // the game's request. No checkpoint or game RAM enters the new machine.
    session = createApple2Session(rom.image, { bootstrap: rom.bootstrap!, image: diskSet.entries[0]!.disk });
    diskName = "ultima_iv_boot.dsk"; bootToExchange();
    await checkpoint(`${prefix}-reload-exchange`);
    const mounted = await readApple2Disk({ name: exportName, size: exported.length,
      async arrayBuffer() { return new Uint8Array(exported).buffer; } }, media.disk, "read-only");
    diskSet.add([{ name: mounted.name, disk: mounted.disk }]);
    session.swapDisk(mounted.disk); diskName = mounted.name;
    session.send([27]); runTo(guide.save.partyLoaded, 30_000_000);
    const party = saved.find(file => file.name === "PRTY")!;
    assert.deepEqual(Uint8Array.from({ length: party.bytes }, (_, i) => session.machine.ram.read(i)), party.payload.slice(0, party.bytes));
    runTo(guide.save.rosterLoaded, 20_000_000);
    for (const file of saved.filter(file => file.name !== "PRTY")) {
      assert.deepEqual(Uint8Array.from({ length: file.bytes }, (_, i) => session.machine.upper.read(file.address - 0xe000 + i)),
        file.payload.slice(0, file.bytes));
    }
    runTo(guide.stops.command, 10_000_000); checkScene(resumed);
    await checkpoint(`${prefix}-resumed`);
    continueGame(); checkScene(continuation);
    assert.deepEqual(session.machine.disk.exportImage(), exported, "Read-only resumption and movement preserve the export");
    assert.equal(session.machine.disk.inspect().writable, false);
    assert.equal(hash(boot.exportImage()), guide.boot.sha256);
    await checkpoint(`${prefix}-continued`);
  }
  await t.test("Q saves the three declared files; an exported disk restores them after a cold boot and allows another move",
    () => saveAndResume("ultima-iv", "ultima_iv_br-saved.dsk", guide.resumed, guide.continuation));

  await t.test("Skara Brae loads, answers a conversation, returns to Britannia, and survives another save and cold boot", {
    skip: !process.env.APPLE2_ULTIMA_IV_TOWN ? "Set APPLE2_ULTIMA_IV_TOWN for the town round trip" : false,
  }, async () => {
    const town = await disk(process.env.APPLE2_ULTIMA_IV_TOWN!, guide.town.image);
    const stops = guide.town.stops;
    const members = party(); // Names, sex and class; food, health and spell points can change as turns pass.
    const keyTo = (key: number, stop = guide.stops.command, limit = 30_000_000) => {
      session.send([key]); runTo(stop, limit);
    };
    function walk(address: number, target: number, key: number): void {
      // Forest movement can consume a turn without changing coordinates.
      for (let attempts = 0; session.machine.ram.read(address) !== target && attempts < 30; attempts++) keyTo(key);
      assert.equal(session.machine.ram.read(address), target);
    }
    const working = new Dos33Disk(session.machine.disk.exportImage(), { writable: true });
    diskName = "ultima_iv_br-town-working.dsk";
    diskSet.add([{ name: diskName, disk: working }, { name: "ultima_iv_town.dsk", disk: town }]);
    const returnIndex = diskSet.entries.findIndex(entry => entry.disk === working);
    session.swapDisk(working);
    keyTo(67, stops.cast); runTo(stops.input, 1_000_000); // Cast
    keyTo(49, stops.input); keyTo(71, stops.input); keyTo(55); // Mariah, Gate, phase 7
    checkScene(guide.town.gate);
    walk(0, guide.town.outside.x, 8); walk(1, guide.town.outside.y, 10);
    checkScene(guide.town.outside);
    const list = upper(0xee00, 256), writes: number[][] = [];
    const detach = session.machine.disk.inspectMedium()!.observeWrites(w => writes.push([w.track, w.sector]));
    try { keyTo(69, guide.stops.exchange); } finally { detach(); }
    assert.deepEqual(writes, [[20, 10], [20, 9], [17, 13]], "Entry saves TLST before asking for Town");
    const returning = session.machine.disk.exportImage();
    assert.deepEqual(returning.slice(0x14a04, 0x14b00), list.slice(0, 252));
    assert.deepEqual(returning.slice(0x14900, 0x14904), list.slice(252));
    await checkpoint("ultima-iv-town-request");
    const directory = process.env.APPLE2_ULTIMA_IV_CHECKPOINTS;
    if (directory) writeFileSync(join(directory, "ultima_iv_br-town-entry.dsk"), returning);
    session.swapDisk(town); diskName = "ultima_iv_town.dsk";
    keyTo(27, stops.mapLoaded);
    const map = binary(town, "MAPK"); assert.equal(map.length, 1280);
    assert.deepEqual(ram(0x8b00, map.length), map, "DOS honors the explicit MAPK load address");
    runTo(stops.mapCopied, 1_000_000);
    assert.deepEqual(upper(0xe800, 1024), map.slice(0, 1024));
    assert.deepEqual(upper(0xee00, 256), map.slice(1024));
    runTo(guide.stops.command, 2_000_000); checkScene(guide.town.entrance);
    assert.equal(session.machine.ram.read(10), guide.town.location);
    await checkpoint("ultima-iv-town");
    const inTown = session.snapshot();
    const restored = await prepareApple2SavedState(JSON.parse(JSON.stringify(await savedState("In Skara Brae"))), rom.image, media);
    session = restored.session; diskSet = restored.diskSet;
    assert.deepEqual(session.snapshot(), inTown, "Restoring the set preserves every hardware and input byte");
    assert.deepEqual(diskSet.entries[returnIndex]!.disk.exportImage(), returning, "The unmounted Britannia edits survive the town checkpoint");
    assert.equal(diskSet.entries[returnIndex]!.disk.writable, true);

    // MIX has valid payload sectors but garbage in unused T/S-list slots.
    // Keep the inspector strict; prove that this game's bounded BLOAD succeeds.
    assert.throws(() => binary(town, "MIX"), /T134 S219/);
    keyTo(77, stops.mix); runTo(stops.mixLoaded, 30_000_000);
    const raw = town.exportImage();
    const mix = Uint8Array.from([14, 13, 12].flatMap(sector => [...raw.slice((34 * 16 + sector) * 256, (34 * 16 + sector + 1) * 256)]));
    assert.deepEqual([...mix.slice(0, 4)], [0, 96, 48, 2]);
    assert.deepEqual(ram(0x8800, 560), mix.slice(4, 564));
    runTo(stops.input, 1_000_000); keyTo(27); // Cancel without mixing reagents.
    walk(0, guide.town.conversation.x, 21); checkScene(guide.town.conversation);
    keyTo(84, stops.talk); runTo(stops.input, 1_000_000);
    keyTo(21, stops.talkLoaded);
    const talk = binary(town, "TALK"); assert.deepEqual(ram(0x8800, talk.length), talk);
    let printed = "";
    const observe = (step: Cpu6502StepRecord) => {
      if (step.before.pc === stops.print.address) printed += String.fromCharCode(step.before.a & 0x7f);
    };
    runTo(stops.input, 5_000_000, observe);
    assert.ok(printed.includes(guide.town.greeting), printed);
    await checkpoint("ultima-iv-town-conversation");
    printed = "";
    for (const key of "NAME\r") { session.send([key.charCodeAt(0)]); runTo(stops.input, 2_000_000, observe); }
    assert.ok(printed.includes(guide.town.answer), printed);
    await checkpoint("ultima-iv-town-name");
    printed = "";
    for (const key of "BYE") { session.send([key.charCodeAt(0)]); runTo(stops.input, 2_000_000, observe); }
    session.send([13]); runTo(guide.stops.command, 2_000_000, observe);
    assert.ok(printed.includes(guide.town.farewell), printed);
    walk(0, 0, 8); keyTo(8, guide.stops.exchange);
    await checkpoint("ultima-iv-town-return-request");
    assert.equal(hash(session.machine.disk.exportImage()), guide.town.image.sha256);
    session.swapDisk(diskSet.entries[returnIndex]!.disk); diskName = diskSet.entries[returnIndex]!.name;
    keyTo(27, stops.listLoaded);
    assert.deepEqual(upper(0xee00, 256), list, "The same edited Britannia disk restores TLST");
    runTo(guide.stops.command, 5_000_000);
    checkScene(guide.town.outside); assert.equal(session.machine.ram.read(10), 0);
    assert.equal(session.machine.ram.read(15), 8); assert.deepEqual(party(), members);
    await checkpoint("ultima-iv-town-returned");
    await saveAndResume("ultima-iv-town", "ultima_iv_br-town-saved.dsk", guide.town.resumed, guide.town.continuation);
    assert.deepEqual(party(), members);
  });

  await t.test("Covetous loads, replays dungeon movement, returns with TLST, and resumes after a cold boot", {
    skip: !process.env.APPLE2_ULTIMA_IV_TOWN || !process.env.APPLE2_ULTIMA_IV_UNDERWORLD
      ? "Set APPLE2_ULTIMA_IV_TOWN and APPLE2_ULTIMA_IV_UNDERWORLD for the dungeon round trip" : false,
  }, async () => {
    const dungeon = guide.dungeon, underworld = await disk(process.env.APPLE2_ULTIMA_IV_UNDERWORLD!, dungeon.image);
    const working = new Dos33Disk(session.machine.disk.exportImage(), { writable: true });
    diskName = "ultima_iv_br-dungeon-working.dsk";
    diskSet.add([{ name: diskName, disk: working }, { name: "ultima_iv_under.dsk", disk: underworld }]);
    const returnIndex = diskSet.entries.findIndex(entry => entry.disk === working), members = party();
    session.swapDisk(working);
    const keyTo = (key: number, stop = guide.stops.command, limit = 30_000_000) => {
      session.send([key]); runTo(stop, limit);
    };
    function cast(player: number, spell: number, argument: number): void {
      keyTo(67, guide.town.stops.cast); runTo(guide.town.stops.input, 1_000_000);
      keyTo(player, guide.town.stops.input); keyTo(spell, guide.town.stops.input); keyTo(argument);
    }
    function checkDungeon(index: number): void {
      const scene = dungeon.scenes[index]!; checkScene(scene);
      assert.deepEqual([...ram(10, 3), session.machine.ram.read(16)], [dungeon.location, 3, 0, scene.direction],
        "Covetous, dungeon mode, level one, and facing direction");
      checkDisplay(dungeon.viewport, scene.viewSha256);
    }
    // Ordinary keyboard commands: Mariah gates to phase 5 and blinks west;
    // Iolo supplies the second Blink because Mariah has spent most of her MP.
    cast(49, 71, 53); checkScene(dungeon.gate);
    cast(49, 66, 8); checkScene(dungeon.blink);
    keyTo(21); keyTo(21); cast(53, 66, 10); checkScene(dungeon.outside);
    await checkpoint("ultima-iv-dungeon-outside");
    const list = upper(0xee00, 256), writes: number[][] = [];
    const detach = session.machine.disk.medium!.observeWrites(w => writes.push([w.track, w.sector]));
    try { keyTo(69, guide.stops.exchange); } finally { detach(); }
    assert.deepEqual(writes, [[20, 10], [20, 9], [17, 13]], "Dungeon entry saves TLST on Britannia");
    const returning = session.machine.disk.exportImage();
    assert.deepEqual(binary(working, "TLST"), list);
    assert.deepEqual([...ram(8, 3)], [dungeon.outside.x, dungeon.outside.y, dungeon.location]);
    await checkpoint("ultima-iv-dungeon-request");
    session.swapDisk(underworld); diskName = "ultima_iv_under.dsk";
    keyTo(27, dungeon.stops.codeLoaded);
    const code = binary(underworld, "DNGD"); assert.equal(code.length, 3360);
    assert.deepEqual(ram(0x8c00, code.length), code, "DNGD honors the explicit $8C00 load address");
    runTo(dungeon.stops.mapLoaded, 20_000_000);
    const map = binary(underworld, "DNG4"); assert.equal(map.length, 512);
    assert.deepEqual(upper(0xe800, map.length), map, "All eight 8-by-8 dungeon levels load into Language Card RAM");
    runTo(guide.stops.command, 2_000_000); checkDungeon(0);
    await checkpoint("ultima-iv-dungeon");
    const saved = await savedState("Inside Covetous");
    keyTo(11); checkDungeon(1); const forward = session.snapshot();
    const restored = await prepareApple2SavedState(JSON.parse(JSON.stringify(saved)), rom.image, media);
    session = restored.session; diskSet = restored.diskSet;
    assert.deepEqual(session.snapshot(), saved.state);
    assert.deepEqual(diskSet.entries[returnIndex]!.disk.exportImage(), returning);
    assert.equal(diskSet.entries[returnIndex]!.disk.writable, true);
    keyTo(11); checkDungeon(1);
    assert.deepEqual(session.snapshot(), forward, "Replayed forward movement reproduces every hardware and input byte");
    await checkpoint("ultima-iv-dungeon-forward");
    keyTo(21); checkDungeon(2); keyTo(21); checkDungeon(3); keyTo(11); checkDungeon(4);
    await checkpoint("ultima-iv-dungeon-ladder");
    keyTo(75, guide.stops.exchange); await checkpoint("ultima-iv-dungeon-return-request");
    assert.equal(hash(session.machine.disk.exportImage()), dungeon.image.sha256);
    session.swapDisk(diskSet.entries[returnIndex]!.disk); diskName = diskSet.entries[returnIndex]!.name;
    keyTo(27, guide.town.stops.listLoaded);
    assert.deepEqual(upper(0xee00, 256), list, "The retained Britannia disk restores the outdoor object list");
    runTo(guide.stops.command, 5_000_000); checkScene(dungeon.outside);
    assert.equal(session.machine.ram.read(10), 0); assert.equal(session.machine.ram.read(11), 1);
    assert.deepEqual(party(), members);
    await checkpoint("ultima-iv-dungeon-returned");
    await saveAndResume("ultima-iv-dungeon", "ultima_iv_br-dungeon-saved.dsk", dungeon.resumed, dungeon.continuation,
      () => cast(53, 66, 11)); // Iolo blinks north from the otherwise enclosed entrance.
    assert.deepEqual(party(), members);
  });
});
