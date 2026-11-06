import { decodeDos33DataField, dos33LogicalSectors } from "../../src/components/devices/dos33-disk.js";

export interface Dos33EncodedSector {
  readonly addressOffset: number;
  readonly volume: number;
  readonly track: number;
  readonly physicalSector: number;
  readonly sector: number | undefined; // DOS-order image index within the track.
  readonly checksum: number;
  readonly addressValid: boolean;
  readonly dataOffset: number | undefined;
  readonly bytes: readonly number[] | undefined; // Present only for a valid complete data field.
}

/** Inspect the model's complete byte stream, not flux or arbitrary circular disk captures. */
export function inspectDos33Track(track: readonly number[]): readonly Dos33EncodedSector[] {
  const prologue = (at: number, kind: number) => track[at] === 0xd5 && track[at + 1] === 0xaa && track[at + 2] === kind;
  const addresses: number[] = [];
  for (let at = 0; at < track.length; at++) if (prologue(at, 0x96)) addresses.push(at);
  return addresses.map((at, index) => {
    // Each 4-and-4 pair carries alternating data bits between fixed one bits.
    const decode = (offset: number) => ((track[offset]! << 1) | 1) & track[offset + 1]!;
    const volume = decode(at + 3), cylinder = decode(at + 5), physicalSector = decode(at + 7), checksum = decode(at + 9);
    const addressValid = at + 14 <= track.length
      && track.slice(at + 3, at + 11).every(byte => (byte & 0xaa) === 0xaa)
      && (volume ^ cylinder ^ physicalSector) === checksum
      && track[at + 11] === 0xde && track[at + 12] === 0xaa && track[at + 13] === 0xeb;
    const next = addresses[index + 1] ?? track.length;
    let dataOffset: number | undefined;
    for (let offset = at + 14; offset + 3 <= next; offset++) {
      if (prologue(offset, 0xad)) { dataOffset = offset; break; }
    }
    const decoded = dataOffset === undefined || dataOffset + 349 > next ? undefined
      : decodeDos33DataField(track.slice(dataOffset, dataOffset + 349));
    return { addressOffset: at, volume, track: cylinder, physicalSector, sector: dos33LogicalSectors[physicalSector],
      checksum, addressValid, dataOffset, bytes: decoded && Array.from(decoded) };
  });
}
