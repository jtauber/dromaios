import { checkUnsigned } from "../validation.ts";

/** DOS-order sectors indexed by the sector number recorded in each address field. */
const dosSector = [0, 7, 14, 6, 13, 5, 12, 4, 11, 3, 10, 2, 9, 1, 8, 15] as const;
const diskByte = [
  0x96, 0x97, 0x9a, 0x9b, 0x9d, 0x9e, 0x9f, 0xa6, 0xa7, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb2, 0xb3,
  0xb4, 0xb5, 0xb6, 0xb7, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf, 0xcb, 0xcd, 0xce, 0xcf, 0xd3,
  0xd6, 0xd7, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe5, 0xe6, 0xe7, 0xe9, 0xea, 0xeb, 0xec,
  0xed, 0xee, 0xef, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff,
] as const;

/** Immutable 35-track DOS-order media, with a deterministic DOS 3.3 byte stream. */
export class Dos33Disk {
  static readonly size = 35 * 16 * 256;
  readonly #bytes: readonly number[];
  readonly #tracks: readonly Uint8Array[];

  constructor(bytes: Uint8Array | readonly number[]) {
    if ((!Array.isArray(bytes) && !(bytes instanceof Uint8Array)) || bytes.length !== Dos33Disk.size) {
      throw new RangeError(`DOS-order disk requires ${Dos33Disk.size} bytes.`);
    }
    for (const byte of bytes) checkUnsigned("Disk byte", byte, 0xff);
    this.#bytes = Object.freeze(Array.from(bytes));
    this.#tracks = Array.from({ length: 35 }, (_, track) => this.#encodeTrack(track));
  }

  /** Immutable data may be shared by snapshots without exposing writable storage. */
  snapshot(): readonly number[] { return this.#bytes; }

  trackLength(track: number): number {
    checkUnsigned("Disk track", track, 34);
    return this.#tracks[track]!.length;
  }

  read(track: number, position: number): number {
    checkUnsigned("Disk position", position, this.trackLength(track) - 1);
    return this.#tracks[track]![position]!;
  }

  #encodeTrack(track: number): Uint8Array {
    const result: number[] = [];
    const gap = (length: number): void => { for (let i = 0; i < length; i++) result.push(0xff); };
    const addressByte = (value: number): void => { result.push((value >> 1) | 0xaa, value | 0xaa); };
    for (let sector = 0; sector < 16; sector++) {
      gap(sector === 0 ? 48 : 14);
      result.push(0xd5, 0xaa, 0x96);
      for (const value of [254, track, sector, 254 ^ track ^ sector]) addressByte(value);
      result.push(0xde, 0xaa, 0xeb);
      gap(6);
      result.push(0xd5, 0xaa, 0xad);
      const start = (track * 16 + dosSector[sector]!) * 256;
      // The 86 auxiliary values hold reversed low-bit pairs from three groups.
      const values = new Uint8Array(342);
      for (let i = 0; i < 256; i++) {
        const byte = this.#bytes[start + i]!;
        const pair = ((byte & 1) << 1) | ((byte & 2) >> 1);
        values[i % 86]! |= pair << (2 * Math.floor(i / 86));
        values[86 + i] = byte >> 2;
      }
      let previous = 0;
      for (const value of values) { result.push(diskByte[value ^ previous]!); previous = value; }
      result.push(diskByte[previous]!, 0xde, 0xaa, 0xeb);
    }
    return Uint8Array.from(result);
  }
}
