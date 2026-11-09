import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import { readApple2Rom, readApple2Disk } from "../../site/interactive/apple2-media.js";
import type { Apple2Media } from "../../site/interactive/apple2-media.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { encodeApple2SavedState, prepareApple2SavedState } from "../../site/interactive/apple2-saved-state.js";
import { Apple2DiskSet } from "../../site/interactive/apple2-disk-set.js";
import { checkUltima4Save, ultima4Binary } from "../helpers/ultima-iv.js";
import type { Ultima4SaveFile } from "../helpers/ultima-iv.js";

interface Identity { readonly bytes: number; readonly sha256: string }
interface Stop { readonly address: number; readonly bytes: readonly number[] }
type Member = readonly [health: number, experience: number, magic: number];
type Enemy = readonly [slot: number, x: number, y: number, health: number, tile: number];
function record(path: string): unknown {
  const fences = [...readFileSync(path, "utf8").matchAll(/^```json\n([\s\S]*?)^```$/gm)];
  assert.equal(fences.length, 1); return JSON.parse(fences[0]![1]!);
}
const media = record("src/machines/6502/apple2.md") as Apple2Media;
const guide = record("docs/software/ultima-iv.md") as {
  boot: Identity; dungeon: { image: Identity; stops: Record<"codeLoaded" | "mapLoaded", Stop> };
  stops: Record<"title" | "menu" | "exchange" | "command", Stop>;
  save: { start: Stop; returned: Stop; partyLoaded: Stop; rosterLoaded: Stop; files: readonly Ultima4SaveFile[] };
  companions: { stops: { firstTurn: Stop } };
  rooms: {
    image: Identity; initial: readonly Member[]; final: readonly Member[];
    stops: Record<"read" | "loaded" | "placed" | "leaving", Stop>;
    approach: readonly number[]; return: readonly number[]; enemies: readonly Enemy[];
    turns: readonly { actor: number; keys: readonly number[]; members: readonly (readonly number[])[]; enemies: readonly Enemy[]; next: number }[];
    exits: readonly { actor: number; key: number; next: number; positions: readonly number[]; active: readonly number[]; exit: readonly number[]; pc: number }[];
  };
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function file(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  return { name: path, size: bytes.length, async arrayBuffer() { return bytes.buffer; } };
}
function decimal(bytes: readonly number[]): number {
  return bytes.reduce((n, b) => {
    assert.ok((b & 15) < 10 && (b >>> 4) < 10, "Character statistics contain valid packed decimal digits");
    return 100 * n + 10 * (b >>> 4) + (b & 15);
  }, 0);
}
const romPath = process.env.APPLE2_ROM, bootPath = process.env.APPLE2_ULTIMA_IV_BOOT;
const readyPath = process.env.APPLE2_ULTIMA_IV_ROOM, underPath = process.env.APPLE2_ULTIMA_IV_UNDERWORLD;

test("Ultima IV loads a raw dungeon room, defeats its enemies, returns both characters, and reloads their save", {
  skip: !romPath || !bootPath || !readyPath || !underPath
    ? "Set APPLE2_ROM, APPLE2_ULTIMA_IV_BOOT, APPLE2_ULTIMA_IV_ROOM and APPLE2_ULTIMA_IV_UNDERWORLD to the verified images" : false,
}, async t => {
  assert.ok(romPath); assert.ok(bootPath); assert.ok(readyPath); assert.ok(underPath);
  const rooms = guide.rooms, command = guide.stops.command, turn = guide.companions.stops.firstTurn;
  async function disk(path: string, identity: Identity) {
    const selected = file(path), bytes = new Uint8Array(await selected.arrayBuffer());
    assert.equal(bytes.length, identity.bytes); assert.equal(hash(bytes), identity.sha256);
    return (await readApple2Disk(selected, media.disk, "read-only")).disk;
  }
  const rom = await readApple2Rom(file(romPath), romImages.firmware, media); assert.ok(rom.bootstrap);
  const boot = await disk(bootPath, guide.boot), ready = await disk(readyPath, rooms.image), under = await disk(underPath, guide.dungeon.image);
  const sector = under.exportImage().slice(0x4000, 0x4100); // DOS-order track 4, sector 0: Covetous room D0.
  let session = createApple2Session(rom.image, { bootstrap: rom.bootstrap, image: boot });
  let diskName = "ultima_iv_boot.dsk", set = new Apple2DiskSet();
  set.add([{ name: diskName, disk: boot }, { name: "ultima_iv_br-room-ready.dsk", disk: ready }, { name: "ultima_iv_under.dsk", disk: under }]);
  const ram = (address: number, length = 1) => Uint8Array.from({ length }, (_, i) => session.machine.ram.read(address + i));
  const upper = (address: number, length = 1) => Uint8Array.from({ length }, (_, i) => session.machine.upper.read(address - 0xe000 + i));
  const amount = (address: number, length = 1) => decimal([...upper(address, length)]);
  const members = (): Member[] => [0, 1].map(i => [amount(0xec18 + 32 * i, 2), amount(0xec1c + 32 * i, 2), amount(0xec16 + 32 * i)]);
  const fighters = () => members().map((member, i) => [...member, ...upper(0xef80 + i), ...upper(0xef90 + i)]);
  const enemies = () => Array.from({ length: 16 }, (_, i) => [i, ...upper(0xef00 + i), ...upper(0xef10 + i), ...upper(0xef40 + i), ...upper(0xef50 + i)])
    .filter(([, , , , tile]) => tile !== 0);
  let printed = "";
  function runTo(stop: Stop, keys: readonly number[] = [], limit = 30_000_000, observe?: (step: Cpu6502StepRecord) => void): void {
    session.send(keys);
    for (let i = 0; i < limit; i++) {
      const step = session.step(); assert.equal(step.outcome, "executed");
      if (step.before.pc === 0x0fa9) printed += String.fromCharCode(step.before.a & 127);
      observe?.(step);
      if (step.after.pc !== stop.address) continue;
      assert.deepEqual([...ram(stop.address, stop.bytes.length)], stop.bytes); return;
    }
    assert.fail(`Did not reach $${stop.address.toString(16)}; PC=$${session.machine.cpu.snapshot().pc.toString(16)}`);
  }
  function position(x: number, y: number, mode: number): void {
    assert.deepEqual([...ram(0, 2)], [x, y]); assert.equal(ram(11)[0], mode);
    assert.equal(session.pendingInput, 0); assert.equal(session.machine.disk.inspect().motor, false);
  }
  function insert(disk: Dos33Disk, name: string): void { session.swapDisk(disk); diskName = name; }
  function bootToExchange(): void {
    runTo(guide.stops.title, [], 200_000_000); runTo(guide.stops.menu, [32]); runTo(guide.stops.exchange, [74], 80_000_000);
  }
  async function snapshot(name: string) {
    return encodeApple2SavedState({ machine: "apple2-plus", name, savedAt: "2026-11-09T00:00:00Z", diskName,
      flash: false, state: session.snapshot(), diskSet: set.snapshot(session.machine.disk.medium) });
  }
  async function checkpoint(name: string): Promise<void> {
    const directory = process.env.APPLE2_ULTIMA_IV_CHECKPOINTS;
    if (!directory) return;
    mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, `ultima-iv-room-${name}.json`), JSON.stringify(await snapshot(name)));
  }
  await t.test("a cold boot enters Covetous and decodes all 256 bytes of the first room's raw sector", async () => {
    bootToExchange(); await checkpoint("exchange");
    const working = new Dos33Disk(ready.exportImage(), { writable: true });
    set.add([{ name: "ultima_iv_br-room-working.dsk", disk: working }]); insert(working, "ultima_iv_br-room-working.dsk");
    runTo(command, [27]); position(156, 27, 1); assert.deepEqual(members(), rooms.initial); await checkpoint("outside");
    runTo(guide.stops.exchange, [69]); insert(under, "ultima_iv_under.dsk");
    runTo(guide.dungeon.stops.codeLoaded, [27]);
    assert.deepEqual(ram(0x8c00, ultima4Binary(under, "DNGD").length), ultima4Binary(under, "DNGD"));
    runTo(guide.dungeon.stops.mapLoaded); assert.deepEqual(upper(0xe800, 512), ultima4Binary(under, "DNG4"));
    runTo(command); position(1, 1, 3); await checkpoint("entrance");
    runTo(command, [67, 49, 76]); assert.equal(amount(0xed4b), 1); assert.ok(ram(17)[0]! > 0);
    for (const key of rooms.approach) runTo(command, [key]);
    position(5, 0, 3); assert.equal(ram(16)[0], 2); assert.equal(upper(0xe80d)[0], 0xd0); await checkpoint("approach");
    const replay = await snapshot("Before room entry");
    function enterRoom(): void {
      runTo(rooms.stops.read, [11]); assert.deepEqual([...ram(0xe0, 4)], [4, 0, 1, 2]);
      runTo(rooms.stops.loaded); assert.deepEqual(ram(0x200, 256), sector); assert.equal(ram(11)[0], 3);
      let healthChecks = 0, expectedHealth = 0, baseHealth = 0;
      runTo(rooms.stops.placed, [], 1_000_000, step => {
        if (step.after.pc === 0x6f94) baseHealth = ram(0xd8)[0]!;
        if (step.before.pc === 0x6f97) { assert.ok(step.before.a < baseHealth); expectedHealth = step.before.a | (baseHealth >>> 1); }
        if (step.after.pc === 0x6f9e) { assert.equal(upper(0xef40 + step.after.x)[0], expectedHealth); healthChecks++; }
      });
      assert.equal(healthChecks, 7); assert.equal(ram(11)[0], 129);
      assert.deepEqual(ram(0x310, 16), sector.slice(0, 16)); assert.deepEqual(ram(0x280, 121), sector.slice(128, 249));
      for (let i = 0; i < 16; i++) {
        assert.equal(upper(0xef50 + i)[0], sector[16 + i]);
        if (sector[16 + i]) assert.deepEqual([...upper(0xef00 + i), ...upper(0xef10 + i)], [sector[32 + i], sector[48 + i]]);
      }
      for (let i = 0; i < 2; i++) assert.deepEqual([...upper(0xef80 + i), ...upper(0xef90 + i)], [sector[64 + i], sector[72 + i]]);
      assert.deepEqual([...upper(0xefa0, 2)], [32, 34]); assert.deepEqual(enemies(), rooms.enemies);
      runTo(turn); assert.equal(ram(0xd4)[0], 1); position(5, 1, 129);
    }
    enterRoom(); const first = session.snapshot();
    const restored = await prepareApple2SavedState(replay, rom.image, media); session = restored.session; set = restored.diskSet; diskName = restored.diskName!;
    enterRoom(); assert.deepEqual(session.snapshot(), first, "Replay reproduces the raw read, random enemy HP and every hardware/input byte");
    await checkpoint("combat");
  });
  await t.test("both slings clear the room, with checked decimal HP and XP, without leaving room mode", async () => {
    const before = upper(0xec00, 512); printed = ""; let damageChecks = 0, experienceChecks = 0;
    for (const action of rooms.turns) {
      assert.equal(ram(0xd4)[0], action.actor);
      let health: number | undefined, experience: number | undefined, recipient = 0;
      runTo(turn, action.keys, 5_000_000, step => {
        if (step.before.pc === 0x85be) { recipient = ram(0xd4)[0]! - 1; health = members()[recipient]![0] - decimal([step.before.a]); }
        if (step.after.pc === 0x85d4) { assert.equal(members()[recipient]![0], health); health = undefined; damageChecks++; }
        if (step.before.pc === 0x8658) { recipient = ram(0xd4)[0]! - 1; experience = members()[recipient]![1] + decimal([step.before.a]); }
        if (step.after.pc === 0x866e) { assert.equal(members()[recipient]![1], experience); experience = undefined; experienceChecks++; }
      });
      assert.equal(health, undefined); assert.equal(experience, undefined);
      assert.deepEqual(fighters(), action.members); assert.deepEqual(enemies(), action.enemies); assert.equal(ram(0xd4)[0], action.next);
      position(5, 1, 129);
    }
    assert.ok(damageChecks > 0); assert.equal(experienceChecks, 6);
    assert.equal(printed.match(/SKELETON\rKILLED!/g)?.length, 3); assert.equal(printed.match(/GHOST\rKILLED!/g)?.length, 3);
    assert.equal(printed.match(/GHOST\rFLEES!/g)?.length, 1);
    assert.doesNotMatch(printed, /VICTORY!|LEAVE ROOM!/); assert.deepEqual(enemies(), []);
    const expected = before.slice();
    for (const [i, bytes] of [[0, [0x44, 0x01, 0x83, 0x01, 0x54]], [1, [0x13, 0x02, 0x79, 0x02, 0x96]]] as const) {
      expected[i * 32 + 22] = bytes[0]; expected.set(bytes.slice(1, 3), i * 32 + 24); expected.set(bytes.slice(3), i * 32 + 28);
    }
    assert.deepEqual(upper(0xec00, 512), expected, "Only the two active members' MP, HP and XP change; equipment, inactive records and inventory survive");
    await checkpoint("cleared");
  });
  await t.test("each character leaves north before the room returns to dungeon exploration and Britannia", async () => {
    for (const [i, action] of rooms.exits.entries()) {
      assert.equal(ram(0xd4)[0], action.actor);
      runTo(action.pc === rooms.stops.leaving.address ? rooms.stops.leaving : turn, [action.key]);
      assert.deepEqual([...upper(0xef80, 2), ...upper(0xef90, 2)], action.positions);
      assert.deepEqual([...upper(0xefa0, 2)], action.active); assert.deepEqual([...ram(0x7a7c, 2)], action.exit);
      assert.equal(ram(0xd4)[0], action.next); assert.equal(ram(11)[0], 129);
      if (i === 5) await checkpoint("one-left");
    }
    await checkpoint("leaving"); runTo(command); position(5, 0, 3); assert.equal(ram(16)[0], 0);
    assert.equal(upper(0xe80d)[0], 0xd0, "The room square remains present; this is not a persistent cleared-room flag"); await checkpoint("corridor");
    for (const key of rooms.return) runTo(command, [key]); position(1, 1, 3);
    runTo(guide.stops.exchange, [75]); await checkpoint("return-request");
    const working = set.entries.find(entry => entry.name === "ultima_iv_br-room-working.dsk")!;
    assert.ok(working.disk.writable); insert(working.disk, working.name); runTo(command, [27]); position(156, 27, 1);
    assert.deepEqual(members(), rooms.final); await checkpoint("returned");
  });
  await t.test("Q exports all three save blocks and a new machine reloads both characters before another turn", async () => {
    const original = session.machine.disk.exportImage(); runTo(guide.save.start, [81]);
    const saved = guide.save.files.map(file => ({ ...file, payload: file.address < 0xc000
      ? ram(file.address, file.bytes + 1) : upper(file.address, file.bytes + 1) }));
    const writes: number[][] = [], reads: number[][] = [];
    const detach = session.machine.disk.medium!.observeWrites(w => writes.push([w.track, w.sector]));
    try { runTo(guide.save.returned, [], 50_000_000, step => {
      if (step.before.pc !== 0xacc7) return;
      const read = step.accesses.filter(a => a.kind === "read").at(-1)!; reads.push([read.address, read.value]);
    }); } finally { detach(); }
    assert.deepEqual(reads, saved.flatMap(file => Array.from(file.payload, (value, i) => [file.address + i, value])));
    assert.deepEqual(writes, saved.flatMap(file => [...file.sectors.map(sector => [file.track, sector]), [17, 13]]));
    const exported = session.machine.disk.exportImage(); checkUltima4Save(original, exported, saved);
    runTo(command); await checkpoint("saved");
    const directory = process.env.APPLE2_ULTIMA_IV_CHECKPOINTS;
    if (directory) writeFileSync(join(directory, "ultima_iv_br-room-saved.dsk"), exported);
    session = createApple2Session(rom.image, { bootstrap: rom.bootstrap!, image: boot }); diskName = "ultima_iv_boot.dsk";
    bootToExchange(); const loaded = new Dos33Disk(exported); set.add([{ name: "ultima_iv_br-room-saved.dsk", disk: loaded }]);
    insert(loaded, "ultima_iv_br-room-saved.dsk"); runTo(guide.save.partyLoaded, [27]);
    assert.deepEqual(ram(0, 32), saved.find(file => file.name === "PRTY")!.payload.slice(0, 32));
    runTo(guide.save.rosterLoaded);
    for (const file of saved.filter(file => file.name !== "PRTY")) assert.deepEqual(upper(file.address, file.bytes), file.payload.slice(0, file.bytes));
    runTo(command); position(156, 27, 1); assert.deepEqual(members(), rooms.final);
    assert.equal(amount(0xed47), 2); assert.equal(amount(0xed4b), 1); await checkpoint("resumed");
    const moves = decimal([...ram(0x1c, 4)]); runTo(command, [32]); position(156, 27, 1);
    assert.equal(decimal([...ram(0x1c, 4)]), moves + 1); assert.deepEqual(members(), rooms.final); await checkpoint("continued");
    assert.deepEqual(loaded.exportImage(), exported); assert.equal(hash(boot.exportImage()), guide.boot.sha256);
    assert.equal(hash(ready.exportImage()), rooms.image.sha256); assert.equal(hash(under.exportImage()), guide.dungeon.image.sha256);
  });
});
