import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import { Apple2DiskSet } from "../../site/interactive/apple2-disk-set.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { encodeApple2SavedState, prepareApple2SavedState } from "../../site/interactive/apple2-saved-state.js";
import type { Apple2SavedState } from "../../site/interactive/apple2-saved-state.js";

const bootstrap = new Uint8Array(256), bytes = new Uint8Array(Dos33Disk.size);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const media = { bytes: 20480, offset: 8192, sha256: "0".repeat(64),
  bootstrap: { bytes: 256, offset: 0, sha256: hash(bootstrap) }, disk: { bytes: bytes.length, sha256: hash(bytes) } };
const sector = Uint8Array.from({ length: 256 }, (_, i) => 255 - i);
const changed = bytes.slice(); changed.set(sector, 6 * 256);
const encoded = new Dos33Disk(changed);
const frame = [0xff, ...Array.from({ length: 349 }, (_, i) => encoded.read(0, 1217 + i)), 0xff];
function fixture() {
  const first = new Dos33Disk(bytes, { writable: true }), second = new Dos33Disk(bytes);
  const set = new Apple2DiskSet(); set.add([{ name: "game.dsk", disk: first }, { name: "game.dsk", disk: second }]);
  const session = createApple2Session(null, { bootstrap: [...bootstrap], image: first });
  return { first, second, set, session };
}
async function capture(set: Apple2DiskSet, session: ReturnType<typeof createApple2Session>) {
  const mounted = session.machine.disk.medium;
  const result = await encodeApple2SavedState({ machine: "apple2-plus", name: "Disk set", savedAt: "2026-11-08T00:00:00Z",
    diskName: set.entries.find(entry => entry.disk === mounted)?.name ?? null,
    flash: false, state: session.snapshot(), diskSet: set.snapshot(mounted) });
  assert.equal(result.version, 6);
  return result;
}

test("swapping, ejection and power-on retain each disk's edits independently of filenames", () => {
  const { session, set, first, second } = fixture();
  first.writeDataField(0, 1210, frame);
  session.machine.ram.write(0x1234, 42); session.send([27]);
  const before = session.snapshot();
  session.swapDisk(second);
  assert.deepEqual({ ...session.snapshot(), hardware: { ...session.snapshot().hardware, disk: before.hardware.disk } }, before);
  assert.deepEqual(first.exportImage(), changed); assert.deepEqual(second.exportImage(), bytes);
  assert.throws(() => set.remove(set.entries[1]!, session.machine.disk.medium), /Eject/);
  session.eject(); assert.equal(set.entries.length, 2);
  session.swapDisk(first); session.powerOn();
  assert.equal(session.machine.disk.medium, first, "Fresh hardware borrows the same owned medium");
  assert.deepEqual(session.machine.disk.exportImage(), changed);
  const replacement = createApple2Session(null, { bootstrap: [...bootstrap], image: second });
  assert.equal(replacement.machine.disk.medium, second); assert.equal(set.entries[0]!.disk, first);
  assert.deepEqual(first.exportImage(), changed);
});

test("checkpoints retain unmounted edits and write permission, with one copy of the mounted image", async () => {
  const { session, set, first, second } = fixture();
  first.writeDataField(0, 1210, frame); session.swapDisk(second);
  const saved = await capture(set, session);
  assert.equal(saved.diskSet.mounted, 1);
  assert.equal(saved.diskSet.disks[1]!.base64, null); assert.equal(saved.diskSet.disks[1]!.sha256, null);
  assert.equal(saved.diskSet.disks[0]!.sha256, hash(changed));
  assert.equal(saved.diskSet.disks[0]!.base64!.length, Math.ceil(Dos33Disk.size / 3) * 4);
  // Serialized restoration constructs independent media and connects the mounted
  // entry directly to the restored controller, without reinsertion or reset.
  const restored = await prepareApple2SavedState(JSON.parse(JSON.stringify(saved)), null, media);
  assert.deepEqual(restored.session.snapshot(), saved.state);
  assert.equal(restored.diskSet.entries[1]!.disk, restored.session.machine.disk.medium);
  assert.deepEqual(restored.diskSet.entries.map(entry => [entry.name, entry.disk.writable]), [["game.dsk", true], ["game.dsk", false]]);
  assert.notEqual(restored.diskSet.entries[0]!.disk, first);
  restored.session.swapDisk(restored.diskSet.entries[0]!.disk);
  assert.deepEqual(restored.session.machine.disk.exportImage(), changed);
  assert.equal(restored.session.machine.disk.inspect().writable, true);
  assert.deepEqual(second.exportImage(), bytes);
});

test("a restored set shares the mounted pending-write medium and records its completed sector", async () => {
  const { session, set } = fixture(), drive = session.machine.disk;
  drive.read(9); drive.advanceCpuClocks(1210 * 32); drive.read(13);
  drive.write(15, frame[0]!); drive.read(12); drive.advanceCpuClocks(32);
  const shift = (card: typeof drive, data: readonly number[]) => {
    for (const byte of data) { card.write(13, byte); card.read(12); card.advanceCpuClocks(32); }
  };
  shift(drive, frame.slice(1, 170));
  const saved = await capture(set, session), restored = await prepareApple2SavedState(saved, null, media);
  assert.deepEqual(restored.session.snapshot(), session.snapshot());
  shift(restored.session.machine.disk, frame.slice(170)); restored.session.machine.disk.read(14);
  assert.deepEqual(restored.diskSet.entries[0]!.disk.exportImage(), changed);
  assert.deepEqual(session.machine.disk.exportImage(), bytes, "Restoration cannot change the original in-flight write");
});

test("empty-drive and old single-disk checkpoints restore usable sets", async () => {
  const { session, set, first } = fixture(); session.eject();
  const saved = await capture(set, session), restored = await prepareApple2SavedState(saved, null, media);
  assert.equal(saved.diskSet.mounted, null); assert.equal(restored.session.machine.disk.medium, null);
  assert.equal(restored.diskSet.entries.length, 2);
  restored.session.swapDisk(restored.diskSet.entries[0]!.disk);
  assert.deepEqual(restored.session.machine.disk.exportImage(), bytes);
  session.swapDisk(first);
  const current = await capture(set, session), { diskSet: omitted, ...envelope } = current;
  const legacy = await prepareApple2SavedState({ ...envelope, version: 5 }, null, media);
  assert.equal(legacy.diskSet.entries.length, 1);
  assert.equal(legacy.diskSet.entries[0]!.disk, legacy.session.machine.disk.medium);
  const empty = await capture(new Apple2DiskSet(), createApple2Session());
  assert.equal((await prepareApple2SavedState(empty, null, media)).diskSet.entries.length, 0);
});

test("damaged disk sets reject the entire restoration without altering current hardware or retained media", async () => {
  const { session, set } = fixture(); const saved = await capture(set, session), before = session.snapshot();
  const alterSet = (patch: Record<string, unknown>) => ({ ...saved, diskSet: { ...saved.diskSet, ...patch } });
  const alterEntry = (index: number, patch: Record<string, unknown>) => alterSet({ disks:
    saved.diskSet.disks.map((entry, i) => i === index ? { ...entry, ...patch } : entry) });
  const corruptions: unknown[] = [
    alterSet({ mounted: null }), alterSet({ mounted: 2 }), alterSet({ mounted: 0.5 }),
    alterEntry(0, { name: "different" }), alterEntry(0, { writable: false }), alterEntry(0, { base64: "" }),
    alterEntry(1, { writable: "false" }), alterEntry(1, { name: "" }),
    alterEntry(1, { base64: "!".repeat(saved.diskSet.disks[1]!.base64!.length) }),
    alterEntry(1, { base64: saved.diskSet.disks[1]!.base64!.slice(4) }), alterEntry(1, { sha256: "f".repeat(64) }),
    alterSet({ disks: [...saved.diskSet.disks, ...Array(16).fill(saved.diskSet.disks[1])] }), alterSet({ extra: 1 }),
  ];
  for (const value of corruptions) {
    await assert.rejects(prepareApple2SavedState(value as Apple2SavedState, null, media));
    assert.deepEqual(session.snapshot(), before); assert.equal(set.entries.length, 2);
    assert.deepEqual(set.entries[1]!.disk.exportImage(), bytes);
  }
});

test("disk set additions are atomic, bounded, and cannot silently replace same-named disks", () => {
  const { set, first, second } = fixture(), before = set.entries;
  assert.throws(() => set.add([{ name: "valid", disk: new Dos33Disk(bytes) }, { name: "", disk: second }]), /filename/);
  assert.equal(set.entries, before);
  assert.throws(() => set.add([{ name: "another", disk: first }]), /already/);
  assert.equal(set.entries, before);
  assert.throws(() => set.snapshot(new Dos33Disk(bytes)), /missing/);
  set.remove(before[1]!, first); assert.equal(set.entries.length, 1);
  assert.throws(() => set.remove(before[1]!, first), /no longer/);
  set.add(Array.from({ length: 15 }, () => ({ name: "same.dsk", disk: new Dos33Disk(bytes) })));
  const full = set.entries;
  assert.throws(() => set.add([{ name: "overflow", disk: second }]), /16/);
  assert.equal(set.entries, full); assert.ok(Object.isFrozen(set.entries)); assert.ok(Object.isFrozen(set.entries[0]));
});
