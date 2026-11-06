import { checkUnsigned } from "../validation.ts";

/** DOS-order sectors indexed by the sector number recorded in each address field. */
export const dos33LogicalSectors = Object.freeze([0, 7, 14, 6, 13, 5, 12, 4, 11, 3, 10, 2, 9, 1, 8, 15]);
const diskByte: readonly number[] = [
  0x96, 0x97, 0x9a, 0x9b, 0x9d, 0x9e, 0x9f, 0xa6, 0xa7, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb2, 0xb3,
  0xb4, 0xb5, 0xb6, 0xb7, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf, 0xcb, 0xcd, 0xce, 0xcf, 0xd3,
  0xd6, 0xd7, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe5, 0xe6, 0xe7, 0xe9, 0xea, 0xeb, 0xec,
  0xed, 0xee, 0xef, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff,
];

const firstGap = 48, sectorGap = 14, dataGap = 6;
const addressFieldSize = 14, dataFieldSize = 3 + 343 + 3;
// Distance from one address prologue to the next within a track.
export const dos33SectorSpan = addressFieldSize + dataGap + dataFieldSize + sectorGap;

export interface Dos33SectorWrite {
  readonly track: number;
  readonly sector: number; // Logical sector in the DOS-order image.
  readonly bytes: readonly number[];
}

function reversePair(value: number): number { return ((value & 1) << 1) | ((value & 2) >> 1); }

/** Decode one complete DOS data field between optional FF sync bytes. */
export function decodeDos33DataField(bytes: readonly number[]): Uint8Array | undefined {
  const start = bytes.findIndex(byte => byte !== 0xff);
  const end = start + dataFieldSize;
  if (start < 0 || bytes[start] !== 0xd5 || bytes[start + 1] !== 0xaa || bytes[start + 2] !== 0xad
    || bytes[end - 3] !== 0xde || bytes[end - 2] !== 0xaa || bytes[end - 1] !== 0xeb
    || bytes.slice(end).some(byte => byte !== 0xff)) return undefined;

  const values = new Uint8Array(342);
  let previous = 0;
  for (let i = 0; i < values.length; i++) {
    const code = diskByte.indexOf(bytes[start + 3 + i]!);
    if (code < 0) return undefined;
    previous ^= code;
    values[i] = previous;
  }
  if (bytes[end - 4] !== diskByte[previous]) return undefined;
  return Uint8Array.from({ length: 256 }, (_, i) =>
    (values[86 + i]! << 2) | reversePair(values[i % 86]! >> (2 * Math.floor(i / 86))));
}

/** Owned DOS-order sectors and their canonical, access-driven track streams. */
export class Dos33Disk {
  static readonly size = 35 * 16 * 256;
  readonly writable: boolean;
  readonly #bytes: Uint8Array;
  readonly #tracks: Uint8Array[];
  readonly #observers = new Set<(write: Dos33SectorWrite) => void>();
  #snapshot: readonly number[] | undefined;

  constructor(bytes: Uint8Array | readonly number[], { writable = false } = {}) {
    if ((!Array.isArray(bytes) && !(bytes instanceof Uint8Array)) || bytes.length !== Dos33Disk.size) {
      throw new RangeError(`DOS-order disk requires ${Dos33Disk.size} bytes.`);
    }
    if (typeof writable !== "boolean") throw new TypeError("Disk write permission must be boolean.");
    for (const byte of bytes) checkUnsigned("Disk byte", byte, 0xff);
    this.writable = writable;
    this.#bytes = Uint8Array.from(bytes);
    this.#tracks = Array.from({ length: 35 }, (_, track) => this.#encodeTrack(track));
  }

  snapshot(): readonly number[] { return this.#snapshot ??= Object.freeze(Array.from(this.#bytes)); }
  exportImage(): Uint8Array { return this.#bytes.slice(); }

  /** Capture the stored encoded stream without consuming a controller byte. */
  inspectTrack(track: number): readonly number[] {
    this.trackLength(track); // Validate before indexing; the returned copy survives later writes.
    return Object.freeze(Array.from(this.#tracks[track]!));
  }

  /** Observe accepted fields, including identical rewrites. Observers must not throw or modify the medium. */
  observeWrites(observer: (write: Dos33SectorWrite) => void): () => void {
    this.#observers.add(observer);
    return () => { this.#observers.delete(observer); };
  }

  /** A DOS-order image can represent a valid replacement data field on an existing sector. */
  writeDataField(track: number, position: number, bytes: readonly number[]): void {
    checkUnsigned("Disk position", position, this.trackLength(track) - 1);
    const sector = Math.floor((position - firstGap) / dos33SectorSpan);
    const within = position - (firstGap + sector * dos33SectorSpan);
    // RWTS reads through DE AA of the address epilogue, then switches to writing.
    if (!this.writable || sector < 0 || sector >= 16 || within < addressFieldSize - 1
      || within > addressFieldSize + dataGap || within + bytes.length > dos33SectorSpan) return;
    const data = decodeDos33DataField(bytes);
    if (!data) return;
    const logical = dos33LogicalSectors[sector]!;
    this.#bytes.set(data, (track * 16 + logical) * 256);
    this.#tracks[track] = this.#encodeTrack(track);
    this.#snapshot = undefined;
    if (this.#observers.size) {
      const write = Object.freeze({ track, sector: logical, bytes: Object.freeze(Array.from(data)) });
      for (const observer of this.#observers) observer(write);
    }
  }

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
      gap(sector === 0 ? firstGap : sectorGap);
      result.push(0xd5, 0xaa, 0x96);
      for (const value of [254, track, sector, 254 ^ track ^ sector]) addressByte(value);
      result.push(0xde, 0xaa, 0xeb);
      gap(dataGap);
      result.push(0xd5, 0xaa, 0xad);
      const start = (track * 16 + dos33LogicalSectors[sector]!) * 256;
      // The 86 auxiliary values hold reversed low-bit pairs from three groups.
      const values = new Uint8Array(342);
      for (let i = 0; i < 256; i++) {
        const byte = this.#bytes[start + i]!;
        const pair = reversePair(byte);
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
