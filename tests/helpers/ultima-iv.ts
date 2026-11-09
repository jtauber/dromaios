import assert from "node:assert/strict";
import type { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import { dos33Catalogue, dos33FileSectors } from "../../site/interactive/dos33-catalogue.js";

/** A DOS binary payload, excluding its four-byte address/length header. */
export function ultima4Binary(disk: Dos33Disk, name: string): Uint8Array {
  const image = [...disk.exportImage()];
  const entry = dos33Catalogue(image).files.find(file => file.name === name);
  assert.ok(entry, `Missing ${name}`);
  const sectors = dos33FileSectors(image, entry).filter(sector => sector.fileSector !== undefined);
  const contents = Uint8Array.from(sectors.flatMap(sector => image.slice(sector.index * 256, (sector.index + 1) * 256)));
  return contents.slice(4, 4 + contents[2]! + 256 * contents[3]!);
}

export interface Ultima4SaveFile {
  readonly name: string;
  readonly address: number;
  readonly bytes: number;
  readonly track: number;
  readonly sectors: readonly number[];
}

/** Check every exported byte, including DOS's extra source byte after each declared payload. */
export function checkUltima4Save(original: Uint8Array, exported: Uint8Array,
  saved: readonly (Ultima4SaveFile & { readonly payload: Uint8Array })[]): void {
  const image = [...exported], expected = original.slice();
  for (const file of saved) {
    const entry = dos33Catalogue(image).files.find(entry => entry.name === file.name);
    assert.ok(entry); assert.equal(entry.type, "B"); assert.equal(entry.locked, false);
    const sectors = dos33FileSectors(image, entry).filter(sector => sector.fileSector !== undefined);
    assert.deepEqual(sectors.map(sector => sector.index), file.sectors.map(sector => file.track * 16 + sector));
    const contents = Uint8Array.from(sectors.flatMap(sector => image.slice(sector.index * 256, (sector.index + 1) * 256)));
    assert.deepEqual([...contents.slice(0, 4)], [file.address & 255, file.address >>> 8, file.bytes & 255, file.bytes >>> 8]);
    assert.deepEqual(contents.slice(4, 5 + file.bytes), file.payload);
    for (const [i, value] of file.payload.entries()) {
      const offset = 4 + i;
      expected[(file.track * 16 + file.sectors[Math.floor(offset / 256)]!) * 256 + offset % 256] = value;
    }
  }
  assert.deepEqual(exported, expected, "Only the three file payloads and their trailing bytes change; headers, catalogue and other sectors survive");
}
