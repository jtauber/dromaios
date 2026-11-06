import assert from "node:assert/strict";
import { test } from "node:test";
import { createDos33StreamInspector } from "../../site/interactive/dos33-stream.js";
import { dos33HeadWindow, inspectDos33Track } from "../../site/interactive/dos33-track.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import type { DiskIITransfer } from "../../src/components/devices/apple2-disk-ii.js";

// Volume 254, track 18, physical sector 3: checksum FE XOR 12 XOR 03 = EF.
const address = [0xd5, 0xaa, 0x96, 0xff, 0xfe, 0xab, 0xba, 0xab, 0xab, 0xff, 0xef, 0xde, 0xaa];
// Independent sparse vector: reversed low pairs 2,1,3 pack to 54, translated F5.
const data = [0xd5, 0xaa, 0xad, 0xf5, 0xf5, ...new Array<number>(341).fill(0x96)];
function reader() {
  const stream = createDos33StreamInspector(); let number = 0, position = 100;
  return { stream, byte(value: number, changes: Partial<DiskIITransfer> = {}) {
    return stream.consume({ kind: "read", track: 18, halfTrack: 36, length: 6162, position: position++, value, number: ++number, ...changes });
  }, bytes(bytes: readonly number[]) { return bytes.map(value => this.byte(value)).filter(value => value !== undefined); } };
}

test("stream verification requires observed address/checksum bytes, but no unread epilogue", () => {
  const read = reader();
  assert.deepEqual(read.bytes(address.slice(0, -1)), []);
  assert.deepEqual(read.byte(0xaa), { kind: "address", track: 18, physicalSector: 3, sector: 6, first: 1, last: 13, valid: true });
  read.bytes([0xeb, 0xff, 0xff]);
  assert.deepEqual(read.bytes(data.slice(0, -1)), [], "No data success before the checksum is consumed");
  const field = read.byte(0x96)!;
  const expected = new Array<number>(256).fill(0); expected[0] = 1; expected[86] = 2; expected[172] = 3;
  assert.deepEqual(field, { kind: "data", track: 18, physicalSector: 3, sector: 6, first: 17, last: 362, valid: true, bytes: expected });
  assert.ok(Object.isFrozen(field.bytes));
  assert.deepEqual(read.bytes([0xde, 0xaa, 0xeb]), [], "An epilogue does not count the field twice");
});

test("bad checksums and partial or discontinuous reads never become verified sectors", () => {
  const badAddress = [...address]; badAddress[10] = badAddress[10]! ^ 1;
  const a = reader(); assert.equal(a.bytes(badAddress)[0]!.valid, false); assert.deepEqual(a.bytes(data), []);
  for (const change of [{ position: 400 }, { halfTrack: 37 }, { kind: "write" as const }, { track: 19 }]) {
    const read = reader(); read.bytes(address); read.byte(0xff, change);
    assert.deepEqual(read.bytes(data), []);
  }
  for (const bad of [data.map((byte, i) => i === 15 ? 0 : byte), [...data.slice(0, -1), 0x97]]) {
    const read = reader(); read.bytes(address);
    assert.equal(read.bytes(bad)[0]!.valid, false);
  }
  const missed = reader(); missed.bytes(address.slice(3)); assert.deepEqual(missed.bytes(data), []);
  const stopped = reader(); stopped.bytes(address); stopped.stream.interrupt(); assert.deepEqual(stopped.bytes(data), []);
  const stale = reader(); stale.bytes(address); stale.bytes(new Array(384).fill(0xff)); assert.deepEqual(stale.bytes(data), []);
  const wrongTrack = reader();
  assert.equal(address.map(value => wrongTrack.byte(value, { track: 19 })).at(-1)!.valid, false);
});

test("consecutive circular positions can complete a field across the end of the stream", () => {
  const read = reader();
  const fields = address.map((value, i) => read.byte(value, { position: (6155 + i) % 6162 })).filter(value => value !== undefined);
  assert.equal(fields.length, 1); assert.equal(fields[0]!.valid, true);
});

test("the head window wraps, marks the next byte and distinguishes stored field regions", () => {
  const disk = new Dos33Disk(new Uint8Array(Dos33Disk.size)), track = disk.inspectTrack(18), fields = inspectDos33Track(track);
  const start = dos33HeadWindow(track, fields, 0);
  assert.equal(start[0]!.offset, 6130); assert.equal(start[32]!.offset, 0);
  assert.equal(start.filter(byte => byte.next).length, 1);
  for (const [position, part] of [[1197, "address"], [1217, "data"], [1562, "checksum"], [1215, "gap"]] as const) {
    const next = dos33HeadWindow(track, fields, position)[32]!;
    assert.deepEqual(next, { offset: position, value: track[position], next: true, part });
  }
});
