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
type Route = readonly (readonly [key: number, count: number])[];
type Walk = readonly (readonly [key: number, x: number, y: number])[];
interface Member { readonly health: number; readonly experience: number; readonly magic: number }
function record(path: string): unknown {
  const fences = [...readFileSync(path, "utf8").matchAll(/^```json\n([\s\S]*?)^```$/gm)];
  assert.equal(fences.length, 1); return JSON.parse(fences[0]![1]!);
}
const media = record("src/machines/6502/apple2.md") as Apple2Media;
const guide = record("docs/software/ultima-iv.md") as {
  boot: Identity; town: { image: Identity };
  stops: Record<"title" | "menu" | "exchange" | "command", Stop>;
  save: { start: Stop; returned: Stop; partyLoaded: Stop; rosterLoaded: Stop; files: readonly Ultima4SaveFile[] };
  magic: { stops: Record<"spellChoice" | "charged" | "healTarget" | "healAmount" | "healed", Stop> };
  companions: {
    image: Identity; gateApproach: Walk; britainApproach: Walk; townApproach: Route; townReturn: Route; encounterApproach: Walk; waits: number;
    stops: Record<"moonDestination" | "talkLoaded" | "conversation" | "joinCheck" | "memberAdded" | "firstTurn", Stop>;
    turns: readonly { actor: number; keys: readonly number[]; members: readonly (Member & { position: readonly number[] })[];
      enemies: readonly (readonly number[])[]; next: number }[];
    healed: readonly Member[]; resumed: readonly number[]; continuation: readonly number[];
  };
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function file(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  return { name: path, size: bytes.length, async arrayBuffer() { return bytes.buffer; } };
}
function decimal(bytes: readonly number[]): number {
  return bytes.reduce((n, b) => {
    assert.ok((b & 15) < 10 && (b >>> 4) < 10, "A character statistic contains valid packed decimal digits");
    return 100 * n + 10 * (b >>> 4) + (b & 15);
  }, 0);
}
const romPath = process.env.APPLE2_ROM, bootPath = process.env.APPLE2_ULTIMA_IV_BOOT;
const partyPath = process.env.APPLE2_ULTIMA_IV_MAGIC, townPath = process.env.APPLE2_ULTIMA_IV_TOWN;

test("Ultima IV recruits Iolo, fights with both characters, heals a different recipient, and reloads both records", {
  skip: !romPath || !bootPath || !partyPath || !townPath
    ? "Set APPLE2_ROM, APPLE2_ULTIMA_IV_BOOT, APPLE2_ULTIMA_IV_MAGIC and APPLE2_ULTIMA_IV_TOWN to the verified images" : false,
}, async t => {
  assert.ok(romPath); assert.ok(bootPath); assert.ok(partyPath); assert.ok(townPath);
  const companions = guide.companions, stops = companions.stops;
  async function disk(path: string, identity: Identity) {
    const selected = file(path), bytes = new Uint8Array(await selected.arrayBuffer());
    assert.equal(bytes.length, identity.bytes); assert.equal(hash(bytes), identity.sha256);
    return (await readApple2Disk(selected, media.disk, "read-only")).disk;
  }
  const rom = await readApple2Rom(file(romPath), romImages.firmware, media); assert.ok(rom.bootstrap);
  const boot = await disk(bootPath, guide.boot), party = await disk(partyPath, companions.image), town = await disk(townPath, guide.town.image);
  let session = createApple2Session(rom.image, { bootstrap: rom.bootstrap, image: boot });
  let diskName = "ultima_iv_boot.dsk", set = new Apple2DiskSet();
  set.add([{ name: diskName, disk: boot }, { name: "ultima_iv_br-magic-saved.dsk", disk: party }, { name: "ultima_iv_town.dsk", disk: town }]);
  let working: Dos33Disk;
  const ram = (address: number, length = 1) => Uint8Array.from({ length }, (_, i) => session.machine.ram.read(address + i));
  const upper = (address: number, length = 1) => Uint8Array.from({ length }, (_, i) => session.machine.upper.read(address - 0xe000 + i));
  const amount = (address: number, length = 1) => decimal([...upper(address, length)]);
  const members = (): Member[] => [0, 1].map(i => ({ health: amount(0xec18 + 32 * i, 2), experience: amount(0xec1c + 32 * i, 2), magic: amount(0xec16 + 32 * i) }));
  const fighters = () => members().map((member, i) => ({ ...member, position: [...upper(0xef80 + i), ...upper(0xef90 + i)] }));
  const enemies = () => Array.from({ length: 16 }, (_, i) => [i, ...upper(0xef00 + i), ...upper(0xef10 + i), ...upper(0xef40 + i)])
    .filter(([slot]) => upper(0xef50 + slot!)[0] !== 0);
  let printed = "";
  function runTo(stop: Stop, keys: readonly number[] = [], limit = 30_000_000,
    observe?: (step: Cpu6502StepRecord) => void, when: () => boolean = () => true): void {
    session.send(keys);
    for (let i = 0; i < limit; i++) {
      const step = session.step(); assert.equal(step.outcome, "executed");
      if (step.before.pc === 0x0fa9) printed += String.fromCharCode(step.before.a & 127);
      observe?.(step);
      if (step.after.pc !== stop.address || !when()) continue;
      assert.deepEqual([...ram(stop.address, stop.bytes.length)], stop.bytes); return;
    }
    assert.fail(`Did not reach $${stop.address.toString(16)}; PC=$${session.machine.cpu.snapshot().pc.toString(16)}`);
  }
  function position(expected: readonly number[], mode = 1): void {
    assert.deepEqual([...ram(0, 2)], expected); assert.equal(ram(11)[0], mode);
    assert.equal(session.pendingInput, 0); assert.equal(session.machine.disk.inspect().motor, false);
  }
  function walk(route: Walk, mode = 1): void {
    for (const [key, x, y] of route) { runTo(guide.stops.command, [key]); position([x, y], mode); }
  }
  function townWalk(route: Route): void {
    const directions = new Map([[21, [1, 0]], [8, [-1, 0]], [11, [0, -1]], [10, [0, 1]]]);
    for (const [key, count] of route) for (let i = 0; i < count; i++) {
      const before = [...ram(0, 2)], delta = directions.get(key); assert.ok(delta);
      runTo(guide.stops.command, [key]); position(before.map((n, i) => n + delta[i]!), 2);
    }
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
    mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, `${name}.json`), JSON.stringify(await snapshot(name)));
  }
  await t.test("a cold boot and naturally timed moongate reach Britain, where Iolo passes the recruitment checks", async () => {
    bootToExchange(); await checkpoint("ultima-iv-companions-exchange");
    insert(party, "ultima_iv_br-magic-saved.dsk"); runTo(guide.stops.command, [27]); position([232, 135]);
    working = new Dos33Disk(session.machine.disk.exportImage(), { writable: true });
    set.add([{ name: "ultima_iv_br-companion-working.dsk", disk: working }]); insert(working, "ultima_iv_br-companion-working.dsk");
    walk(companions.gateApproach); await checkpoint("ultima-iv-companions-gate");
    // Let the game's idle loop move the moons. Passing turns instead changes the nearby monsters.
    runTo(stops.moonDestination, [], 10_000_000, undefined, () => ram(18)[0] === 0 && ram(19)[0] === 1);
    runTo(guide.stops.command, [8]); position([96, 102]); walk(companions.britainApproach);
    runTo(guide.stops.exchange, [69], 80_000_000); insert(town, "ultima_iv_town.dsk"); runTo(guide.stops.command, [27], 80_000_000);
    position([1, 15], 2); townWalk(companions.townApproach); position([27, 29], 2);
    assert.deepEqual([...upper(0xee3f), ...upper(0xee5f)], [28, 29]);
    const before = upper(0xec00, 256); assert.equal(ram(15)[0], 1);
    assert.equal(amount(0xec1a, 2) / 100, 2); assert.equal(amount(0xed01), 60); assert.equal(upper(0xec11)[0], 0);
    assert.equal(String.fromCharCode(...upper(0xec20, 4).map(b => b & 127)), "IOLO"); assert.equal(upper(0xec31)[0], 1);
    await checkpoint("ultima-iv-companions-iolo");
    printed = ""; runTo(stops.talkLoaded, [84, 21]);
    assert.deepEqual(ram(0x8800, ultima4Binary(town, "TALK").length), ultima4Binary(town, "TALK"));
    runTo(stops.conversation); assert.match(printed, /YOU MEET\rCHARMING BARD/);
    runTo(stops.joinCheck, [..."JOIN\r"].map(c => c.charCodeAt(0))); assert.equal(ram(0xe1)[0], 0); assert.equal(ram(10)[0], 6);
    let swaps = 0; runTo(stops.memberAdded, [], 2_000_000, step => { if (step.before.pc === 0x8bf5) swaps++; });
    assert.equal(swaps, 32); assert.equal(ram(15)[0], 2); assert.deepEqual(upper(0xec00, 256), before, "Iolo is already the second record, so the swap is with itself");
    for (const address of [0xee1f, 0xee7f, 0xeedf, 0xeeff]) assert.equal(upper(address)[0], 0, "The recruited town object is cleared");
    runTo(guide.stops.command); assert.match(printed, /I AM HONORED\rTO JOIN THEE!/); assert.equal(members()[1]!.magic, 7);
    await checkpoint("ultima-iv-companions-joined");
    townWalk(companions.townReturn); position([0, 15], 2); runTo(guide.stops.exchange, [8], 80_000_000);
    insert(working, "ultima_iv_br-companion-working.dsk"); runTo(guide.stops.command, [27]); position([82, 106]);
    walk(companions.encounterApproach);
    for (let i = 0; i < companions.waits; i++) runTo(i + 1 === companions.waits ? stops.firstTurn : guide.stops.command, [32]);
    assert.equal(ram(11)[0], 128); assert.equal(ram(15)[0], 2); assert.equal(ram(0xd4)[0], 1);
    assert.deepEqual(enemies(), [[0, 6, 4, 107], [5, 7, 6, 109], [15, 9, 8, 45]]);
    await checkpoint("ultima-iv-companions-combat");
  });
  await t.test("both characters act, enemy damage and individual experience use checked decimal arithmetic", async () => {
    const initial = upper(0xec00, 256), attackers = new Set<number>(); printed = "";
    for (const turn of companions.turns) {
      assert.equal(ram(0xd4)[0], turn.actor); if (turn.keys[0] === 65) attackers.add(turn.actor);
      let expectedHealth: number | undefined, expectedExperience: number | undefined, recipient = 0;
      runTo(turn.next ? stops.firstTurn : guide.stops.command, turn.keys, 5_000_000, step => {
        if (step.before.pc === 0x85be) { recipient = ram(0xd4)[0]! - 1; expectedHealth = members()[recipient]!.health - decimal([step.before.a]); }
        if (step.after.pc === 0x85d4) { assert.equal(members()[recipient]!.health, expectedHealth); expectedHealth = undefined; }
        if (step.before.pc === 0x8658) { recipient = ram(0xd4)[0]! - 1; expectedExperience = members()[recipient]!.experience + decimal([step.before.a]); }
        if (step.after.pc === 0x866e) { assert.equal(members()[recipient]!.experience, expectedExperience); expectedExperience = undefined; }
      });
      assert.equal(expectedHealth, undefined); assert.equal(expectedExperience, undefined);
      assert.deepEqual(fighters(), turn.members); assert.deepEqual(enemies(), turn.enemies);
      if (turn.next) assert.equal(ram(0xd4)[0], turn.next); assert.equal(ram(15)[0], 2);
    }
    assert.deepEqual([...attackers].sort(), [1, 2]); assert.equal(printed.match(/ORC\rKILLED!/g)?.length, 3); assert.match(printed, /VICTORY!/);
    assert.deepEqual(members(), [{ health: 171, experience: 132, magic: 48 }, { health: 300, experience: 258, magic: 13 }]);
    const expected = initial.slice(); expected[24] = 1; expected[25] = 0x71; expected[32 + 29] = 0x58;
    assert.deepEqual(upper(0xec00, 256), expected, "Damage belongs to the mage and all three six-point rewards belong to Iolo; other roster bytes survive");
    await checkpoint("ultima-iv-companions-victory");
  });
  await t.test("Iolo spends the shared Heal mixture and his own MP to heal the selected mage", async () => {
    const replay = await snapshot("Before Iolo heals the mage");
    function heal(): void {
      const before = members(); assert.equal(amount(0xed47), 1);
      runTo(guide.magic.stops.spellChoice, [67, 50]); assert.equal(ram(0xd4)[0], 2);
      runTo(guide.magic.stops.charged, [72]); assert.equal(amount(0xed47), 0);
      assert.deepEqual(members(), [before[0], { ...before[1], magic: before[1]!.magic - 10 }]);
      runTo(guide.magic.stops.healTarget); let roll: number | undefined;
      runTo(guide.magic.stops.healAmount, [49], 2_000_000, step => { if (step.before.pc === 0x4c3f) roll = step.before.a; });
      assert.equal(ram(0xd4)[0], 1); assert.ok(roll !== undefined && roll >= 75 && roll <= 99);
      assert.equal(decimal([session.machine.cpu.snapshot().a]), roll); let sumChecked = false;
      runTo(guide.magic.stops.healed, [], 2_000_000, step => {
        if (step.after.pc === 0x860e) { assert.equal(members()[0]!.health, before[0]!.health + roll!); sumChecked = true; }
      });
      assert.ok(sumChecked); assert.equal(members()[0]!.health, Math.min(before[0]!.health + roll, amount(0xec1a, 2)));
      assert.equal(members()[1]!.health, before[1]!.health); assert.equal(members()[0]!.magic, before[0]!.magic);
      runTo(guide.stops.command); assert.deepEqual(members(), companions.healed);
    }
    heal(); const first = session.snapshot();
    const restored = await prepareApple2SavedState(replay, rom.image, media); session = restored.session; set = restored.diskSet; diskName = restored.diskName!;
    heal(); assert.deepEqual(session.snapshot(), first, "Checkpoint replay reproduces both records and every hardware/input byte");
    await checkpoint("ultima-iv-companions-healed");
  });
  await t.test("Q exports the complete party and a new machine reloads both records before taking another step", async () => {
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
    runTo(guide.stops.command); await checkpoint("ultima-iv-companions-saved");
    const directory = process.env.APPLE2_ULTIMA_IV_CHECKPOINTS;
    if (directory) writeFileSync(join(directory, "ultima_iv_br-companion-saved.dsk"), exported);
    session = createApple2Session(rom.image, { bootstrap: rom.bootstrap!, image: boot }); diskName = "ultima_iv_boot.dsk";
    bootToExchange(); const loaded = new Dos33Disk(exported); set.add([{ name: "ultima_iv_br-companion-saved.dsk", disk: loaded }]);
    insert(loaded, "ultima_iv_br-companion-saved.dsk"); runTo(guide.save.partyLoaded, [27]);
    assert.deepEqual(ram(0, 32), saved.find(file => file.name === "PRTY")!.payload.slice(0, 32));
    runTo(guide.save.rosterLoaded);
    for (const file of saved.filter(file => file.name !== "PRTY")) assert.deepEqual(upper(file.address, file.bytes), file.payload.slice(0, file.bytes));
    assert.equal(ram(15)[0], 2); assert.deepEqual(members(), companions.healed); assert.equal(amount(0xed47), 0);
    runTo(guide.stops.command); position(companions.resumed); assert.deepEqual(members(), companions.healed);
    await checkpoint("ultima-iv-companions-resumed");
    runTo(guide.stops.command, [8]); position(companions.continuation);
    assert.deepEqual(members(), [companions.healed[0], { ...companions.healed[1], magic: companions.healed[1]!.magic + 1 }]);
    assert.equal(ram(15)[0], 2); await checkpoint("ultima-iv-companions-continued");
    assert.deepEqual(loaded.exportImage(), exported); assert.equal(hash(boot.exportImage()), guide.boot.sha256);
    assert.equal(hash(party.exportImage()), companions.image.sha256); assert.equal(hash(town.exportImage()), guide.town.image.sha256);
  });
});
