import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectDos33Track } from "../../site/interactive/dos33-track.js";
import { Apple2DiskII } from "../../src/components/devices/apple2-disk-ii.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";

// Independent field: volume 254, track 18, physical sector 3 (DOS sector 6).
const address = [0xd5, 0xaa, 0x96, 0xff, 0xfe, 0xab, 0xba, 0xab, 0xab, 0xff, 0xef, 0xde, 0xaa, 0xeb];
// Low pairs of bytes 0=1, 86=2, 172=3 pack to 54. XOR chaining emits F5 twice.
const values = [0xf5, 0xf5, ...new Array<number>(341).fill(0x96)];
const stream = [0xff, ...address, 0xff, 0xff, 0xd5, 0xaa, 0xad, ...values, 0xde, 0xaa, 0xeb];

test("encoded inspection locates fields, decodes 4-and-4 and checks independent 6-and-2 bytes", () => {
  const expected = new Array<number>(256).fill(0);
  expected[0] = 1; expected[86] = 2; expected[172] = 3;
  assert.deepEqual(inspectDos33Track(Object.freeze(stream)), [{ addressOffset: 1, volume: 254, track: 18,
    physicalSector: 3, sector: 6, checksum: 239, addressValid: true, dataOffset: 17, bytes: expected }]);
  // Literal all-FF vector, including the two shortened auxiliary groups.
  const full = new Array<number>(343).fill(0x96);
  full[0] = full[342] = 0xff; full[84] = full[86] = 0xed;
  assert.deepEqual(inspectDos33Track([...address, 0xd5, 0xaa, 0xad, ...full, 0xde, 0xaa, 0xeb])[0]!.bytes,
    new Array(256).fill(255));
});

test("invalid address, translation, checksum, epilogue, and truncated fields are not accepted", () => {
  for (const offset of [4, 10, 12]) {
    const bad = [...stream]; bad[offset] = 0;
    assert.equal(inspectDos33Track(bad)[0]!.addressValid, false);
  }
  for (const offset of [20, 362, 363]) {
    const bad = [...stream]; bad[offset] = offset === 362 ? 0x97 : 0;
    assert.equal(inspectDos33Track(bad)[0]!.bytes, undefined);
  }
  assert.equal(inspectDos33Track(stream.slice(0, -1))[0]!.bytes, undefined);
  assert.equal(inspectDos33Track(stream.slice(0, 14))[0]!.addressValid, false);
  assert.equal(inspectDos33Track(address)[0]!.dataOffset, undefined);
  assert.deepEqual(inspectDos33Track([0xff, 0xd5]), []);
  // A missing data field cannot borrow the next sector's data field.
  const two = inspectDos33Track([...address, ...stream]);
  assert.equal(two[0]!.dataOffset, undefined);
  assert.equal(two[1]!.bytes?.length, 256);
});

test("all track sectors map to DOS order and inspection preserves the controller and older snapshots", () => {
  const image = Uint8Array.from({ length: Dos33Disk.size }, (_, i) => (i >>> 8) + i);
  const medium = new Dos33Disk(image, { writable: true }), disk = new Apple2DiskII();
  disk.install(new Uint8Array(256)); disk.insert(medium);
  disk.read(9); disk.read(12); // A running motor with an already consumed byte.
  const before = disk.snapshot(), captured = disk.inspectMedium()!.inspectTrack(18);
  const fields = inspectDos33Track(captured);
  assert.deepEqual(fields.map(field => field.sector), [0, 7, 14, 6, 13, 5, 12, 4, 11, 3, 10, 2, 9, 1, 8, 15]);
  for (const field of fields) {
    assert.ok(field.addressValid);
    assert.equal(field.track, 18);
    assert.deepEqual(field.bytes, [...image.slice((18 * 16 + field.sector!) * 256, (18 * 16 + field.sector! + 1) * 256)]);
  }
  assert.deepEqual(disk.snapshot(), before);
  assert.ok(Object.isFrozen(captured));
  assert.throws(() => { (captured as number[])[0] = 0; });
  for (const track of [-1, 35, 0.5, NaN]) assert.throws(() => medium.inspectTrack(track));
  const old = fields[3]!.bytes;
  medium.writeDataField(18, 1210, stream.slice(17));
  assert.deepEqual(inspectDos33Track(captured)[3]!.bytes, old);
  const updated = inspectDos33Track(medium.inspectTrack(18))[3]!.bytes;
  assert.notDeepEqual(updated, old);
  assert.deepEqual(updated, inspectDos33Track(stream)[0]!.bytes);
});
