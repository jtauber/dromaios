import assert from "node:assert/strict";
import { test } from "node:test";
import { dos33Catalogue, dos33FileSectors } from "../../site/interactive/dos33-catalogue.js";

function example() {
  const bytes = new Array<number>(143360).fill(0);
  const put = (at: number, ...values: number[]) => bytes.splice(at, values.length, ...values);
  const vtoc = 0x11000, catalogue = 0x11c00, next = 0x08100, entry = next + 11;
  put(vtoc + 1, 17, 12); put(vtoc + 6, 254); put(vtoc + 0x34, 35, 16, 0, 1);
  put(catalogue + 1, 8, 1);
  for (let i = 11; i < 256; i += 35) put(catalogue + i, 255); // Deleted entries.
  put(entry, 12, 6, 0x82, ...Array.from("ANSWER".padEnd(30), c => c.charCodeAt(0) | 128), 5, 0);
  put(next + 81, 2, 7, 2); // Garbage after an unused slot is not a catalogue entry.
  put(0xc601, 3, 14); put(0xc60c, 12, 5); put(0xc610, 4, 10); // A hole at file sector 1.
  put(0x03e05, 122, 0); put(0x03e0c, 4, 2); put(0xc500, 12, 0);
  return bytes;
}

test("the VTOC, catalogue and chained lists preserve logical file numbers across holes", () => {
  const image = example(), before = [...image], volume = dos33Catalogue(image);
  assert.equal(volume.number, 254); assert.deepEqual(volume.sectors, [284, 129]);
  assert.deepEqual(volume.files, [{ name: "ANSWER", type: "A", locked: true, count: 5, entry: 0x0810b }]);
  const path = dos33FileSectors(image, volume.files[0]!);
  assert.deepEqual(path.map(r => [r.label, r.index]), [
    ["Catalogue entry", 129], ["T/S list", 198], ["File sector 0", 197],
    ["File sector 2", 74], ["T/S list", 62], ["File sector 122", 66],
  ]);
  assert.match(path[2]!.detail, /12 bytes/);
  assert.deepEqual(image, before);
});

test("the inspector accepts an empty list and rejects unsupported geometry, bad pointers and cycles", () => {
  assert.throws(() => dos33Catalogue([]), /35-track/);
  const bytes = example(), file = dos33Catalogue(bytes).files[0]!;
  bytes.fill(0, 0xc600, 0xc700);
  assert.deepEqual(dos33FileSectors(bytes, file).map(row => row.label), ["Catalogue entry", "T/S list"]);
  bytes[0xc601] = 12; bytes[0xc602] = 6;
  assert.throws(() => dos33FileSectors(bytes, file), /loops at T12 S6/);
  bytes[0xc60c] = 36; assert.throws(() => dos33FileSectors(bytes, file), /outside/);
  bytes[0x11c01] = 17; bytes[0x11c02] = 12;
  assert.throws(() => dos33Catalogue(bytes), /loops at T17 S12/);
});
