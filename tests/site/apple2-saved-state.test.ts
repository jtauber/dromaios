import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { apple2SavedStates, prepareApple2SavedState } from "../../site/interactive/apple2-saved-state.js";
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
function saved(session = createApple2Session(), name = "Before echo"): Apple2SavedState {
  return { version: 1, machine: "apple2-plus", name, savedAt: "2026-10-07T12:00:00.000Z",
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
  machine.cpu.step(); machine.keyboard.offer(65); session.send([66, 13]);
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
  for (const value of ["{", "null", "{}", JSON.stringify({ ...first, version: 2 }),
    JSON.stringify({ ...first, machine: "other" }), JSON.stringify({ ...first, name: "wrong name" }),
    JSON.stringify({ ...first, savedAt: "bad" }), " ".repeat(1_000_001)]) {
    memory.values.set(key, value); assert.throws(() => store.read(first.name));
    assert.deepEqual(store.names(), [first.name]);
  }
  store.remove(first.name); assert.deepEqual(store.names(), []);
  await assert.rejects(prepareApple2SavedState({ ...first, version: 2 } as unknown as Apple2SavedState, null, media), /version/);
});

test("preparation rechecks saved bootstrap and disk identities and never changes the original session", async () => {
  const original = createApple2Session(null, { bootstrap: [...bootstrap], image: new Dos33Disk(diskBytes) });
  original.send([65]); original.machine.disk.read(9); original.machine.disk.read(12);
  const first = saved(original), before = original.snapshot();
  const prepared = await prepareApple2SavedState(first, null, media);
  assert.deepEqual(prepared.session.snapshot(), before); assert.equal(prepared.disk?.name, "test.dsk"); assert.equal(prepared.flash, true);
  for (const field of ["bootstrap", "media"] as const) {
    const altered = structuredClone(first); (altered.state.hardware.disk[field] as number[])[0] = 99;
    await assert.rejects(prepareApple2SavedState(altered, null, media), /bootstrap|match/);
  }
  await assert.rejects(prepareApple2SavedState({ ...first, diskName: null }, null, media), /name/);
  assert.deepEqual(original.snapshot(), before);
});

test("comparisons distinguish hidden physical banks, net changes, flags, devices and equal-length changed input queues", () => {
  const session = createApple2Session(); session.send([65]); const before = session.snapshot();
  session.machine.ram.write(0x10, 1); session.machine.ram.write(0x10, 0);
  session.machine.ram.write(0x20, 0x42); session.machine.bank1.write(0, 11); session.machine.bank2.write(0, 22);
  session.machine.upper.write(0x1fff, 33); editApple2Register(session.machine, "x", "FF");
  session.machine.ram.write(0, 0xe8); session.machine.cpu.step(); // INX wraps and sets Z.
  session.machine.keyboard.offer(66); session.machine.video.read(5);
  const after = { ...session.snapshot(), input: [67] };
  const diff = compareApple2States(before, after);
  assert.deepEqual(diff.registers, [{ name: "PC", before: 0, after: 1, width: 4 }]);
  assert.deepEqual(diff.flags, [{ name: "Z", before: 0, after: 1, width: 1 }]);
  assert.deepEqual(diff.memory.map(({ region, address }) => [region, address]), [
    ["ram", 0], ["ram", 0x20], ["bank1", 0xd000], ["bank2", 0xd000], ["upper", 0xffff],
  ]);
  assert.equal(diff.devices.length, 3); assert.equal(diff.inputChanged, true);
  const same = compareApple2States(before, before);
  assert.deepEqual(same, { registers: [], flags: [], memory: [], devices: [], inputChanged: false });
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
  session.send([65, 13]); const initial = saved(session);
  const records = Array.from({ length: 500 }, () => session.step()), after = session.snapshot();
  const prepared = await prepareApple2SavedState(initial, rom.image, media);
  assert.deepEqual(Array.from({ length: 500 }, () => prepared.session.step()), records);
  assert.deepEqual(prepared.session.snapshot(), after);
});
