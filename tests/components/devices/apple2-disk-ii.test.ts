import assert from "node:assert/strict";
import { test } from "node:test";
import { Apple2DiskII } from "../../../src/components/devices/apple2-disk-ii.js";
import type { DiskIITransfer } from "../../../src/components/devices/apple2-disk-ii.js";
import { Dos33Disk } from "../../../src/components/devices/dos33-disk.js";
import type { Dos33SectorWrite } from "../../../src/components/devices/dos33-disk.js";

const media = new Dos33Disk(new Uint8Array(Dos33Disk.size));
function card(): Apple2DiskII {
  const disk = new Apple2DiskII();
  disk.install(new Uint8Array(256).fill(0xa5)); disk.insert(media);
  return disk;
}

function readByte(disk: Apple2DiskII): number | "bus-error" {
  disk.advanceCpuClocks(32);
  return disk.read(12);
}

test("Disk II exposes only installed switches and bootstrap; invalid accesses have no effects", () => {
  const absent = new Apple2DiskII();
  for (const address of [0, 9, 12, 0x100, 0x1ff]) assert.equal(absent.read(address), "bus-error");
  assert.equal(absent.write(9, 0), "bus-error");
  assert.equal(absent.inspect().motor, false);
  const disk = card(), before = disk.snapshot();
  assert.equal(disk.read(0x100), 0xa5); assert.equal(disk.read(0x1ff), 0xa5);
  for (const address of [16, 0xff]) assert.equal(disk.read(address), "bus-error");
  assert.equal(disk.write(0x100, 0), "bus-error");
  for (const address of [-1, 512, 1.5, NaN]) assert.throws(() => disk.read(address));
  for (const byte of [-1, 256, 1.5, NaN]) assert.throws(() => disk.write(9, byte));
  for (const bytes of [new Uint8Array(255), new Array(256), new Array(256).fill(256)]) assert.throws(() => disk.install(bytes));
  assert.deepEqual(disk.snapshot(), before);
});

test("Disk II rotates circular bytes only with motor, drive 1 and media, independently of polling", () => {
  const disk = card();
  assert.equal(disk.read(12), 0); assert.equal(disk.inspect().position, 0);
  disk.write(9, 0); // Writes select switches too.
  for (let position = 0; position < 6163; position++) assert.equal(readByte(disk), media.read(0, position % 6162));
  assert.equal(disk.inspect().position, 1);
  assert.equal(disk.read(0), 0xff); // Even addresses sample the latch without advancing this profile.
  assert.equal(disk.read(1), 0); // Odd addresses leave the bus undriven (modeled as zero).
  disk.read(11); assert.equal(disk.read(12), 0);
  disk.read(3); assert.equal(disk.inspect().halfTrack, 0, "Absent drive 2 does not move drive 1");
  assert.equal(disk.inspect().position, 1);
  disk.read(10); assert.equal(readByte(disk), 0xff);
  disk.read(8); assert.equal(disk.read(12), 0); assert.equal(disk.inspect().position, 2);
  disk.read(9); disk.eject(); assert.equal(disk.read(12), 0);
  assert.equal(disk.inspect().position, 0);
});

test("transfer observers report only actual stream advances and preserve emulation and snapshot state", () => {
  const disk = card(), baseline = new Apple2DiskII(disk.snapshot()), events: DiskIITransfer[] = [];
  const stop = disk.observeTransfers(event => events.push(event));
  const read = (address: number) => {
    if (address === 12) { disk.advanceCpuClocks(32); baseline.advanceCpuClocks(32); }
    assert.equal(disk.read(address), baseline.read(address));
  };
  for (const address of [12, 0, 13, 14, 0x100, 9, 11, 12, 10, 12]) read(address);
  assert.deepEqual(events, [{ kind: "read", halfTrack: 0, track: 0, position: 0, length: 6162, value: 0xff }]);
  assert.ok(Object.isFrozen(events[0]));
  for (let i = 0; i < 6162; i++) read(12);
  assert.equal(events.at(-2)!.position, 6161); assert.equal(events.at(-1)!.position, 0);
  assert.deepEqual(disk.snapshot(), baseline.snapshot());
  const count = events.length;
  disk.inspect(); disk.inspectMedium()!.inspectTrack(0); disk.snapshot(); disk.reset();
  assert.equal(events.length, count);
  stop(); read(12); assert.equal(events.length, count);
  assert.deepEqual(disk.snapshot(), baseline.snapshot());
});

test("Disk II declares read-only media through the actual DOS write-protect sense sequence", () => {
  const disk = card(), original = disk.snapshot().media;
  disk.read(9);
  assert.equal(disk.read(13), 0); // RWTS: LDA C08D,X selects Q6 high; odd bus is undriven.
  assert.equal(disk.read(14), 0x80); // LDA C08E,X selects read mode and samples protection.
  disk.write(15, 0x5a); // Both Q6/Q7 high load the write latch.
  assert.equal(disk.read(0), 0x5a);
  disk.write(12, 0xff); // Write mode never emits onto the protected medium.
  assert.equal(disk.read(12), 0x5a); assert.equal(disk.inspect().position, 0);
  disk.read(14); assert.equal(readByte(disk), 0xff);
  assert.deepEqual(disk.snapshot().media, original);
});

// A second canonical track supplies the transferred GCR bytes. The DOS-backed test
// independently gets those bytes from RWTS's 6502 encoder.
const sectorSix = Uint8Array.from({ length: 256 }, (_, i) => 255 - i);
const frame = (() => {
  const source = new Uint8Array(Dos33Disk.size);
  source.set(sectorSix, 6 * 256);
  const disk = new Dos33Disk(source);
  return [0xff, ...Array.from({ length: 349 }, (_, i) => disk.read(0, 1217 + i)), 0xff];
})();

function startWrite(position = 1210): Apple2DiskII {
  const disk = card();
  disk.insert(new Dos33Disk(new Uint8Array(Dos33Disk.size), { writable: true }));
  disk.read(9);
  for (let i = 0; i < position; i++) readByte(disk);
  disk.read(13); assert.equal(disk.read(14), 0); // Writable drive 1.
  disk.write(15, frame[0]!); disk.read(12); disk.advanceCpuClocks(32);
  return disk;
}

function shift(disk: Apple2DiskII, bytes: readonly number[]): void {
  for (const byte of bytes) { disk.write(13, byte); disk.read(12); disk.advanceCpuClocks(32); }
}

test("write observers capture immutable DOS-order sectors on commit, including identical rewrites", () => {
  const medium = new Dos33Disk(new Uint8Array(Dos33Disk.size), { writable: true });
  const writes: Dos33SectorWrite[] = [];
  const stop = medium.observeWrites(write => writes.push(write));
  medium.writeDataField(0, 1210, frame.slice(0, 100));
  medium.writeDataField(0, 1210, frame);
  medium.writeDataField(0, 1210, frame);
  stop(); medium.writeDataField(0, 1210, frame);
  assert.equal(writes.length, 2);
  for (const write of writes) {
    assert.deepEqual(write, { track: 0, sector: 6, bytes: [...sectorSix] });
    assert.ok(Object.isFrozen(write.bytes));
  }
});

test("Disk II restores between latch load and shift and publishes a complete sector on return to read mode", () => {
  const disk = startWrite();
  shift(disk, frame.slice(1, 170)); disk.write(13, frame[170]!);
  const saved = disk.snapshot(), restored = new Apple2DiskII(saved);
  for (const card of [disk, restored]) {
    card.read(12); card.advanceCpuClocks(32); shift(card, frame.slice(171));
    assert.deepEqual(card.exportImage(), new Uint8Array(Dos33Disk.size));
    card.read(14);
    const expected = new Uint8Array(Dos33Disk.size);
    expected.set(sectorSix, 6 * 256);
    const exported = card.exportImage();
    assert.deepEqual(exported, expected);
    exported.fill(0); assert.deepEqual(card.exportImage(), expected);
  }
  assert.deepEqual(disk.snapshot(), restored.snapshot());
  assert.equal(saved.media![6 * 256], 0, "An earlier snapshot still describes the original sector");
  assert.throws(() => new Apple2DiskII({ ...saved, writable: false }));
});

test("partial, invalid, misplaced and interrupted Disk II writes leave every exported byte intact", () => {
  const badCode = frame.slice(), badChecksum = frame.slice(), badEnd = frame.slice();
  badCode[16] = 0; badChecksum[346] = frame[346] === 0x96 ? 0x97 : 0x96; badEnd[349] = 0;
  for (const bytes of [frame.slice(0, 30), badCode, badChecksum, badEnd, [...frame, ...new Array<number>(400).fill(0xff)]]) {
    const disk = startWrite(); shift(disk, bytes.slice(1)); disk.read(14);
    assert.deepEqual(disk.exportImage(), new Uint8Array(Dos33Disk.size));
  }
  const misplaced = startWrite(10); shift(misplaced, frame.slice(1)); misplaced.read(14);
  assert.deepEqual(misplaced.exportImage(), new Uint8Array(Dos33Disk.size));
  for (const interrupt of [8, 11, 3]) { // Motor off, absent drive 2, head movement.
    const disk = startWrite(); shift(disk, frame.slice(1, 60)); disk.read(interrupt);
    shift(disk, frame.slice(60)); disk.read(14);
    assert.deepEqual(disk.exportImage(), new Uint8Array(Dos33Disk.size));
  }
});

test("Disk II stepping, inspection, reset, restoration, and replacement preserve their declared state", () => {
  const disk = card();
  disk.read(3); assert.equal(disk.inspect().halfTrack, 0, "Motor is off");
  disk.read(9);
  for (const address of [3, 5, 7, 1]) disk.read(address);
  assert.equal(disk.inspect().halfTrack, 4);
  disk.read(7); disk.read(5); assert.equal(disk.inspect().halfTrack, 2);
  disk.read(4); assert.equal(disk.inspect().halfTrack, 2, "Phase-off has no motion in this approximation");
  for (let i = 0; i < 40; i++) for (const address of [3, 1, 7, 5]) disk.read(address);
  assert.equal(disk.inspect().halfTrack, 0);
  for (let i = 0; i < 40; i++) for (const address of [7, 1, 3, 5]) disk.read(address);
  assert.equal(disk.inspect().halfTrack, 68);
  readByte(disk);
  const saved = disk.snapshot(), resumed = new Apple2DiskII(saved);
  disk.inspect(); disk.reset(); assert.deepEqual(disk.snapshot(), saved);
  for (let i = 0; i < 100; i++) assert.equal(readByte(disk), readByte(resumed));
  assert.deepEqual(disk.snapshot(), resumed.snapshot());
  disk.insert(media); assert.equal(disk.inspect().position, 0); assert.equal(disk.inspect().halfTrack, 68);
  assert.equal(resumed.inspect().position, 101);
  for (const patch of [{ phase: 4 }, { halfTrack: 69 }, { drive: 0 }, { position: 6162 }, { motor: 1 }, { latch: 256 }, { extra: true }, { byteClocks: 32 }, { byteClocks: -1 }, { writeStart: 0 }, { media: null, position: 1 }]) {
    assert.throws(() => new Apple2DiskII({ ...saved, ...patch } as never));
  }
});

test("rotation, byte readiness and missed bytes depend on elapsed clocks, never on polling", () => {
  const disk = card(), idle = new Apple2DiskII(disk.snapshot());
  for (const d of [disk, idle]) d.read(9);
  disk.advanceCpuClocks(31); idle.advanceCpuClocks(31);
  const waiting = disk.snapshot();
  for (let i = 0; i < 100; i++) assert.equal(disk.read(12), 0);
  assert.deepEqual(disk.snapshot(), waiting);
  disk.advanceCpuClocks(1); idle.advanceCpuClocks(1);
  assert.equal(disk.inspect().position, 1); assert.equal(disk.inspect().byteClocks, 0);
  assert.equal(disk.read(12), 0xff); assert.equal(disk.read(12), 0xff, "A CPU read does not clear the latch");
  assert.deepEqual(disk.snapshot(), idle.snapshot());
  disk.advanceCpuClocks(7); assert.equal(disk.read(12), 0xff);
  disk.advanceCpuClocks(1); assert.equal(disk.read(12), 0, "The modeled valid-byte window lasts eight clocks");
  disk.advanceCpuClocks(24 + 47 * 32); // Bytes pass even though no disk read occurs.
  assert.equal(disk.inspect().position, 49);
  assert.equal(disk.read(12), 0xd5, "The latest byte at position 48 replaces unread earlier bytes");
  disk.advanceCpuClocks(6162 * 32);
  assert.equal(disk.inspect().position, 49); assert.equal(disk.read(12), 0xd5);
});

test("rotation phase survives batching, motor stop and checkpoints; invalid elapsed clocks have no effect", () => {
  const disk = card(); disk.read(9); disk.advanceCpuClocks(53);
  const saved = disk.snapshot(), batched = new Apple2DiskII(saved), stepped = new Apple2DiskII(saved);
  batched.advanceCpuClocks(12345);
  for (let i = 0; i < 12345; i++) { stepped.advanceCpuClocks(1); stepped.read(12); }
  assert.deepEqual(stepped.snapshot(), batched.snapshot());
  disk.read(8); const stopped = disk.snapshot(); disk.advanceCpuClocks(9999); disk.reset();
  assert.deepEqual(disk.snapshot(), stopped);
  disk.read(9); disk.advanceCpuClocks(11); assert.equal(disk.inspect().position, 2);
  disk.read(11); const absent = disk.snapshot(); disk.advanceCpuClocks(320); assert.deepEqual(disk.snapshot(), absent);
  disk.read(10); disk.read(13); disk.advanceCpuClocks(64);
  assert.equal(disk.inspect().position, 4, "Sensing write protection does not stop the disk");
  const before = disk.snapshot();
  for (const clocks of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => disk.advanceCpuClocks(clocks));
  disk.advanceCpuClocks(0); assert.deepEqual(disk.snapshot(), before);
  assert.equal(saved.byteClocks, 21);
  disk.insert(media); assert.equal(disk.inspect().byteClocks, 0);
});
