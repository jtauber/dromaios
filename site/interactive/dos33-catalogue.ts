/** DOS-order sector numbers below are indices into a 35 × 16 × 256-byte image. */
export const vtoc = 17 * 16;
export const sectorLabel = (index: number) => `T${Math.floor(index / 16)} S${index % 16}`;
const word = (bytes: readonly number[], at: number) => bytes[at]! + 256 * bytes[at + 1]!;

function pointer(bytes: readonly number[], at: number): number | undefined {
  const track = bytes[at]!, sector = bytes[at + 1]!;
  if (track === 0) return undefined;
  if (track >= 35 || sector >= 16) throw new Error(`Sector pointer T${track} S${sector} is outside the disk.`);
  return track * 16 + sector;
}

/** Catalogue and T/S list sectors both keep the next link at +$01. */
function* chain(bytes: readonly number[], first: number | undefined): Generator<number> {
  const visited = new Set<number>();
  for (let index = first; index !== undefined; index = pointer(bytes, index * 256 + 1)) {
    if (visited.has(index)) throw new Error(`Sector chain loops at ${sectorLabel(index)}.`);
    visited.add(index); yield index;
  }
}

export interface Dos33File {
  readonly name: string;
  readonly type: string;
  readonly locked: boolean;
  readonly count: number;
  readonly entry: number; // Absolute byte offset of the catalogue entry.
}
const types: Readonly<Record<number, string>> = { 0: "T", 1: "I", 2: "A", 4: "B", 8: "S", 16: "R", 32: "AA", 64: "BB" };

export function dos33Catalogue(bytes: readonly number[]) {
  const base = vtoc * 256;
  if (bytes.length !== 35 * 16 * 256 || bytes[base + 0x34] !== 35 || bytes[base + 0x35] !== 16 || word(bytes, base + 0x36) !== 256) {
    throw new Error("No standard 35-track DOS 3.3 volume table was found.");
  }
  const files: Dos33File[] = [], sectors: number[] = [];
  const volume = { number: bytes[base + 6]!, files, sectors };
  for (const index of chain(bytes, pointer(bytes, base + 1))) {
    sectors.push(index);
    for (let offset = 0x0b; offset < 256; offset += 35) {
      const entry = index * 256 + offset;
      if (bytes[entry] === 0) return volume; // First unused slot ends the catalogue.
      if (bytes[entry] === 0xff) continue; // Deleted file.
      const flags = bytes[entry + 2]!;
      const name = bytes.slice(entry + 3, entry + 33).map(byte => {
        const char = byte & 0x7f;
        return char >= 0x20 && char < 0x7f ? String.fromCharCode(char) : "·";
      }).join("").trimEnd();
      files.push({ entry, name, type: types[flags & 0x7f] ?? "?", locked: Boolean(flags & 0x80), count: word(bytes, entry + 33) });
    }
  }
  return volume;
}

export interface Dos33FileSector { readonly index: number; readonly label: string; readonly detail: string }

/** Follow the selected file's lists. A sparse slot consumes a file position but supplies no disk sector. */
export function dos33FileSectors(bytes: readonly number[], file: Dos33File): Dos33FileSector[] {
  const catalog = Math.floor(file.entry / 256), offset = file.entry % 256;
  const firstList = pointer(bytes, file.entry);
  if (firstList === undefined) throw new Error("The file has no track/sector list.");
  const result = [{ index: catalog, label: "Catalogue entry", detail: `${file.name} starts at +$${offset.toString(16).toUpperCase()}. Its first two bytes point to the T/S list at ${sectorLabel(firstList)}.` }];
  for (const index of chain(bytes, firstList)) {
    const base = index * 256, first = word(bytes, base + 5);
    result.push({ index, label: "T/S list", detail: `The next list pointer is at +$01. Pairs from +$0C describe file sectors starting at ${first}.` });
    for (let at = 0x0c; at < 256; at += 2) {
      const data = pointer(bytes, base + at);
      if (data === undefined) continue;
      const n = first + (at - 0x0c) / 2;
      if (result.length > 35 * 16) throw new Error("The file references more sectors than fit on this disk.");
      const length = file.type === "A" && n === 0 ? ` The first word gives the Applesoft length (${word(bytes, data * 256)} bytes).` : "";
      result.push({ index: data, label: `File sector ${n}`,
        detail: `Referenced by ${sectorLabel(index)} at +$${at.toString(16).toUpperCase().padStart(2, "0")}.${length}` });
    }
  }
  return result;
}
