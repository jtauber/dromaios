import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { makeXtDataDisk } from "./make-xt-data-disk.ts";

// CGA files from the Program disk and the 41 files on the 360 KiB Player disk.
const program = `ULTIMA.EXE DATA.OVL IBM.CH RUNES.CH PROPORT.PCS MISCMAPS.DAT QUESTION.DAT
INIT.GAM INIT.OOL INTRO.OVL FONT.OVL FLAMES.OVL CGA.DRV WD.BIT TITLE.BIT BRITISH.BIT
BRITISH.PTH TILES.4 ULTIMA.4 CREATE.4 STARTSC.4`.split(/\s+/);
const player = `BRIT.DAT BRIT.CBT TOWNE.DAT DWELLING.DAT CASTLE.DAT KEEP.DAT LOOK2.DAT
MISCMAPS.DAT MISCMSG.DAT SHOPPE.DAT SIGNS.DAT KARMA.DAT SAVED.GAM CASTLE.NPC DWELLING.NPC
KEEP.NPC TOWNE.NPC BRIT.OOL UNDER.OOL SAVED.OOL TOWN.OVL MAINOUT.OVL NPC.OVL COMBAT.OVL
LOOKOBJ.OVL OUTSUBS.OVL SHOPPES.OVL SJOG.OVL CMDS.OVL CAST.OVL TALK.OVL CAST2.OVL ZSTATS.OVL
COMSUBS.OVL SHOPPES2.OVL SHOPPES3.OVL BLCKTHRN.OVL TOWNE.TLK DWELLING.TLK CASTLE.TLK KEEP.TLK`.split(/\s+/);

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

function file(name: string, contents: Buffer): DiskFile {
  const [stem, extension] = name.split(".") as [string, string];
  const entry = Buffer.alloc(32);
  entry.write(stem.padEnd(8) + extension.padEnd(3), "ascii");
  entry[11] = 0x20; entry.writeUInt16LE(0x21, 24); // Archive bit and 1980-01-01.
  return { entry, contents };
}

function image(boot: Buffer, files: readonly DiskFile[]): Buffer {
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

const [dosPath, game, out, ...extra] = process.argv.slice(2);
if (!dosPath || !game || !out || extra.length)
  throw new Error("Usage: node scripts/make-ultima-v-disks.ts DOS-DISK1.IMG GAME-DIRECTORY NEW-OUTPUT-DIRECTORY");
const destination = resolve(out);
if (existsSync(destination)) throw new Error("Choose a new output directory.");
const dos = readFileSync(dosPath);
const loadGameFile = (name: string) => file(name, readFileSync(join(game, name)));
const batch = file("AUTOEXEC.BAT", Buffer.from("@ECHO OFF\r\nECHO Starting Ultima V...\r\nULTIMA\r\n"));
const disks = [
  ["ULTIMA-PROGRAM.IMG", image(dos, [...dosFiles(dos), batch, ...program.map(loadGameFile)])],
  ["ULTIMA-PLAYER.IMG", image(makeXtDataDisk(), player.map(loadGameFile))],
] as const;
const staging = mkdtempSync(join(dirname(destination), ".ultima-v-"));
try {
  for (const [name, bytes] of disks) writeFileSync(join(staging, name), bytes);
  renameSync(staging, destination);
} finally { rmSync(staging, { recursive: true, force: true }); }
for (const [name, bytes] of disks) console.log(sha256(bytes), join(destination, name));
