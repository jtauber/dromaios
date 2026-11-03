import { createHash } from "node:crypto";

interface DiskFile { entry: Buffer; contents: Buffer }
const root = 5 * 512, data = 12 * 512, clusterSize = 1024;
const clusterStart = (cluster: number) => data + (cluster - 2) * clusterSize;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function dosFiles(disk: Buffer): DiskFile[] {
  if (sha256(disk) !== "d79f283ebd2cd68e8dede44ed876da13c25024f7000bcb576177820388c424f4")
    throw new Error("Expected the audited Microsoft MS-DOS 3.30 360 KiB system disk.");
  const files: DiskFile[] = [];
  for (let offset = root; disk[offset] && offset < data; offset += 32) {
    const entry = disk.subarray(offset, offset + 32);
    if (!["IO      SYS", "MSDOS   SYS", "COMMAND COM"].includes(entry.toString("ascii", 0, 11))) continue;
    let cluster = entry.readUInt16LE(26);
    const chunks: Buffer[] = [];
    while (cluster < 0xff8) {
      chunks.push(disk.subarray(clusterStart(cluster), clusterStart(cluster) + clusterSize));
      const pair = disk.readUInt16LE(512 + Math.floor(cluster * 3 / 2));
      cluster = cluster % 2 ? pair >> 4 : pair & 0xfff;
    }
    files.push({ entry, contents: Buffer.concat(chunks).subarray(0, entry.readUInt32LE(28)) });
  }
  return files;
}

export function dosFile(name: string, contents: Buffer): DiskFile {
  const [stem, extension] = name.split(".") as [string, string];
  const entry = Buffer.alloc(32);
  entry.write(stem.padEnd(8) + extension.padEnd(3), "ascii");
  entry[11] = 0x20; entry.writeUInt16LE(0x21, 24); // Archive bit and 1980-01-01.
  return { entry, contents };
}

export function xtFloppyImage(boot: Buffer, files: readonly DiskFile[]): Buffer {
  const disk = Buffer.alloc(360 * 1024);
  boot.copy(disk, 0, 0, 512);
  const fat = disk.subarray(512, 1536);
  fat.set([0xfd, 0xff, 0xff]);
  let cluster = 2;
  for (const [index, { entry, contents }] of files.entries()) {
    const end = cluster + Math.ceil(contents.length / clusterSize);
    if (clusterStart(end) > disk.length) throw new Error("Files exceed 360 KiB.");
    const offset = root + index * 32;
    entry.copy(disk, offset); disk.writeUInt16LE(cluster, offset + 26); disk.writeUInt32LE(contents.length, offset + 28);
    contents.copy(disk, clusterStart(cluster));
    while (cluster < end) {
      const next = cluster + 1 === end ? 0xfff : cluster + 1;
      const slot = Math.floor(cluster * 3 / 2), pair = fat.readUInt16LE(slot);
      fat.writeUInt16LE(cluster % 2 ? (pair & 15) | (next << 4) : (pair & 0xf000) | next, slot);
      cluster++;
    }
  }
  fat.copy(disk, 1536);
  return disk;
}

/** Keep the audited boot sector and its three DOS system files in their original order. */
export function bootableXtDisk(dos: Buffer, files: readonly DiskFile[]): Buffer {
  return xtFloppyImage(dos, [...dosFiles(dos), ...files]);
}
