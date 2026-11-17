/** Read-only DOS 2+ BPB / FAT12 inspection for a whole 360 KiB XT diskette.
 * Layout and packed entries follow Microsoft's FAT on-disk format specification.
 * No filesystem operations are substituted for guest DOS or BIOS calls.
 */
export type Fat12Bytes = Uint8Array | readonly number[];
export interface Fat12Entry {
  readonly name: string;
  readonly kind: "file" | "directory" | "volume";
  readonly attributes: number;
  readonly offset: number;
  readonly size: number;
  readonly firstCluster: number;
  readonly clusters: readonly number[];
  readonly ending: string;
  readonly issues: readonly string[];
}
export interface Fat12Volume {
  readonly sectorsPerCluster: number;
  readonly fatOffsets: readonly number[];
  readonly fatBytes: number;
  readonly rootOffset: number;
  readonly dataOffset: number;
  readonly clusterCount: number;
  readonly fat: readonly number[];
  readonly entries: readonly Fat12Entry[];
  readonly warnings: readonly string[];
}
export interface Fat12Region {
  readonly kind: "directory" | "fat" | "data";
  readonly label: string;
  readonly offset: number;
  readonly length: number;
  readonly fileOffset?: number;
  readonly fileBytes?: number;
  readonly cluster?: number;
}
const hex = (value: number) => value.toString(16).toUpperCase().padStart(3, "0");

export function inspectFat12(bytes: Fat12Bytes): Fat12Volume {
  const invalid = (message: string): never => { throw new Error(`Cannot inspect FAT12: ${message}`); };
  if (bytes.length !== 360 * 1024) invalid("expected a whole 360 KiB disk image.");
  const word = (at: number) => bytes[at]! + bytes[at + 1]! * 256;
  const dword = (at: number) => word(at) + word(at + 2) * 65536;
  const sectorsPerCluster = bytes[13]!, reserved = word(14), copies = bytes[16]!;
  const rootEntries = word(17), totalSectors = word(19), fatBytes = word(22) * 512;
  if (word(11) !== 512 || totalSectors !== 720) invalid("BPB must describe 720 sectors of 512 bytes.");
  if (!sectorsPerCluster || sectorsPerCluster > 128 || (sectorsPerCluster & (sectorsPerCluster - 1))) invalid("invalid sectors per cluster.");
  if (!reserved || copies < 1 || copies > 2 || !rootEntries || !fatBytes) invalid("invalid reserved, FAT or root-directory size.");
  const fatOffsets = Array.from({ length: copies }, (_, i) => reserved * 512 + i * fatBytes);
  const rootOffset = reserved * 512 + copies * fatBytes;
  const dataOffset = rootOffset + Math.ceil(rootEntries * 32 / 512) * 512;
  const clusterCount = Math.floor((bytes.length - dataOffset) / (sectorsPerCluster * 512));
  if (clusterCount < 1 || clusterCount >= 4085) invalid("regions overlap or leave no FAT12 data clusters.");
  if (Math.floor((clusterCount + 1) * 3 / 2) + 2 > fatBytes) invalid("FAT cannot address the declared data region.");
  // Neighboring 12-bit entries share a byte. The two-byte read can straddle a sector.
  const fat = Array.from({ length: clusterCount + 2 }, (_, cluster) => {
    const pair = word(fatOffsets[0]! + Math.floor(cluster * 3 / 2));
    return cluster & 1 ? pair >>> 4 : pair & 0xfff;
  });
  if (bytes[21] !== 0xfd || fat[0] !== 0xffd || fat[1]! < 0xff8) invalid("missing 360 KiB media descriptor or reserved FAT entries.");
  const warnings: string[] = [];
  const copiesDiffer = fatOffsets.slice(1).some(offset => {
    for (let i = 0; i < fatBytes; i++) if (bytes[offset + i] !== bytes[fatOffsets[0]! + i]) return true;
    return false;
  });
  if (copiesDiffer) {
    warnings.push("FAT copies differ; allocation chains below use FAT 1. A write may be incomplete.");
  }
  function chain(first: number): { clusters: number[]; ending: string; issues: string[] } {
    const clusters: number[] = [], seen = new Set<number>();
    if (!first) return { clusters, ending: "empty", issues: [] };
    let cluster = first;
    for (;;) {
      let error: string | undefined;
      if (cluster === 0) error = "free cluster";
      else if (cluster === 1 || (cluster >= 0xff0 && cluster <= 0xff6)) error = "reserved cluster";
      else if (cluster === 0xff7) error = "bad cluster";
      else if (cluster < 2 || cluster > clusterCount + 1) error = "cluster outside the data region";
      else if (seen.has(cluster)) error = "allocation cycle";
      if (error) return { clusters, ending: `$${hex(cluster)}`, issues: [`${error} at $${hex(cluster)}.`] };
      clusters.push(cluster); seen.add(cluster);
      const next = fat[cluster]!;
      if (next >= 0xff8) return { clusters, ending: `end $${hex(next)}`, issues: [] };
      cluster = next;
    }
  }
  const namePart = (at: number, count: number, firstName = false) => Array.from({ length: count }, (_, i) => {
    const byte = bytes[at + i]!, value = firstName && i === 0 && byte === 5 ? 0xe5 : byte;
    return value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : `\\x${value.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("").trimEnd();
  const entries: Fat12Entry[] = [], owners = new Map<number, string>();
  let longNames = 0;
  for (let index = 0; index < rootEntries; index++) {
    const offset = rootOffset + index * 32, first = bytes[offset]!, attributes = bytes[offset + 11]!;
    if (!first) break;
    if (first === 0xe5) continue;
    if ((attributes & 0x3f) === 0x0f) { longNames++; continue; }
    const kind = attributes & 8 ? "volume" : attributes & 16 ? "directory" : "file";
    const extension = namePart(offset + 8, 3);
    const name = kind === "volume" ? namePart(offset, 11, true) : namePart(offset, 8, true) + (extension ? "." + extension : "");
    const firstCluster = word(offset + 26), size = dword(offset + 28);
    const allocation = kind === "volume" ? { clusters: [], ending: "label", issues: [] as string[] } : chain(firstCluster);
    const allocated = allocation.clusters.length * sectorsPerCluster * 512;
    if (kind === "file" && Math.ceil(size / (sectorsPerCluster * 512)) !== allocation.clusters.length) {
      allocation.issues.push(size > allocated ? "File size exceeds the observed allocation." : "Allocation extends beyond the file's required clusters.");
    }
    if (kind === "volume" && (firstCluster || size)) allocation.issues.push("Volume label has nonzero cluster or size fields.");
    if (kind === "directory" && !firstCluster) allocation.issues.push("Subdirectory has no allocation chain.");
    if (attributes & 0xc0) allocation.issues.push("Reserved directory attribute bits are set.");
    for (const cluster of allocation.clusters) {
      const owner = owners.get(cluster);
      if (owner) warnings.push(`Cluster ${cluster} is shared by ${owner} and ${name}.`);
      else owners.set(cluster, name);
    }
    entries.push({ name, kind, attributes, offset, size, firstCluster, ...allocation });
  }
  if (longNames) warnings.push(`${longNames} long-name entries omitted; DOS short names are shown.`);
  return { sectorsPerCluster, fatOffsets, fatBytes, rootOffset, dataOffset, clusterCount, fat, entries, warnings };
}

/** Byte ranges describe the selected snapshot's allocation, not ownership at an earlier transfer. */
export function fat12FileRegions(volume: Fat12Volume, entry: Fat12Entry): Fat12Region[] {
  const regions: Fat12Region[] = [{ kind: "directory", label: "Directory entry", offset: entry.offset, length: 32 }];
  const clusterBytes = volume.sectorsPerCluster * 512;
  for (const [index, cluster] of entry.clusters.entries()) {
    for (const [copy, offset] of volume.fatOffsets.entries()) regions.push({ kind: "fat", label: `FAT ${copy + 1} · cluster ${cluster}`,
      offset: offset + Math.floor(cluster * 3 / 2), length: 2, cluster });
    regions.push({ kind: "data", label: `Cluster ${cluster}`, cluster, offset: volume.dataOffset + (cluster - 2) * clusterBytes,
      length: clusterBytes, ...(entry.kind === "file" && { fileOffset: index * clusterBytes,
        fileBytes: Math.min(clusterBytes, Math.max(0, entry.size - index * clusterBytes)) }) });
  }
  return regions;
}

export function readFat12File(bytes: Fat12Bytes, volume: Fat12Volume, entry: Fat12Entry): Uint8Array {
  if (entry.kind !== "file" || entry.issues.length) throw new Error("Cannot read an incomplete or invalid file allocation.");
  const result = new Uint8Array(entry.size);
  for (const region of fat12FileRegions(volume, entry)) if (region.kind === "data") {
    result.set(bytes.slice(region.offset, region.offset + region.fileBytes!), region.fileOffset);
  }
  return result;
}
