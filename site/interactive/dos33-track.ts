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

/** Address fields through DE AA, the two epilogue bytes checked by DOS. */
export function inspectDos33Address(bytes: readonly number[]) {
  const decode = (offset: number) => ((bytes[offset]! << 1) | 1) & bytes[offset + 1]!;
  const volume = decode(3), track = decode(5), physicalSector = decode(7), checksum = decode(9);
  const valid = bytes.length === 13 && bytes[0] === 0xd5 && bytes[1] === 0xaa && bytes[2] === 0x96
    && bytes.slice(3, 11).every(byte => (byte & 0xaa) === 0xaa)
    && (volume ^ track ^ physicalSector) === checksum && bytes[11] === 0xde && bytes[12] === 0xaa;
  return { volume, track, physicalSector, checksum, valid };
}

/** Inspect the model's complete byte stream, not flux or arbitrary circular disk captures. */
export function inspectDos33Track(track: readonly number[]): readonly Dos33EncodedSector[] {
  const prologue = (at: number, kind: number) => track[at] === 0xd5 && track[at + 1] === 0xaa && track[at + 2] === kind;
  const addresses: number[] = [];
  for (let at = 0; at < track.length; at++) if (prologue(at, 0x96)) addresses.push(at);
  return addresses.map((at, index) => {
    const { volume, track: cylinder, physicalSector, checksum, valid } = inspectDos33Address(track.slice(at, at + 13));
    const addressValid = valid && track[at + 13] === 0xeb;
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

/** A stored-byte window around the next transfer position, wrapping at the track boundary. */
export function dos33HeadWindow(track: readonly number[], fields: readonly Dos33EncodedSector[], position: number) {
  return Array.from({ length: 64 }, (_, i) => {
    const offset = (position - 32 + i + track.length) % track.length;
    const field = fields.find(field => offset >= field.addressOffset && offset < field.addressOffset + 14
      || field.dataOffset !== undefined && offset >= field.dataOffset && offset < field.dataOffset + 349);
    const part = !field ? "gap" : offset < field.addressOffset + 14 ? "address"
      : offset === field.dataOffset! + 345 ? "checksum" : "data";
    return { offset, value: track[offset]!, part, next: i === 32 };
  });
}
