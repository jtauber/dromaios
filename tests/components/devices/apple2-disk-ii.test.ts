import assert from "node:assert/strict";
import { test } from "node:test";
import { Apple2DiskII } from "../../../src/components/devices/apple2-disk-ii.js";
import { Dos33Disk } from "../../../src/components/devices/dos33-disk.js";

const media = new Dos33Disk(new Uint8Array(Dos33Disk.size));
function card(): Apple2DiskII {
  const disk = new Apple2DiskII();
  disk.install(new Uint8Array(256).fill(0xa5)); disk.insert(media);
  return disk;
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

test("Disk II streams circular bytes only with motor, drive 1, media, and read mode", () => {
  const disk = card();
  assert.equal(disk.read(12), 0); assert.equal(disk.inspect().position, 0);
  disk.write(9, 0); // Writes select switches too.
  for (let position = 0; position < 6163; position++) assert.equal(disk.read(12), media.read(0, position % 6162));
  assert.equal(disk.inspect().position, 1);
  assert.equal(disk.read(0), 0xff); // Even addresses sample the latch without advancing this profile.
  assert.equal(disk.read(1), 0); // Odd addresses leave the bus undriven (modeled as zero).
  disk.read(11); assert.equal(disk.read(12), 0);
  disk.read(3); assert.equal(disk.inspect().halfTrack, 0, "Absent drive 2 does not move drive 1");
  assert.equal(disk.inspect().position, 1);
  disk.read(10); assert.equal(disk.read(12), 0xff);
  disk.read(8); assert.equal(disk.read(12), 0); assert.equal(disk.inspect().position, 2);
  disk.read(9); disk.eject(); assert.equal(disk.read(12), 0);
  assert.equal(disk.inspect().position, 0);
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
  disk.read(14); assert.equal(disk.read(12), 0xff);
  assert.deepEqual(disk.snapshot().media, original);
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
  disk.read(12);
  const saved = disk.snapshot(), resumed = new Apple2DiskII(saved);
  disk.inspect(); disk.reset(); assert.deepEqual(disk.snapshot(), saved);
  for (let i = 0; i < 100; i++) assert.equal(disk.read(12), resumed.read(12));
  assert.deepEqual(disk.snapshot(), resumed.snapshot());
  disk.insert(media); assert.equal(disk.inspect().position, 0); assert.equal(disk.inspect().halfTrack, 68);
  assert.equal(resumed.inspect().position, 101);
  for (const patch of [{ phase: 4 }, { halfTrack: 69 }, { drive: 0 }, { position: 6162 }, { motor: 1 }, { latch: 256 }, { extra: true }, { media: null, position: 1 }]) {
    assert.throws(() => new Apple2DiskII({ ...saved, ...patch } as never));
  }
});
