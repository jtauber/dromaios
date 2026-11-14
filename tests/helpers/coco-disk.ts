import assert from "node:assert/strict";

// Independent inspection of the exported file, never a shortcut for loading RAM.
export function cocoBinaryFile(image: Uint8Array, name: string) {
  assert.equal(image.length, 161_280);
  assert.equal(name.length, 11, "padded eight-character name and three-character extension");
  const directory = (17 * 18 + 2) * 256, fat = (17 * 18 + 1) * 256;
  const entry = Array.from({ length: 72 }, (_, i) => directory + i * 32)
    .find(offset => Buffer.from(image.slice(offset, offset + 11)).toString("ascii") === name);
  assert.ok(entry !== undefined, `Missing disk file ${name}.`);
  assert.deepEqual([...image.slice(entry + 11, entry + 13)], [2, 0], "machine language, binary");
  const finalBytes = image[entry + 14]! * 256 + image[entry + 15]!;
  assert.ok(finalBytes >= 1 && finalBytes <= 256);
  const granules: number[] = [], sectors: number[] = [], bytes: number[] = [];
  let granule = image[entry + 13]!;
  for (;;) {
    assert.ok(granule < 68 && !granules.includes(granule), "allocated, non-cyclic FAT chain");
    granules.push(granule);
    const next = image[fat + granule]!, last = next >= 0xc0;
    const count = last ? next - 0xc0 : 9;
    assert.ok(count >= 1 && count <= 9);
    // Two nine-sector granules per track, omitting directory/FAT track 17.
    const track = (granule >> 1) + (granule >= 34 ? 1 : 0), first = track * 18 + (granule % 2) * 9;
    for (let i = 0; i < count; i++) {
      const sector = first + i; sectors.push(sector);
      bytes.push(...image.slice(sector * 256, sector * 256 + (last && i === count - 1 ? finalBytes : 256)));
    }
    if (last) return { granules, sectors, bytes, finalBytes };
    granule = next;
  }
}
