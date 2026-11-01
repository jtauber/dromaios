import { writeFileSync } from "node:fs";

/** Build the read-only DOS exercise disk with two one-cluster files and no external media. */
export function makeXtDataDisk(): Buffer {
  const sectorSize = 512;
  const disk = Buffer.alloc(720 * sectorSize);

  // DOS 3.x BIOS parameter block for a double-sided, nine-sector, 360 KiB floppy.
  disk.set([0xeb, 0x3c, 0x90]); // Jump over the BPB if this data disk is booted.
  disk.write("DROMAIOS", 3, "ascii");
  disk.writeUInt16LE(sectorSize, 11);
  disk[13] = 2; // Sectors per cluster
  disk.writeUInt16LE(1, 14); // Reserved boot sector
  disk[16] = 2; // FAT copies
  disk.writeUInt16LE(112, 17); // Root directory entries
  disk.writeUInt16LE(720, 19); // Total sectors
  disk[21] = 0xfd; // 360 KiB media descriptor
  disk.writeUInt16LE(2, 22); // Sectors per FAT
  disk.writeUInt16LE(9, 24); // Sectors per track
  disk.writeUInt16LE(2, 26); // Heads
  disk.set([0xcd, 0x18], 0x3e); // INT 18h: hand control to ROM BASIC.
  disk.set([0x55, 0xaa], 510);

  // Both FAT12 copies reserve entries 0 and 1. Clusters 2 and 3 each end a file.
  for (const sector of [1, 3]) disk.set([0xfd, 0xff, 0xff, 0xff, 0xff, 0xff], sector * sectorSize);

  const readme = Buffer.from("Dromaios XT data disk.\r\nDOS read this file from drive A.\r\n", "ascii");
  const hello = Buffer.concat([Buffer.from([
    0xba, 0x0c, 0x01, // MOV DX,010Ch (message after the twelve code bytes at 0100h)
    0xb4, 0x09,       // MOV AH,09h
    0xcd, 0x21,       // INT 21h: print the dollar-terminated message at DS:DX
    0xb8, 0x00, 0x4c, // MOV AX,4C00h
    0xcd, 0x21,       // INT 21h: return to DOS with status zero
  ]), Buffer.from("Hello from HELLO.COM on drive A.\r\n$", "ascii")]);

  const root = 5 * sectorSize;
  disk.write("DROMAIOS   ", root, "ascii");
  disk[root + 11] = 0x08; // Volume label
  const files = [{ name: "README  TXT", contents: readme }, { name: "HELLO   COM", contents: hello }];
  for (const [index, { name, contents }] of files.entries()) {
    const entry = root + (index + 1) * 32;
    disk.write(name, entry, "ascii");
    disk[entry + 11] = 0x20; // Ordinary file, archive bit set
    disk.writeUInt16LE(0x0021, entry + 24); // 1980-01-01
    disk.writeUInt16LE(2 + index, entry + 26);
    disk.writeUInt32LE(contents.length, entry + 28);
    contents.copy(disk, (12 + 2 * index) * sectorSize);
  }
  return disk;
}

if (import.meta.main) {
  const [output, ...extra] = process.argv.slice(2);
  if (!output || extra.length) throw new Error("Usage: node scripts/make-xt-data-disk.ts OUTPUT.IMG");
  writeFileSync(output, makeXtDataDisk(), { flag: "wx" });
}
