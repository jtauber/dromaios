import assert from "node:assert/strict";
import { test } from "node:test";
import { makeXtDataDisk } from "../../scripts/make-xt-data-disk.js";
import { fat12FileRegions, inspectFat12, readFat12File } from "../../site/interactive/fat12.js";
import { xtDiskActivityMatches, xtFileTransfers } from "../../site/interactive/xt-disk-file-transfers.js";
import type { XtDiskOperation } from "../../site/interactive/xt-disk-activity.js";
import { create8088PcXt } from "../../src/machines/generated/8088/pc-xt.js";

function setFat(disk: Buffer, cluster: number, value: number) {
  for (const base of [512, 1536]) {
    const at = base + Math.floor(cluster * 3 / 2), pair = disk.readUInt16LE(at);
    disk.writeUInt16LE(cluster % 2 ? (pair & 0x000f) | (value << 4) : (pair & 0xf000) | value, at);
  }
}
const readmeEntry = 5 * 512 + 32;

test("FAT12 root entries map the independent DOS fixture to directory, both FATs, file bytes and slack", () => {
  const disk = makeXtDataDisk(), before = Buffer.from(disk), v = inspectFat12(disk), file = v.entries[1]!;
  assert.deepEqual([v.rootOffset, v.dataOffset, v.clusterCount, v.sectorsPerCluster], [2560, 6144, 354, 2]);
  assert.deepEqual(v.fatOffsets, [512, 1536]); assert.deepEqual(v.warnings, []);
  assert.deepEqual(v.entries.map(e => [e.name, e.kind, e.clusters]), [["DROMAIOS", "volume", []], ["README.TXT", "file", [2]], ["HELLO.COM", "file", [3]]]);
  assert.equal(file.size, 58); assert.deepEqual(file.issues, []);
  assert.deepEqual(fat12FileRegions(v, file).map(r => [r.kind, r.offset, r.length, r.fileBytes]),
    [["directory", 2592, 32, undefined], ["fat", 515, 2, undefined], ["fat", 1539, 2, undefined], ["data", 6144, 1024, 58]]);
  assert.equal(Buffer.from(readFat12File(disk, v, file)).toString("ascii"), "Dromaios XT data disk.\r\nDOS read this file from drive A.\r\n");
  assert.deepEqual(disk, before);
});

test("fragmented chains decode odd/even packed entries across a FAT sector and trim the last cluster", () => {
  const disk = makeXtDataDisk(); disk.writeUInt16LE(341, readmeEntry + 26); disk.writeUInt32LE(2050, readmeEntry + 28);
  setFat(disk, 341, 4); setFat(disk, 4, 2); setFat(disk, 2, 0xff8);
  for (const [cluster, byte] of [[341, 65], [4, 66], [2, 67]]) disk.fill(byte!, 6144 + (cluster! - 2) * 1024, 6144 + (cluster! - 1) * 1024);
  const v = inspectFat12(disk), file = v.entries[1]!;
  assert.deepEqual(file.clusters, [341, 4, 2]); assert.equal(file.ending, "end $FF8"); assert.deepEqual(file.issues, []);
  const contents = readFat12File(disk, v, file);
  assert.deepEqual([...contents], [...Array(1024).fill(65), ...Array(1024).fill(66), 67, 67]);
  assert.ok(fat12FileRegions(v, file).some(r => r.kind === "fat" && r.offset === 1023 && r.length === 2));
  assert.equal(v.fat[340], 0); // Neighbor nibble retained.
});

test("invalid allocation and size combinations remain bounded and cannot masquerade as readable files", () => {
  for (const [value, issue] of [[0, /free cluster/], [1, /reserved cluster/], [0xff0, /reserved cluster/], [0xff7, /bad cluster/], [356, /outside/], [2, /cycle/]] as const) {
    const disk = makeXtDataDisk(); setFat(disk, 2, value);
    const v = inspectFat12(disk), file = v.entries[1]!;
    assert.deepEqual(file.clusters, [2]); assert.match(file.issues.join(" "), issue);
    assert.throws(() => readFat12File(disk, v, file), /invalid file allocation/);
  }
  for (const size of [0, 1025, 0xffffffff]) {
    const disk = makeXtDataDisk(); disk.writeUInt32LE(size, readmeEntry + 28);
    const v = inspectFat12(disk); assert.equal(v.entries[1]!.issues.length, 1);
    assert.throws(() => readFat12File(disk, v, v.entries[1]!), /invalid/);
  }
  const disk = makeXtDataDisk(); disk.writeUInt16LE(0, readmeEntry + 26); disk.writeUInt32LE(0, readmeEntry + 28);
  const v = inspectFat12(disk); assert.equal(readFat12File(disk, v, v.entries[1]!).length, 0);
});

test("FAT disagreements, cross-links, deleted slots, long names and subdirectories are reported faithfully", () => {
  const disk = makeXtDataDisk(); disk[1539] = 0xf8;
  disk.writeUInt16LE(2, 2560 + 64 + 26);
  const v = inspectFat12(disk);
  assert.match(v.warnings.join(" "), /FAT copies differ.*Cluster 2 is shared/);
  assert.deepEqual(v.entries[1]!.clusters, [2]);
  disk[readmeEntry] = 0xe5; disk[2560 + 64 + 11] = 0x0f;
  disk.write("SUBDIR     ", 2560 + 96, "ascii"); disk[2560 + 96 + 11] = 0x10; disk.writeUInt16LE(3, 2560 + 96 + 26);
  const d = inspectFat12(disk);
  assert.deepEqual(d.entries.map(e => e.name), ["DROMAIOS", "SUBDIR"]);
  assert.equal(d.entries[1]!.kind, "directory"); assert.deepEqual(d.entries[1]!.issues, []);
  assert.match(d.warnings.join(" "), /long-name/);
});

test("unsupported or corrupt BPBs are rejected before any FAT or directory walk", () => {
  assert.throws(() => inspectFat12(new Uint8Array(5)), /360 KiB/);
  for (const [at, value] of [[11, 256], [13, 3], [14, 0xffff], [16, 0], [17, 0xffff], [19, 0], [22, 0]]) {
    const disk = makeXtDataDisk(); disk.writeUInt16LE(value!, at!);
    assert.throws(() => inspectFat12(disk), /Cannot inspect FAT12/);
  }
  assert.throws(() => inspectFat12(new Uint8Array(360 * 1024)), /BPB/);
});

function operation(overrides: Partial<XtDiskOperation> = {}): XtDiskOperation {
  return { id: 7, command: 0xe6, parameters: [0, 0, 1, 4, 2, 9, 42, 255], continued: false, started: 0, updated: 1,
    state: "complete", sectors: [], omittedSectors: 0, bytes: 512, result: [0, 0, 0, 0, 1, 5, 2], consumed: 7, irq6: true, ...overrides };
}

test("file transfer links clip to the exact file and metadata bytes, including partial and wrapped DMA spans", () => {
  const disk = makeXtDataDisk(), v = inspectFat12(disk), regions = fat12FileRegions(v, v.entries[1]!);
  const read = operation({ sectors: [
    { offset: 6144, firstByte: 0, lastByte: 31, firstAddress: 0x2ffe0, lastAddress: 0x2ffff, bytes: 32, direction: "disk-to-memory", terminal: false },
    { offset: 6144, firstByte: 32, lastByte: 511, firstAddress: 0x20000, lastAddress: 0x201df, bytes: 480, direction: "disk-to-memory", terminal: true },
    { offset: 2560, firstByte: 0, lastByte: 511, firstAddress: 0x4000, lastAddress: 0x41ff, bytes: 512, direction: "disk-to-memory", terminal: true },
  ] });
  assert.deepEqual(xtFileTransfers(regions, [read]).map(t => [t.kind, t.offset, t.bytes, t.address, t.fileOffset]),
    [["data", 6144, 32, 0x2ffe0, 0], ["data", 6176, 26, 0x20000, 32], ["directory", 2592, 32, 0x4020, undefined]]);
  assert.ok(xtDiskActivityMatches(read, regions));
  assert.equal(xtFileTransfers(regions, [operation({ sectors: [{ ...read.sectors[1]!, firstByte: 256, firstAddress: 0x20100, bytes: 256 }] })]).length, 0);
  const protectedWrite = operation({ command: 0xc5, bytes: 0 });
  assert.ok(xtDiskActivityMatches(protectedWrite, regions));
  assert.deepEqual(xtFileTransfers(regions, [protectedWrite]), []); // No invented RAM provenance on rejection.
  assert.equal(xtDiskActivityMatches(operation({ command: 8, bytes: 0 }), regions), false);
});

test("paused media inspection shares immutable snapshots without changing hardware or following later writes", () => {
  const machine = create8088PcXt({ bios: null, basic: null, font: null }), io = machine.io;
  assert.equal(io.inspectDiskette(), null);
  io.setDiskette(makeXtDataDisk(), { writable: true }); const before = machine.snapshot(), image = io.inspectDiskette()!;
  assert.equal(Object.isFrozen(image), true); assert.equal(io.inspectDiskette(), image);
  assert.deepEqual(machine.snapshot(), before); assert.throws(() => { (image as number[])[0] = 99; }, TypeError);
  io.write(0xf2, 0x1c); io.advanceOscillatorTicks(29324); io.write(0xf5, 8); io.read(0xf5); io.read(0xf5);
  for (const [port, byte] of [[4, 0], [4, 0x30], [5, 0], [5, 0], [11, 0x4a], [10, 2]]) io.write(port!, byte!);
  for (const byte of [0xc5, 0, 0, 0, 1, 2, 9, 42, 255]) io.write(0xf5, byte);
  io.advanceOscillatorTicks(470); machine.ram.write(0x3000, 0x5a); io.serviceDma(machine.memory);
  assert.equal(image[0], 0xeb); assert.equal(io.inspectDiskette()![0], 0x5a); assert.notEqual(io.inspectDiskette(), image);
  io.setDiskette(null); assert.equal(io.inspectDiskette(), null);
});
