import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { apple2SavedStates, encodeApple2SavedState, prepareApple2SavedState } from "../../site/interactive/apple2-saved-state.js";
import type { Apple2SavedState } from "../../site/interactive/apple2-saved-state.js";
import { compareApple2States } from "../../site/interactive/apple2-state-comparison.js";
import { editApple2Register } from "../../site/interactive/apple2-register-edit.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import { readApple2Rom } from "../../site/interactive/apple2-media.js";
import { romImages } from "../../src/machines/generated/6502/apple2.js";

const bootstrap = Uint8Array.from({ length: 256 }, (_, index) => index);
const diskBytes = new Uint8Array(Dos33Disk.size);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const media = { bytes: 20480, offset: 8192, sha256: "0".repeat(64),
  bootstrap: { bytes: 256, offset: 0, sha256: digest(bootstrap) }, disk: { bytes: diskBytes.length, sha256: digest(diskBytes) } };
function saved(session = createApple2Session(), name = "Before echo"): Extract<Apple2SavedState, { version: 5 }> {
  const bytes = session.machine.disk.snapshot().media;
  return { version: 5, diskSha256: bytes === null ? null : digest(Uint8Array.from(bytes)),
    machine: "apple2-plus", name, savedAt: "2026-10-07T12:00:00.000Z",
    diskName: session.machine.disk.inspect().loaded ? "test.dsk" : null, flash: true, state: session.snapshot() };
}
function storage() {
  const values = new Map<string, string>();
  return { values, get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}

test("session snapshots restore independent CPU, physical banks, devices, media position, and queued input without guest reads", () => {
  const session = createApple2Session(null, { bootstrap: [...bootstrap], image: new Dos33Disk(diskBytes) });
  const machine = session.machine;
  machine.ram.write(0x200, 0xe8); editApple2Register(machine, "pc", "0200");
  machine.step(); machine.keyboard.offer(65); session.send([66, 13]);
  machine.video.read(5); machine.language.read(3); machine.language.read(3);
  machine.bank1.write(0, 11); machine.bank2.write(0, 22); machine.upper.write(0, 33);
  machine.disk.read(9); machine.disk.read(12);
  const before = session.snapshot();
  machine.memory.read = machine.memory.write = () => { throw new Error("Guest access during snapshot"); };
  assert.deepEqual(session.snapshot(), before);
  session.send([67]); machine.ram.write(0x28, 99);
  session.restore(before);
  assert.notEqual(session.machine, machine); assert.deepEqual(session.snapshot(), before);
  session.machine.bank1.write(0, 44); assert.equal(before.hardware.bank1[0], 11);
  session.restore(before); assert.equal(session.machine.bank1.read(0), 11);
  const sequence = Array.from({ length: 12 }, () => session.machine.disk.read(12));
  session.restore(before);
  assert.deepEqual(Array.from({ length: 12 }, () => session.machine.disk.read(12)), sequence);
  session.powerOn();
  assert.equal(session.machine.clock.ticks, 0);
  assert.equal(session.pendingInput, 0); assert.equal(session.machine.ram.read(0x200), 0);
  assert.deepEqual(session.machine.disk.snapshot().media, [...diskBytes]);
  session.eject(); const ejected = session.snapshot(); session.restore(ejected); session.powerOn();
  assert.equal(session.machine.disk.inspect().loaded, false); assert.equal(session.machine.disk.inspect().installed, false);
});

test("invalid session snapshots and mismatched firmware leave current hardware and input intact", () => {
  const session = createApple2Session(); session.send([65]); const before = session.snapshot(), original = session.machine;
  const malformed: unknown[] = [null, {}, { ...before, input: [128] }, { ...before, input: Array(4097).fill(65) },
    { ...before, hardware: { ...before.hardware, firmware: romImages.firmware.sha256 } }];
  malformed.push(
    { ...before, hardware: { ...before.hardware, keyboard: undefined } },
    { ...before, hardware: { ...before.hardware, clock: { ticks: -1 } } },
    { ...before, hardware: { ...before.hardware, clock: undefined } },
    { ...before, hardware: { ...before.hardware, cpu: { a: 0 } } },
    { ...before, hardware: { ...before.hardware, bank1: [-1, ...before.hardware.bank1.slice(1)] } },
    { ...before, hardware: { ...before.hardware, language: { ...before.hardware.language, bank2: 1 } } },
    { ...before, hardware: { ...before.hardware, disk: { ...before.hardware.disk, position: 1 } } },
  );
  for (const value of malformed) {
    assert.throws(() => session.restore(value));
    assert.equal(session.machine, original); assert.deepEqual(session.snapshot(), before);
  }
});

test("named storage survives fresh readers, avoids silent replacement, and preserves existing entries on quota failure", () => {
  const memory = storage(), store = apple2SavedStates(() => memory);
  const first = saved(); store.save(first);
  assert.deepEqual(apple2SavedStates(() => memory).read(first.name), first);
  store.save(saved(createApple2Session(), "Before scroll / page 2"));
  assert.deepEqual(store.names(), ["Before echo", "Before scroll / page 2"]);
  assert.throws(() => store.save(first), /already saved/);
  const before = [...memory.values];
  memory.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.throws(() => store.save(saved(createApple2Session(), "Another")), /could not save/);
  assert.deepEqual([...memory.values], before);
  for (const name of ["", "   ", "name ", "x".repeat(81)]) assert.throws(() => store.save({ ...first, name }));
  store.remove(first.name); assert.throws(() => store.read(first.name), /no longer/);
  assert.deepEqual(store.names(), ["Before scroll / page 2"]);
});

test("damaged entries remain deletable and incompatible machine versions are rejected", async () => {
  const memory = storage(), store = apple2SavedStates(() => memory), first = saved(); store.save(first);
  const key = [...memory.values.keys()][0]!;
  for (const value of ["{", "null", "{}", JSON.stringify({ ...first, version: 6 }),
    JSON.stringify({ ...first, machine: "other" }), JSON.stringify({ ...first, name: "wrong name" }),
    JSON.stringify({ ...first, savedAt: "bad" }), " ".repeat(1_000_001)]) {
    memory.values.set(key, value); assert.throws(() => store.read(first.name));
    assert.deepEqual(store.names(), [first.name]);
  }
  store.remove(first.name); assert.deepEqual(store.names(), []);
  await assert.rejects(prepareApple2SavedState({ ...first, version: 6 } as unknown as Apple2SavedState, null, media), /version/);
});

test("preparation rechecks saved bootstrap and disk identities and never changes the original session", async () => {
  const original = createApple2Session(null, { bootstrap: [...bootstrap], image: new Dos33Disk(diskBytes) });
  original.send([65]); original.machine.disk.read(9); original.machine.disk.read(12);
  const first = saved(original), before = original.snapshot();
  const prepared = await prepareApple2SavedState(first, null, media);
  assert.deepEqual(prepared.session.snapshot(), before); assert.equal(prepared.diskName, "test.dsk"); assert.equal(prepared.flash, true);
  for (const field of ["bootstrap", "media"] as const) {
    const altered = structuredClone(first); (altered.state.hardware.disk[field] as number[])[0] = 99;
    await assert.rejects(prepareApple2SavedState(altered, null, media), /bootstrap|match/);
  }
  await assert.rejects(prepareApple2SavedState({ ...first, diskName: null, diskSha256: null }, null, media), /name/);
  assert.deepEqual(original.snapshot(), before);
});

test("new checkpoints restore a local disk's bytes, name and permission after ejection and reload", async () => {
  const memory = storage(), bytes = diskBytes.slice(); bytes[0x12600] = 42;
  for (const writable of [true, false]) {
    const session = createApple2Session(null, { bootstrap: [...bootstrap], image: new Dos33Disk(bytes, { writable }) });
    const state = await encodeApple2SavedState({ ...saved(session), name: String(writable), diskName: "answer.dsk" });
    apple2SavedStates(() => memory).save(state);
    session.eject();
    const stored = apple2SavedStates(() => memory).read(state.name);
    const restored = await prepareApple2SavedState(stored, null, media);
    assert.equal(restored.diskName, "answer.dsk");
    assert.deepEqual(restored.session.machine.disk.exportImage(), bytes);
    assert.equal(restored.session.machine.disk.inspect().writable, writable);
    restored.session.powerOn();
    assert.deepEqual(restored.session.machine.disk.exportImage(), bytes);
    assert.equal(restored.session.machine.disk.inspect().writable, writable);
    (stored.state.hardware.disk.media as number[])[0x12600] = 0;
    await assert.rejects(prepareApple2SavedState(stored, null, media), /digest/);
  }
  const empty = await encodeApple2SavedState(saved());
  assert.equal((await prepareApple2SavedState(empty, null, media)).diskName, null);
});

test("new checkpoints preserve speaker and clocks; older formats supply only their missing state", async () => {
  const session = createApple2Session();
  session.machine.ram.write(0, 0xea); session.machine.step();
  session.machine.speaker.read(0);
  const current = await encodeApple2SavedState(saved(session));
  assert.equal(current.version, 5);
  assert.equal((await prepareApple2SavedState(current, null, media)).session.machine.clock.ticks, 2);
  assert.equal((await prepareApple2SavedState(current, null, media)).session.machine.speaker.level(), true);
  const { clock: omitted, speaker: omittedSpeaker, disk: currentDisk, ...rest } = session.snapshot().hardware;
  const { byteClocks, writeStart, ...disk } = currentDisk;
  const hardware = { ...rest, disk };
  const state = { ...session.snapshot(), hardware };
  const { version: ignored, diskSha256, ...details } = saved(session);
  for (const legacy of [{ ...details, state, version: 1 }, { ...details, state, version: 2, diskSha256 },
    { ...details, state: { ...state, hardware: { ...hardware, clock: { ticks: 2 } } }, version: 3, diskSha256 },
    { ...details, state: { ...state, hardware: { ...hardware, clock: { ticks: 2 }, speaker: { level: true } } }, version: 4, diskSha256 }] as const) {
    const restored = await prepareApple2SavedState(legacy, null, media);
    assert.deepEqual(restored.session.snapshot(), { ...state, hardware: { ...hardware,
      disk: currentDisk, clock: { ticks: legacy.version >= 3 ? 2 : 0 }, speaker: { level: legacy.version === 4 } } });
    await assert.rejects(prepareApple2SavedState({ ...legacy, state: session.snapshot() }, null, media), /snapshot/);
  }
  await assert.rejects(prepareApple2SavedState({ ...current, state } as Apple2SavedState, null, media), /snapshot/);
});

test("comparisons distinguish hidden physical banks, net changes, flags, devices and equal-length changed input queues", () => {
  const session = createApple2Session(); session.send([65]); const before = session.snapshot();
  session.machine.ram.write(0x10, 1); session.machine.ram.write(0x10, 0);
  session.machine.ram.write(0x20, 0x42); session.machine.bank1.write(0, 11); session.machine.bank2.write(0, 22);
  session.machine.upper.write(0x1fff, 33); editApple2Register(session.machine, "x", "FF");
  session.machine.ram.write(0, 0xe8); session.machine.step(); // INX wraps and sets Z.
  session.machine.keyboard.offer(66); session.machine.video.read(5);
  const after = { ...session.snapshot(), input: [67] };
  const diff = compareApple2States(before, after);
  assert.deepEqual(diff.registers, [{ name: "PC", before: 0, after: 1, width: 4 }]);
  assert.deepEqual(diff.flags, [{ name: "Z", before: 0, after: 1, width: 1 }]);
  assert.deepEqual(diff.memory.map(({ region, address }) => [region, address]), [
    ["ram", 0], ["ram", 0x20], ["bank1", 0xd000], ["bank2", 0xd000], ["upper", 0xffff],
  ]);
  assert.equal(diff.devices.length, 4); assert.equal(diff.inputChanged, true);
  assert.deepEqual(diff.devices[0], { name: "clock.ticks", before: "0", after: "2" });
  const same = compareApple2States(before, before);
  assert.deepEqual(same, { registers: [], flags: [], memory: [], devices: [], inputChanged: false });
});

test("comparison sees a changed mounted disk and write permission in either direction", () => {
  const protectedDisk = createApple2Session(null, { bootstrap: [...bootstrap], image: new Dos33Disk(diskBytes) }).snapshot();
  const bytes = diskBytes.slice(); bytes[77] = 42;
  const edited = createApple2Session(null, { bootstrap: [...bootstrap], image: new Dos33Disk(bytes, { writable: true }) }).snapshot();
  for (const [from, to] of [[protectedDisk, edited], [edited, protectedDisk]] as const) {
    const differences = compareApple2States(from, to).devices.map(field => field.name);
    assert.deepEqual(differences, ["disk.writable", "disk.media · first differing byte at $4D"]);
  }
});

test("a saved real-ROM session repeats queued-key execution exactly after restoration", {
  skip: process.env.APPLE2_ROM === undefined ? "Set APPLE2_ROM to the externally supplied Apple II Plus ROM" : false,
}, async () => {
  const chapter = readFileSync("src/machines/6502/apple2.md", "utf8");
  const media = JSON.parse(chapter.match(/```json\n([\s\S]*?)```/)![1]!);
  const bytes = new Uint8Array(readFileSync(process.env.APPLE2_ROM!));
  const rom = await readApple2Rom({ name: "apple2p.rom", size: bytes.length, async arrayBuffer() { return bytes.buffer; } }, romImages.firmware, media);
  const session = createApple2Session(rom.image);
  for (let count = 0; count < 100_000 && session.machine.cpu.snapshot().pc !== 0xfd21; count++) session.step();
  assert.equal(session.machine.cpu.snapshot().pc, 0xfd21);
  assert.ok(session.machine.clock.ticks > 0);
  session.send([65, 13]); const initial = saved(session);
  const records = Array.from({ length: 500 }, () => session.step()), after = session.snapshot();
  const prepared = await prepareApple2SavedState(initial, rom.image, media);
  assert.deepEqual(Array.from({ length: 500 }, () => prepared.session.step()), records);
  assert.deepEqual(prepared.session.snapshot(), after);
  const elapsed = prepared.session.machine.clock.ticks;
  prepared.session.reset(); assert.equal(prepared.session.machine.clock.ticks, elapsed);
  prepared.session.powerOn(); assert.equal(prepared.session.machine.clock.ticks, 0);
});

test("version 4 disk migration retains an open sector write and rejects injected rotation fields", async () => {
  const session = createApple2Session(null, { bootstrap: [...bootstrap], image: new Dos33Disk(diskBytes, { writable: true }) });
  const controller = session.machine.disk;
  controller.read(9); controller.advanceCpuClocks(1210 * 32);
  controller.write(13, 0); controller.write(15, 0xff); controller.read(12); controller.advanceCpuClocks(32);
  controller.write(13, 0xd5); controller.read(12); controller.advanceCpuClocks(32);
  controller.write(13, 0xaa); // Loaded but not yet shifted when the old state was saved.
  const current = saved(session), { byteClocks, writeStart, ...disk } = current.state.hardware.disk;
  const old = { ...current, version: 4 as const, state: { ...current.state, hardware: { ...current.state.hardware, disk } } };
  const restored = await prepareApple2SavedState(old, null, media);
  assert.deepEqual(restored.session.machine.disk.snapshot(), { ...disk, byteClocks: 0, writeStart: 1210 });
  restored.session.machine.disk.read(12);
  assert.deepEqual(restored.session.machine.disk.snapshot().shifted, [0xff, 0xd5, 0xaa]);
  await assert.rejects(prepareApple2SavedState({ ...old, state: current.state }, null, media), /snapshot/);
  await assert.rejects(prepareApple2SavedState({ ...old, state: { ...old.state, hardware: { ...old.state.hardware,
    disk: { ...disk, q7: false, latch: 256 } } } }, null, media), /latch/);
});
