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
interface Position { readonly x: number; readonly y: number }
type Route = readonly (readonly [key: number, count: number])[];
function record(path: string): unknown {
  const fences = [...readFileSync(path, "utf8").matchAll(/^```json\n([\s\S]*?)^```$/gm)];
  assert.equal(fences.length, 1); return JSON.parse(fences[0]![1]!);
}
const media = record("src/machines/6502/apple2.md") as Apple2Media;
const guide = record("docs/software/ultima-iv.md") as {
  boot: Identity; town: { image: Identity }; combat: { resumed: Position };
  stops: Record<"title" | "menu" | "exchange" | "command", Stop>;
  save: { start: Stop; returned: Stop; partyLoaded: Stop; rosterLoaded: Stop; files: readonly Ultima4SaveFile[] };
  magic: {
    image: Identity; approach: Route; townApproach: Route; townReturn: Route;
    shop: Position & { keeperX: number; keeperY: number; quantity: number; price: number; goldBefore: number; goldAfter: number };
    stops: Record<"shopPrompt" | "mixLoaded" | "mixChoice" | "reagent" | "mixtureStored" | "spellChoice" | "charged" | "healTarget" | "healAmount" | "healed", Stop>;
    initial: { health: number; maximumHealth: number; experience: number; magic: number; reagents: readonly number[]; healMixtures: number };
    mixed: { reagents: readonly number[]; healMixtures: number };
    healed: { health: number; experience: number; magic: number; healMixtures: number };
    resumed: Position; continuation: Position;
  };
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function file(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  return { name: path, size: bytes.length, async arrayBuffer() { return bytes.buffer; } };
}
function decimal(bytes: readonly number[]): number {
  return bytes.reduce((n, b) => {
    assert.ok((b & 15) < 10 && (b >>> 4) < 10, "A saved statistic uses valid packed decimal digits");
    return 100 * n + 10 * (b >>> 4) + (b & 15);
  }, 0);
}
const romPath = process.env.APPLE2_ROM, bootPath = process.env.APPLE2_ULTIMA_IV_BOOT;
const partyPath = process.env.APPLE2_ULTIMA_IV_COMBAT, townPath = process.env.APPLE2_ULTIMA_IV_TOWN;

test("Ultima IV buys reagents, mixes Heal, heals its wounded mage, and reloads the saved inventory", {
  skip: !romPath || !bootPath || !partyPath || !townPath
    ? "Set APPLE2_ROM, APPLE2_ULTIMA_IV_BOOT, APPLE2_ULTIMA_IV_COMBAT and APPLE2_ULTIMA_IV_TOWN to the verified images" : false,
}, async t => {
  assert.ok(romPath); assert.ok(bootPath); assert.ok(partyPath); assert.ok(townPath);
  const magic = guide.magic, stops = magic.stops;
  async function disk(path: string, identity: Identity) {
    const selected = file(path), bytes = new Uint8Array(await selected.arrayBuffer());
    assert.equal(bytes.length, identity.bytes); assert.equal(hash(bytes), identity.sha256);
    return (await readApple2Disk(selected, media.disk, "read-only")).disk;
  }
  const rom = await readApple2Rom(file(romPath), romImages.firmware, media); assert.ok(rom.bootstrap);
  const boot = await disk(bootPath, guide.boot), party = await disk(partyPath, magic.image), town = await disk(townPath, guide.town.image);
  let session = createApple2Session(rom.image, { bootstrap: rom.bootstrap, image: boot });
  let diskName = "ultima_iv_boot.dsk", set = new Apple2DiskSet();
  set.add([{ name: diskName, disk: boot }, { name: "ultima_iv_br-combat-saved.dsk", disk: party }, { name: "ultima_iv_town.dsk", disk: town }]);
  let working: Dos33Disk;
  const ram = (address: number, length: number) => Uint8Array.from({ length }, (_, i) => session.machine.ram.read(address + i));
  const upper = (address: number, length: number) => Uint8Array.from({ length }, (_, i) => session.machine.upper.read(address - 0xe000 + i));
  const amount = (address: number, length = 1) => decimal([...upper(address, length)]);
  const inventory = () => ({ reagents: [...upper(0xed38, 8)].map(b => decimal([b])), healMixtures: amount(0xed47) });
  const hero = () => ({ health: amount(0xec18, 2), experience: amount(0xec1c, 2), magic: amount(0xec16) });
  function position(expected: Position, mode = 1): void {
    assert.deepEqual([...ram(0, 2)], [expected.x, expected.y]); assert.equal(ram(11, 1)[0], mode);
    assert.equal(session.pendingInput, 0); assert.equal(session.machine.disk.inspect().motor, false);
  }
  let printed = "";
  function runTo(stop: Stop, key?: number, limit = 30_000_000, observe?: (step: Cpu6502StepRecord) => void): void {
    if (key !== undefined) session.send([key]);
    for (let i = 0; i < limit; i++) {
      const step = session.step(); assert.equal(step.outcome, "executed");
      if (step.before.pc === 0x0fa9) printed += String.fromCharCode(step.before.a & 127);
      observe?.(step);
      if (step.after.pc !== stop.address) continue;
      assert.deepEqual([...ram(stop.address, stop.bytes.length)], stop.bytes);
      return;
    }
    assert.fail(`Did not reach $${stop.address.toString(16)}; PC=$${session.machine.cpu.snapshot().pc.toString(16)}`);
  }
  function walk(route: Route): void {
    const directions = new Map([[21, [1, 0]], [8, [-1, 0]], [11, [0, -1]], [10, [0, 1]]]);
    for (const [key, count] of route) for (let i = 0; i < count; i++) {
      const before = [...ram(0, 2)], delta = directions.get(key); assert.ok(delta);
      runTo(guide.stops.command, key);
      assert.deepEqual([...ram(0, 2)], before.map((n, i) => n + delta[i]!), "Each recorded walk reaches its next square");
    }
  }
  function insert(disk: Dos33Disk, name: string): void { session.swapDisk(disk); diskName = name; }
  function bootToExchange(): void {
    runTo(guide.stops.title, undefined, 200_000_000); runTo(guide.stops.menu, 32); runTo(guide.stops.exchange, 74, 80_000_000);
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
  await t.test("a fresh boot resumes the wounded mage and a walk to Margot buys three spider silk for nine gold", async () => {
    bootToExchange(); insert(party, "ultima_iv_br-combat-saved.dsk"); runTo(guide.stops.command, 27);
    position(guide.combat.resumed); assert.deepEqual(hero(), { health: magic.initial.health, experience: magic.initial.experience, magic: magic.initial.magic });
    assert.equal(amount(0xec1a, 2), magic.initial.maximumHealth);
    assert.deepEqual(inventory(), { reagents: magic.initial.reagents, healMixtures: magic.initial.healMixtures });
    working = new Dos33Disk(session.machine.disk.exportImage(), { writable: true });
    set.add([{ name: "ultima_iv_br-magic-working.dsk", disk: working }]); insert(working, "ultima_iv_br-magic-working.dsk");
    walk(magic.approach); position(magic.resumed);
    runTo(guide.stops.exchange, 69, 80_000_000); insert(town, "ultima_iv_town.dsk"); runTo(guide.stops.command, 27, 80_000_000);
    position({ x: 1, y: 15 }, 2); walk(magic.townApproach); position(magic.shop, 2);
    assert.deepEqual([...upper(0xee37, 1), ...upper(0xee57, 1)], [magic.shop.keeperX, magic.shop.keeperY]);
    assert.equal(amount(0xed13, 2), magic.shop.goldBefore);
    printed = ""; session.send([84, 11]); runTo(stops.shopPrompt, undefined, 50_000_000);
    assert.match(printed, /WELCOME TO\rMAGICAL HERBS/); assert.match(printed, /I AM MARGOT/);
    printed = ""; session.send([89, 68, 51, 57, 13, 78]); runTo(guide.stops.command);
    assert.match(printed, /SPIDER SILK\rFOR 03gp/); assert.match(printed, /WILL BE 09g\.p\./);
    assert.equal(magic.shop.quantity * magic.shop.price, magic.shop.goldBefore - magic.shop.goldAfter);
    assert.equal(amount(0xed13, 2), magic.shop.goldAfter);
    assert.deepEqual(inventory(), { reagents: [0, 3, 4, 3, 0, 0, 0, 0], healMixtures: 0 });
    await checkpoint("ultima-iv-magic-bought");
    walk(magic.townReturn); position({ x: 0, y: 15 }, 2);
    runTo(guide.stops.exchange, 8, 80_000_000); insert(working, "ultima_iv_br-magic-working.dsk");
    runTo(guide.stops.command, 27, 80_000_000); position(magic.resumed); await checkpoint("ultima-iv-magic-ready");
  });
  await t.test("two mixtures consume their declared ingredients, and Heal charges resources before capping HP", async () => {
    runTo(stops.mixLoaded, 77); const mix = ultima4Binary(working, "MIX");
    assert.deepEqual(ram(0x8800, mix.length), mix, "The game's MIX overlay comes from the mounted Britannia disk");
    assert.deepEqual([...ram(0x890c, 8)], [128, 64, 32, 16, 8, 4, 2, 1]);
    assert.equal(ram(0x8a12, 1)[0], 0x40 | 0x10, "Heal requires ginseng and spider silk, matching the original manual");
    runTo(stops.mixChoice); printed = "";
    for (let mixed = 1; mixed <= 2; mixed++) {
      runTo(stops.reagent, 72); assert.equal(ram(0x890b, 1)[0], 0);
      for (const [key, index, bits] of [[66, 1, 0x40], [68, 3, 0x50]] as const) {
        const before = inventory().reagents; runTo(stops.reagent, key);
        const expected = before.map((value, i) => value - (i === index ? 1 : 0));
        assert.deepEqual(inventory().reagents, expected); assert.equal(ram(0x890b, 1)[0], bits);
      }
      runTo(stops.mixtureStored, 13); assert.equal(amount(0xed47), mixed); runTo(stops.mixChoice);
    }
    assert.equal(printed.match(/SUCCESS!/g)?.length, 2); assert.doesNotMatch(printed, /FIZZLES|NONE OWNED/);
    runTo(guide.stops.command, 27); assert.deepEqual(inventory(), magic.mixed); await checkpoint("ultima-iv-magic-mixed");
    const replay = await snapshot("Before casting Heal");
    function cast(): void {
      printed = ""; session.send([67, 49]); runTo(stops.spellChoice);
      const before = hero(); assert.equal(before.magic, 48);
      runTo(stops.charged, 72); assert.equal(amount(0xed47), magic.mixed.healMixtures - 1);
      assert.equal(ram(0x496c + 7, 1)[0], 0x10); assert.equal(hero().magic, before.magic - 10);
      assert.equal(hero().health, before.health); runTo(stops.healTarget);
      let roll: number | undefined, sumChecked = false;
      runTo(stops.healAmount, 49, 2_000_000, step => {
        if (step.before.pc === 0x4c3f) { roll = step.before.a; assert.ok(roll >= 75 && roll <= 99); }
      });
      assert.ok(roll !== undefined); assert.equal(decimal([session.machine.cpu.snapshot().a]), roll);
      runTo(stops.healed, undefined, 2_000_000, step => {
        if (step.after.pc === 0x860e) { assert.equal(hero().health, before.health + roll!); sumChecked = true; }
      });
      assert.ok(sumChecked); assert.equal(hero().health, Math.min(before.health + roll, magic.initial.maximumHealth));
      assert.equal(hero().magic, before.magic - 10); runTo(guide.stops.command);
      assert.match(printed, /HEAL!/); assert.match(printed, /DROMAIOS200G/); assert.match(printed, /DONE\./);
      assert.deepEqual(hero(), { health: magic.healed.health, experience: magic.healed.experience, magic: magic.healed.magic });
      assert.deepEqual(inventory(), { reagents: magic.mixed.reagents, healMixtures: magic.healed.healMixtures });
    }
    cast(); const first = session.snapshot();
    const restored = await prepareApple2SavedState(replay, rom.image, media);
    session = restored.session; set = restored.diskSet; diskName = restored.diskName!; cast();
    assert.deepEqual(session.snapshot(), first, "A serialized pre-cast checkpoint reproduces every hardware and input byte");
    await checkpoint("ultima-iv-magic-healed");
  });
  await t.test("Q writes the complete inventory and party, then a new machine reloads the export and takes a step", async () => {
    const original = session.machine.disk.exportImage(); runTo(guide.save.start, 81);
    const saved = guide.save.files.map(file => ({ ...file, payload: file.address < 0xc000
      ? ram(file.address, file.bytes + 1) : upper(file.address, file.bytes + 1) }));
    const writes: number[][] = [], reads: number[][] = [];
    const detach = session.machine.disk.medium!.observeWrites(w => writes.push([w.track, w.sector]));
    try { runTo(guide.save.returned, undefined, 50_000_000, step => {
      if (step.before.pc !== 0xacc7) return;
      const read = step.accesses.filter(a => a.kind === "read").at(-1)!; reads.push([read.address, read.value]);
    }); } finally { detach(); }
    assert.deepEqual(reads, saved.flatMap(file => Array.from(file.payload, (value, i) => [file.address + i, value])));
    assert.deepEqual(writes, saved.flatMap(file => [...file.sectors.map(sector => [file.track, sector]), [17, 13]]));
    const exported = session.machine.disk.exportImage(); checkUltima4Save(original, exported, saved);
    runTo(guide.stops.command); await checkpoint("ultima-iv-magic-saved");
    const directory = process.env.APPLE2_ULTIMA_IV_CHECKPOINTS;
    if (directory) writeFileSync(join(directory, "ultima_iv_br-magic-saved.dsk"), exported);
    // No checkpoint or previous RAM enters this machine: the original Boot disk loads the export.
    session = createApple2Session(rom.image, { bootstrap: rom.bootstrap!, image: boot }); diskName = "ultima_iv_boot.dsk";
    bootToExchange(); const loaded = new Dos33Disk(exported); set.add([{ name: "ultima_iv_br-magic-saved.dsk", disk: loaded }]);
    insert(loaded, "ultima_iv_br-magic-saved.dsk"); runTo(guide.save.partyLoaded, 27);
    assert.deepEqual(ram(0, 32), saved.find(file => file.name === "PRTY")!.payload.slice(0, 32));
    runTo(guide.save.rosterLoaded);
    for (const file of saved.filter(file => file.name !== "PRTY")) assert.deepEqual(upper(file.address, file.bytes), file.payload.slice(0, file.bytes));
    assert.equal(hero().health, magic.healed.health); assert.equal(hero().magic, magic.healed.magic);
    assert.equal(amount(0xed13, 2), magic.shop.goldAfter); assert.deepEqual(inventory(), { reagents: magic.mixed.reagents, healMixtures: 1 });
    runTo(guide.stops.command); position(magic.resumed); await checkpoint("ultima-iv-magic-resumed");
    assert.equal(hero().magic, magic.healed.magic, "Reaching the first prompt preserves the saved 39 MP");
    runTo(guide.stops.command, 8); position(magic.continuation); assert.equal(hero().health, magic.healed.health);
    assert.equal(hero().magic, magic.healed.magic + 1, "The ordinary move regenerates one MP");
    assert.deepEqual(inventory(), { reagents: magic.mixed.reagents, healMixtures: 1 }); await checkpoint("ultima-iv-magic-continued");
    assert.deepEqual(loaded.exportImage(), exported); assert.equal(hash(boot.exportImage()), guide.boot.sha256);
    assert.equal(hash(party.exportImage()), magic.image.sha256); assert.equal(hash(town.exportImage()), guide.town.image.sha256);
  });
});
