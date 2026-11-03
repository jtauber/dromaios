import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { bootableXtDisk, dosFile, xtFloppyImage } from "./xt-floppy.ts";
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

const [dosPath, game, out, option, ...extra] = process.argv.slice(2);
if (!dosPath || !game || !out || (option !== undefined && option !== "--ega") || extra.length)
  throw new Error("Usage: node scripts/make-ultima-v-disks.ts DOS-DISK1.IMG GAME-DIRECTORY NEW-OUTPUT-DIRECTORY [--ega]");
const destination = resolve(out);
if (existsSync(destination)) throw new Error("Choose a new output directory.");
const dos = readFileSync(dosPath);
const loadGameFile = (name: string) => dosFile(name, readFileSync(join(game, name)));
const batch = dosFile("AUTOEXEC.BAT", Buffer.from("@ECHO OFF\r\nECHO Starting Ultima V...\r\nULTIMA\r\n"));
const ega = option === "--ega";
const programFiles = ega ? [...program, "EGA.DRV", "TILES.16", "ULTIMA.16", "CREATE.16", "STARTSC.16"] : program;
const disks = [
  [ega ? "ULTIMA-EGA-PROGRAM.IMG" : "ULTIMA-PROGRAM.IMG", bootableXtDisk(dos, [batch, ...programFiles.map(loadGameFile)])],
  ["ULTIMA-PLAYER.IMG", xtFloppyImage(makeXtDataDisk(), player.map(loadGameFile))],
] as const;
const staging = mkdtempSync(join(dirname(destination), ".ultima-v-"));
try {
  for (const [name, bytes] of disks) writeFileSync(join(staging, name), bytes);
  renameSync(staging, destination);
} finally { rmSync(staging, { recursive: true, force: true }); }
for (const [name, bytes] of disks) console.log(createHash("sha256").update(bytes).digest("hex"), join(destination, name));
