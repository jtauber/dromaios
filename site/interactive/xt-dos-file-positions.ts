import { physical8088 } from "./8088-disassembly.js";

export interface DosFileTableProfile {
  readonly pointer: string;
  readonly entrySize: string;
  readonly information: string;
  readonly position: string;
}
export interface DosFilePosition {
  readonly scope: string;
  readonly entry: number;
  readonly offset: number;
}

/** Read local disk-file positions from the selected DOS's SFT chain; never call DOS or read devices. */
export function dosFilePositions(profile: DosFileTableProfile, kernel: number, scope: string,
  handles: readonly number[], read: (address: number) => number | undefined): ReadonlyMap<number, DosFilePosition> {
  const word = (segment: number, offset: number): number | undefined => {
    const lo = read(physical8088(segment, offset)), hi = read(physical8088(segment, offset + 1));
    return lo === undefined || hi === undefined ? undefined : lo + hi * 256;
  };
  const wanted = new Set(handles.filter(index => index < 0x80)), positions = new Map<number, DosFilePosition>();
  const stride = parseInt(profile.entrySize, 16), infoOffset = parseInt(profile.information, 16), positionOffset = parseInt(profile.position, 16);
  let segment = kernel, pointer = parseInt(profile.pointer, 16), first = 0;
  const visited = new Set<number>();
  while (wanted.size && visited.size < 128) {
    const offset = word(segment, pointer), nextSegment = word(segment, pointer + 2);
    if (offset === undefined || nextSegment === undefined || offset === 0xffff) break;
    segment = nextSegment;
    const address = physical8088(segment, offset), count = word(segment, offset + 4);
    if (visited.has(address) || count === undefined || count === 0 || count > 256 || offset + 6 + count * stride > 0x10000) return new Map();
    visited.add(address);
    for (const index of wanted) {
      if (index >= first + count) continue;
      const entry = offset + 6 + (index - first) * stride;
      const references = word(segment, entry), mode = word(segment, entry + 2), info = word(segment, entry + infoOffset);
      const low = word(segment, entry + positionOffset), high = word(segment, entry + positionOffset + 2);
      // Exclude unused records, FCB records, character devices, and remote files.
      if (references !== undefined && references > 0 && references !== 0xffff && mode !== undefined && !(mode & 0x8000)
        && info !== undefined && !(info & 0x8080) && low !== undefined && high !== undefined) {
        positions.set(index, { scope, entry: physical8088(segment, entry), offset: low + high * 0x10000 });
      }
      wanted.delete(index);
    }
    first += count; pointer = offset; // Each table begins with the next far pointer, then its entry count.
  }
  return positions;
}
