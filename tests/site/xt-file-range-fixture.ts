import { makeXtDataDisk } from "../../scripts/make-xt-data-disk.js";

/** Independent 2050-byte file in clusters 2 → 5 → 4, leaving HELLO.COM in cluster 3. */
export function xtFileRangeDisk() {
  const disk = makeXtDataDisk(), bytes = Buffer.from(Array.from({ length: 2050 }, (_, i) => 33 + i % 90));
  disk.writeUInt32LE(bytes.length, 2592 + 28);
  for (const base of [512, 1536]) for (const [cluster, next] of [[2, 5], [5, 4], [4, 0xfff]] as const) {
    const offset = base + Math.floor(cluster * 3 / 2), pair = disk.readUInt16LE(offset);
    disk.writeUInt16LE(cluster & 1 ? (pair & 15) | next << 4 : (pair & 0xf000) | next, offset);
  }
  for (const [i, cluster] of [2, 5, 4].entries()) bytes.copy(disk, 6144 + (cluster - 2) * 1024, i * 1024, Math.min((i + 1) * 1024, bytes.length));
  return { disk, bytes };
}
