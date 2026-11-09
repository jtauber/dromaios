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
interface Hero { readonly health: number; readonly experience: number; readonly magic: number }
type Position = readonly [x: number, y: number];
type Enemy = readonly [slot: number, x: number, y: number, health: number];
interface Turn extends Hero {
  readonly action: "east" | "attack-east";
  readonly position: Position;
  readonly enemies: readonly Enemy[];
  readonly damage: number;
  readonly reward: number;
}
function record(path: string): unknown {
  const fences = [...readFileSync(path, "utf8").matchAll(/^```json\n([\s\S]*?)^```$/gm)];
  assert.equal(fences.length, 1); return JSON.parse(fences[0]![1]!);
}
const media = record("src/machines/6502/apple2.md") as Apple2Media;
const guide = record("docs/software/ultima-iv.md") as {
  boot: Identity; stops: Record<"title" | "menu" | "exchange" | "command", Stop>;
  terrain: { x: number; y: number; width: number; height: number };
  save: { start: Stop; returned: Stop; partyLoaded: Stop; rosterLoaded: Stop; files: readonly Ultima4SaveFile[] };
  combat: { image: Identity; arrival: Scene;
    approach: readonly (readonly [key: number, x: number, y: number])[]; waits: number;
    stops: Record<"entry" | "mapLoaded" | "command" | "attack" | "direction", Stop>;
    initial: Hero & { position: Position; enemies: readonly Enemy[] };
    viewport: { x: number; y: number; width: number; height: number };
    views: readonly string[]; turns: readonly Turn[]; resumed: Scene; continuation: Scene };
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function file(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  return { name: path, size: bytes.length, async arrayBuffer() { return bytes.buffer; } };
}
function decimal(bytes: readonly number[]): number {
  return bytes.reduce((value, byte) => {
    assert.ok((byte & 15) < 10 && (byte >>> 4) < 10, "A character statistic contains valid packed decimal digits");
    return value * 100 + (byte >>> 4) * 10 + (byte & 15);
  }, 0);
}
const romPath = process.env.APPLE2_ROM, bootPath = process.env.APPLE2_ULTIMA_IV_BOOT;
const partyPath = process.env.APPLE2_ULTIMA_IV_NEW_GAME;

test("Ultima IV wins a bridge-troll encounter and reloads the resulting party from an exported disk", {
  skip: !romPath || !bootPath || !partyPath
    ? "Set APPLE2_ROM, APPLE2_ULTIMA_IV_BOOT and APPLE2_ULTIMA_IV_NEW_GAME to the guide's verified new-character export" : false,
}, async t => {
  assert.ok(romPath); assert.ok(bootPath); assert.ok(partyPath);
  const combat = guide.combat, stops = combat.stops;
  async function disk(path: string, identity: Identity, writable = false) {
    const selected = file(path);
    assert.equal(selected.size, identity.bytes);
    assert.equal(hash(new Uint8Array(await selected.arrayBuffer())), identity.sha256);
    return (await readApple2Disk(selected, media.disk, writable ? "writable-copy" : "read-only")).disk;
  }
  const rom = await readApple2Rom(file(romPath), romImages.firmware, media); assert.ok(rom.bootstrap);
  const boot = await disk(bootPath, guide.boot), britannia = await disk(partyPath, combat.image, true);
  let session = createApple2Session(rom.image, { bootstrap: rom.bootstrap, image: boot });
  let diskName = "ultima_iv_boot.dsk", set = new Apple2DiskSet();
  set.add([{ name: diskName, disk: boot }, { name: "ultima_iv_br-combat-working.dsk", disk: britannia }]);
  const ram = (address: number, length: number) => Uint8Array.from({ length }, (_, i) => session.machine.ram.read(address + i));
  const upper = (address: number, length: number) => Uint8Array.from({ length }, (_, i) => session.machine.upper.read(address - 0xe000 + i));
  const hero = (): Hero => ({ health: decimal([...upper(0xec18, 2)]), experience: decimal([...upper(0xec1c, 2)]), magic: decimal([...upper(0xec16, 1)]) });
  const enemies = () => Array.from({ length: 16 }, (_, i) => [i, ...upper(0xef00 + i, 1), ...upper(0xef10 + i, 1), ...upper(0xef40 + i, 1)])
    .filter(([slot]) => session.machine.upper.read(0xf50 + slot!) !== 0);
  function runTo(stop: Stop, key?: number, limit = 30_000_000, observe?: (step: Cpu6502StepRecord) => void): void {
    if (key !== undefined) session.send([key]);
    for (let i = 0; i < limit; i++) {
      const step = session.step(); assert.equal(step.outcome, "executed"); observe?.(step);
      if (step.after.pc !== stop.address) continue;
      assert.deepEqual([...ram(stop.address, stop.bytes.length)], stop.bytes);
      t.diagnostic(`Reached $${stop.address.toString(16).toUpperCase()} after ${(i + 1).toLocaleString()} instructions`); return;
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
  function display(rectangle: typeof guide.terrain, expected?: string): void {
    const { x: left, y: top, width, height } = rectangle;
    const dots = Uint8Array.from({ length: width * height }, (_, i) => {
      const x = left + i % width, y = top + Math.floor(i / width);
      const address = 0x2000 + y % 8 * 0x400 + Math.floor(y / 8) % 8 * 0x80 + Math.floor(y / 64) * 40 + Math.floor(x / 7);
      return session.machine.ram.read(address) >> x % 7 & 1;
    });
    if (expected !== undefined) assert.equal(hash(dots), expected);
    const frame = apple2HiresFrame(session.machine.ram, session.machine.video, true);
    assert.deepEqual(frame.slice(top, top + height).flatMap(row => row!.slice(left, left + width)), [...dots]);
    assert.deepEqual(session.machine.video.snapshot(), { text: false, mixed: false, page2: false, hires: true });
    assert.equal(session.pendingInput, 0); assert.equal(session.machine.disk.inspect().motor, false);
  }
  function world(scene: Scene): void {
    assert.deepEqual([...ram(0, 2)], [scene.x, scene.y]); assert.equal(session.machine.ram.read(0x0b), 1);
    display(guide.terrain, scene.terrainSha256);
  }
  function bootToExchange(): void {
    runTo(guide.stops.title, undefined, 200_000_000); runTo(guide.stops.menu, 32); runTo(guide.stops.exchange, 74, 80_000_000);
  }
  await t.test("a cold boot loads the new mage, walks to the bridge, and loads its battlefield", async () => {
    bootToExchange(); session.swapDisk(britannia); diskName = set.entries[1]!.name;
    runTo(guide.stops.command, 27); world(combat.arrival);
    assert.equal(String.fromCharCode(...upper(0xec00, 8).map(b => b & 127)), "DROMAIOS");
    assert.deepEqual([...upper(0xec10, 3)], [0x5c, 0, 0xc7]); assert.equal(session.machine.ram.read(15), 1);
    await checkpoint("ultima-iv-combat-world");
    for (const [key, x, y] of combat.approach) {
      runTo(guide.stops.command, key); assert.deepEqual([...ram(0, 2)], [x, y]);
    }
    for (let i = 0; i < combat.waits; i++) runTo(i + 1 === combat.waits ? stops.entry : guide.stops.command, 32);
    assert.deepEqual([...ram(0xc0, 4)], [0xa4, 228, 131, 0x17], "Bridge trolls at the party's world coordinates");
    await checkpoint("ultima-iv-combat-entry");
    runTo(stops.mapLoaded); const map = ultima4Binary(session.machine.disk.medium!, "CONR");
    assert.equal(map.length, 192); assert.deepEqual(ram(0x240, map.length), map, "BLOAD overrides CONR's $0840 header with $0240");
    runTo(stops.command); assert.equal(session.machine.ram.read(0x0b), 0x80);
    assert.deepEqual(hero(), { health: combat.initial.health, experience: combat.initial.experience, magic: combat.initial.magic });
    assert.deepEqual(enemies(), combat.initial.enemies);
    assert.deepEqual([session.machine.upper.read(0xf80), session.machine.upper.read(0xf90)], combat.initial.position);
    display(combat.viewport, combat.views[0]); await checkpoint("ultima-iv-combat-ready");
  });
  await t.test("movement, attacks and enemy turns end in victory with independently checked decimal arithmetic", async () => {
    const initialRoster = upper(0xec00, 32); let transcript = "";
    for (const [index, turn] of combat.turns.entries()) {
      const saved = index === 2 ? await snapshot("Before the first staff attack") : undefined;
      function play(): string {
        const before = hero(); let printed = "", damage = 0, reward = 0;
        let expectedHealth: number | undefined, expectedExperience: number | undefined;
        const hits: { slot: number; before: number; damage: number }[] = [];
        const observe = (step: Cpu6502StepRecord) => {
          if (step.before.pc === 0xfa9) printed += String.fromCharCode(step.before.a & 127);
          if (step.after.pc === 0x7bc4) assert.equal(step.after.a, 22, "Decimal dexterity converts to binary 22");
          if (step.after.pc === 0x7be0) assert.equal(step.after.a, 19, "Decimal strength converts to binary 19");
          if (step.before.pc === 0x7beb) assert.equal(step.before.a, 35, "Strength 19 plus staff damage range 16");
          if (step.before.pc === 0x7c03) {
            const slot = session.machine.ram.read(0xea), amount = session.machine.ram.read(0xdc);
            assert.ok(amount < 35); hits.push({ slot, before: session.machine.upper.read(0xf40 + slot), damage: amount });
          }
          if (step.before.pc === 0x85be) {
            const amount = decimal([step.before.a]); damage += amount; expectedHealth = hero().health - amount;
          }
          if (step.after.pc === 0x85d4) { assert.equal(hero().health, expectedHealth); expectedHealth = undefined; }
          if (step.before.pc === 0x8658) {
            const amount = decimal([step.before.a]); reward += amount; expectedExperience = hero().experience + amount;
          }
          if (step.after.pc === 0x866e) { assert.equal(hero().experience, expectedExperience); expectedExperience = undefined; }
        };
        if (turn.action === "attack-east") {
          runTo(stops.attack, 65, 2_000_000, observe); runTo(stops.direction, undefined, 2_000_000, observe);
        }
        runTo(index + 1 === combat.turns.length ? guide.stops.command : stops.command, 21, 5_000_000, observe);
        assert.deepEqual([damage, reward], [turn.damage, turn.reward]);
        assert.equal(hero().health, before.health - damage); assert.equal(hero().experience, before.experience + reward);
        assert.deepEqual(hero(), { health: turn.health, experience: turn.experience, magic: turn.magic });
        for (const hit of hits) assert.equal(session.machine.upper.read(0xf40 + hit.slot), Math.max(0, hit.before - hit.damage));
        assert.deepEqual([session.machine.upper.read(0xf80), session.machine.upper.read(0xf90)], turn.position);
        assert.deepEqual(enemies(), turn.enemies); assert.equal(session.machine.ram.read(15), 1);
        display(combat.viewport, index < 2 ? combat.views[index + 1] : undefined);
        return printed;
      }
      const printed = play();
      if (saved) {
        const after = session.snapshot(), restored = await prepareApple2SavedState(JSON.parse(JSON.stringify(saved)), rom.image, media);
        session = restored.session; set = restored.diskSet;
        assert.deepEqual(session.snapshot(), saved.state); assert.equal(play(), printed);
        assert.deepEqual(session.snapshot(), after, "Replaying the first attack preserves every hardware and input byte");
        await checkpoint("ultima-iv-combat-first-hit");
      }
      transcript += printed;
    }
    assert.equal(transcript.match(/TROLL\rKILLED!/g)?.length, 1);
    assert.equal(transcript.match(/TROLL\rFLEES!/g)?.length, 1); assert.ok(transcript.includes("VICTORY!"));
    assert.deepEqual([...ram(0, 2)], [228, 131]); assert.equal(session.machine.ram.read(0x0b), 1);
    const expected = initialRoster.slice(); expected[22] = 0x48; expected[24] = 1; expected[25] = 0x85; expected[29] = 0x32;
    assert.deepEqual(upper(0xec00, 32), expected, "Only magic points, current health and experience change in the character record");
    assert.equal(session.machine.upper.read(0xd02), 0x56, "Valor increased from 55 to 56");
    assert.equal(hash(session.machine.disk.exportImage()), combat.image.sha256, "Combat has not yet saved to disk");
    await checkpoint("ultima-iv-combat-victory");
  });
  await t.test("Q saves every resulting party byte and a fresh boot restores the party and accepts another move", async () => {
    const result = hero(), original = session.machine.disk.exportImage(); runTo(guide.save.start, 81);
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
    runTo(guide.stops.command); await checkpoint("ultima-iv-combat-saved");
    const directory = process.env.APPLE2_ULTIMA_IV_CHECKPOINTS;
    if (directory) writeFileSync(join(directory, "ultima_iv_br-combat-saved.dsk"), exported);
    session = createApple2Session(rom.image, { bootstrap: rom.bootstrap!, image: set.entries[0]!.disk }); diskName = "ultima_iv_boot.dsk";
    bootToExchange();
    const loaded = await readApple2Disk({ name: "ultima_iv_br-combat-saved.dsk", size: exported.length,
      async arrayBuffer() { return new Uint8Array(exported).buffer; } }, media.disk, "read-only");
    set.add([{ name: loaded.name, disk: loaded.disk }]); session.swapDisk(loaded.disk); diskName = loaded.name;
    runTo(guide.save.partyLoaded, 27);
    assert.deepEqual(ram(0, 32), saved.find(file => file.name === "PRTY")!.payload.slice(0, 32));
    runTo(guide.save.rosterLoaded);
    for (const file of saved.filter(file => file.name !== "PRTY")) assert.deepEqual(upper(file.address, file.bytes), file.payload.slice(0, file.bytes));
    runTo(guide.stops.command); world(combat.resumed); assert.deepEqual(hero(), result); await checkpoint("ultima-iv-combat-resumed");
    runTo(guide.stops.command, 8); world(combat.continuation); assert.deepEqual(hero(), result); await checkpoint("ultima-iv-combat-continued");
    assert.deepEqual(session.machine.disk.exportImage(), exported); assert.equal(hash(boot.exportImage()), guide.boot.sha256);
  });
});
