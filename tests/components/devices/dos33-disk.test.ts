import assert from "node:assert/strict";
import { test } from "node:test";
import { Dos33Disk } from "../../../src/components/devices/dos33-disk.js";

const slice = (disk: Dos33Disk, track: number, start: number, length: number) =>
  Array.from({ length }, (_, i) => disk.read(track, start + i));

test("DOS-order tracks have independent address, sector-order, and 6-and-2 check vectors", () => {
  const bytes = new Uint8Array(Dos33Disk.size);
  // Each DOS file sector has a distinct high-six-bit value, with zero low pairs.
  for (let track = 0; track < 35; track++) for (let sector = 0; sector < 16; sector++) {
    bytes.fill(sector * 4, (track * 16 + sector) * 256, (track * 16 + sector + 1) * 256);
  }
  const disk = new Dos33Disk(bytes);
  assert.equal(disk.trackLength(0), 6162);
  assert.equal(disk.trackLength(34), 6162);
  assert.deepEqual(slice(disk, 0, 0, 48), new Array(48).fill(0xff));
  assert.deepEqual(slice(disk, 0, 48, 14), [0xd5, 0xaa, 0x96, 0xff, 0xfe, 0xaa, 0xaa, 0xaa, 0xaa, 0xff, 0xfe, 0xde, 0xaa, 0xeb]);
  assert.deepEqual(slice(disk, 34, 48, 14), [0xd5, 0xaa, 0x96, 0xff, 0xfe, 0xbb, 0xaa, 0xaa, 0xaa, 0xee, 0xfe, 0xde, 0xaa, 0xeb]);
  // DOS file sectors 0,7,14,6,... in physical address-field order, translated to disk bytes.
  // Values are explicit expectations, not obtained from the encoder or an inverse decoder.
  const firstMain = [0x96, 0xa6, 0xb2, 0x9f, 0xaf, 0x9e, 0xae, 0x9d, 0xad, 0x9b, 0xac, 0x9a, 0xab, 0x97, 0xa7, 0xb3];
  for (let sector = 0; sector < 16; sector++) {
    const data = 71 + sector * 383;
    assert.deepEqual(slice(disk, 17, data - 3, 3), [0xd5, 0xaa, 0xad]);
    assert.deepEqual(slice(disk, 17, data, 86), new Array(86).fill(0x96));
    assert.equal(disk.read(17, data + 86), firstMain[sector]);
    assert.deepEqual(slice(disk, 17, data + 87, 255), new Array(255).fill(0x96));
    assert.equal(disk.read(17, data + 342), firstMain[sector], "Chained checksum");
    assert.deepEqual(slice(disk, 17, data + 343, 3), [0xde, 0xaa, 0xeb]);
  }
});

test("6-and-2 packs reversed low pairs, including the two shortened auxiliary groups", () => {
  const bytes = new Uint8Array(Dos33Disk.size).fill(0xff);
  const full = new Dos33Disk(bytes), data = slice(full, 0, 71, 343);
  const expected = new Array(343).fill(0x96);
  expected[0] = expected[342] = 0xff; // Auxiliary/main value 63 and final checksum.
  expected[84] = expected[86] = 0xed; // Last two auxiliaries hold only two low pairs: 15.
  assert.deepEqual(data, expected);
  bytes.fill(0); bytes[0] = 1; bytes[86] = 2; bytes[172] = 3;
  // Reversed pairs 2,1,3 occupy bits 1:0,3:2,5:4: 0b110110 = 54 -> F5.
  const sparse = new Dos33Disk(bytes), lowPairs = new Array(343).fill(0x96);
  lowPairs[0] = lowPairs[1] = 0xf5;
  assert.deepEqual(slice(sparse, 0, 71, 343), lowPairs);
  bytes.fill(0); bytes[255] = 1;
  const last = new Dos33Disk(bytes), lastPair = new Array(343).fill(0x96);
  lastPair[83] = lastPair[84] = 0xd6; // Third pair in auxiliary 83: 32 -> D6.
  assert.deepEqual(slice(last, 0, 71, 343), lastPair);
});

test("disk input is validated, owned, immutable, and bounded", () => {
  const bytes = new Uint8Array(Dos33Disk.size), disk = new Dos33Disk(bytes);
  bytes.fill(255);
  assert.equal(disk.snapshot()[0], 0);
  assert.equal(Object.isFrozen(disk.snapshot()), true);
  assert.throws(() => { (disk.snapshot() as number[])[0] = 1; });
  for (const bad of [new Uint8Array(0), new Array(Dos33Disk.size), new Array(Dos33Disk.size).fill(256)]) assert.throws(() => new Dos33Disk(bad));
  for (const track of [-1, 35, 0.5, NaN]) assert.throws(() => disk.read(track, 0));
  for (const position of [-1, 6162, 0.5, NaN]) assert.throws(() => disk.read(0, position));
});
