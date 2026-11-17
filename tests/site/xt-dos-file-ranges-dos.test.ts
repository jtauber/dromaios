import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Cpu8088 } from "../../src/components/cpus/generated/8088-cpu.js";
import { romImages } from "../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../src/machines/rom-image.js";
import { screen } from "../machines/8088/pc-xt/rom-console.js";
import { createXtSession, type XtSessionState } from "../../site/interactive/xt-session.js";
import { createXtDiskActivity } from "../../site/interactive/xt-disk-activity.js";
import { createXtDosCalls } from "../../site/interactive/xt-dos-services.js";
import { createXtDosFileLinks, type DosFileLink } from "../../site/interactive/xt-dos-file-links.js";
import { inspectFat12, readFat12File } from "../../site/interactive/fat12.js";
import { xtRomGuide } from "./xt-inspection-fixture.js";
import { xtFileRangeDisk } from "./xt-file-range-fixture.js";

const { XT_BIOS_ROM, XT_BASIC_ROM, XT_CGA_ROM, XT_DOS_DISK } = process.env;
test("original DOS links sector-crossing and cached reads, a fragmented chain, overwrite, and checkpoint replay", {
  skip: !(XT_BIOS_ROM && XT_BASIC_ROM && XT_CGA_ROM && XT_DOS_DISK) && "Set the XT firmware and DOS disk paths.",
}, async () => {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const image = (slot: keyof typeof romImages, path: string) => RomImage.verify(readFileSync(path), romImages[slot], digest);
  const bindings = { bios: await image("bios", XT_BIOS_ROM!), basic: await image("basic", XT_BASIC_ROM!), font: await image("font", XT_CGA_ROM!) };
  const dos = readFileSync(XT_DOS_DISK!);
  assert.equal(await digest(dos), "d79f283ebd2cd68e8dede44ed876da13c25024f7000bcb576177820388c424f4");
  const session = createXtSession(bindings);
  session.insertDisk("DOS.IMG", dos); session.powerOn("quick");
  function until(done: () => boolean, limit = 3_000_000): void {
    for (let n = 0; n < limit; n++) {
      session.step();
      if (n % 512 === 0 && !session.keyboard.pasteRemaining && !session.keyboard.queuedBytes && done()) return;
    }
    assert.fail(screen(session.machine).join("\n"));
  }
  const lastLine = () => screen(session.machine).filter(Boolean).at(-1);
  until(() => lastLine() === "Enter new date (mm-dd-yy):", 25_000_000);
  session.keyboard.paste("\n"); until(() => lastLine() === "Enter new time:");
  session.keyboard.paste("\n"); until(() => lastLine() === "A>"); until(() => !session.machine.io.disketteMotorOn);
  const { disk, bytes } = xtFileRangeDisk(); session.insertDisk("RANGES.IMG", disk, { writable: true });
  const activity = createXtDiskActivity(() => session.machine.io), links = createXtDosFileLinks(() => session.machine.io, activity);
  const calls = createXtDosCalls(xtRomGuide.dos, address => address < session.machine.ram.size ? session.machine.ram.read(address) : undefined, links.observe);
  const step = () => { const record = activity.capture(() => session.step()); calls.observe(record); return record; };
  const reset = () => { calls.reset(); links.reset(); activity.reset(); };
  const bytesAt = (address: number, count: number) => Array.from({ length: count }, (_, i) => session.machine.ram.read(address + i));
  function comparable(link: DosFileLink) {
    return { range: link.range, memory: link.memory, entry: link.entry, regions: link.regions, complete: link.complete, dmaBytes: link.dmaBytes, note: link.note,
      transfers: link.transfers.map(({ operation: _operation, ...transfer }) => transfer) };
  }
  function invoke(ah: number, bx = 5, cx = 0, dx = 0x100, al = 0, data: Uint8Array = new Uint8Array(), checkpoint = false) {
    const m = session.machine;
    [0xcd, 0x21].forEach((value, i) => m.ram.write(0x80000 + i, value));
    data.forEach((value, i) => m.ram.write(0x80100 + i, value));
    m.cpu = new Cpu8088(m.memory, { ...m.cpu.snapshot(), cs: 0x8000, ip: 0, ss: 0x8000, sp: 0xfffe,
      ax: ah << 8 | al, bx, cx, ds: 0x8000, dx }, { ports: m.ports });
    const before = checkpoint ? session.snapshot() : undefined;
    let midway: { state: XtSessionState; steps: number } | undefined;
    for (let n = 0; n < 1_000_000; n++) {
      const record = step(), call = calls.entries().at(-1);
      if (checkpoint && !midway && record.dma?.direction === (ah === 0x40 ? "memory-to-disk" : "disk-to-memory")
        && record.dma.offset % 512 === 255) midway = { state: session.snapshot(), steps: n + 1 };
      if (call?.state !== "returned" || record.after.cs !== 0x8000 || record.after.ip !== 2) continue;
      assert.equal(call.result!.carry, false, `AH=${ah.toString(16)} returned error ${call.result!.ax}`);
      const link = links.get(call);
      if (before) {
        assert.ok(midway, "The workload must checkpoint halfway through an actual sector transfer");
        assert.ok(link); const end = session.snapshot(), expected = comparable(link);
        session.restore(before); reset();
        for (let i = 0; i <= n; i++) step();
        assert.deepEqual(session.snapshot(), end); assert.deepEqual(comparable(links.get(calls.entries().at(-1)!)!), expected);
        session.restore(midway.state); reset();
        for (let i = midway.steps; i <= n; i++) step();
        assert.deepEqual(session.snapshot(), end); assert.deepEqual(calls.entries(), []);
        assert.equal(activity.entries()[0]!.continued, true);
        const plain = createXtSession(bindings); plain.restore(before);
        for (let i = 0; i <= n; i++) plain.step();
        assert.deepEqual(plain.snapshot(), end, "Observing must not alter CPU, RAM, devices, clocks, disk or output");
      }
      return { call, link };
    }
    assert.fail(`DOS AH=${ah.toString(16)} failed to return`);
  }
  const seek = (position: number, handle = 5) => invoke(0x42, handle, position >>> 16, position & 65535);
  const opened = invoke(0x3d, 0, 0, 0x100, 2, Buffer.from("README.TXT\0"));
  assert.equal(opened.call.result!.ax, 5);
  assert.deepEqual(opened.call.result!.file!.disk, { drive: 0, firstCluster: 2, directory: 2592, name: "README  TXT" });
  seek(500);
  const crossing = invoke(0x3f, 5, 40, 0x100, 0, new Uint8Array(), true).link!;
  assert.deepEqual(crossing.regions.map(r => [r.offset, r.fileOffset, r.length]), [[6644, 500, 12], [6656, 512, 28]]);
  assert.equal(crossing.complete, true); assert.equal(crossing.dmaBytes, 1024);
  assert.deepEqual(crossing.transfers.map(t => [t.fileOffset, t.bytes]), [[500, 12], [512, 28]]);
  assert.deepEqual(bytesAt(0x80100, 40), [...bytes.subarray(500, 540)]);
  assert.ok(crossing.transfers.some(t => t.address !== 0x80100 + t.fileOffset! - 500), "DOS's DMA buffer differs from the program destination");
  seek(520); const cached = invoke(0x3f, 5, 8).link!;
  assert.equal(cached.complete, true); assert.equal(cached.dmaBytes, 0); assert.deepEqual(cached.transfers, []);
  assert.deepEqual(cached.regions.map(r => [r.offset, r.length]), [[6664, 8]]);
  assert.deepEqual(bytesAt(0x80100, 8), [...bytes.subarray(520, 528)]);
  seek(1000); const fragmented = invoke(0x3f, 5, 40).link!;
  assert.deepEqual(fragmented.regions.map(r => [r.offset, r.fileOffset, r.length, r.cluster]), [[7144, 1000, 24, 2], [9216, 1024, 16, 5]]);
  assert.deepEqual(bytesAt(0x80100, 40), [...bytes.subarray(1000, 1040)]);
  // Seeking a duplicate controls the write through the original handle.
  const alias = invoke(0x45, 5).call.result!.ax; seek(508, alias);
  const replacement = Buffer.from("abcdefghijkl"), overwritten = invoke(0x40, 5, 12, 0x100, 0, replacement, true).link!;
  assert.deepEqual(overwritten.regions.map(r => [r.offset, r.fileOffset, r.length]), [[6652, 508, 4], [6656, 512, 8]]);
  assert.ok(overwritten.transfers.every(t => t.direction === "memory-to-disk"));
  assert.deepEqual(overwritten.transfers.map(t => [t.fileOffset, t.bytes]), [[508, 4]], "The final eight bytes remain in DOS's buffer at the return");
  const partial = session.machine.io.exportDiskette();
  assert.deepEqual(partial.slice(6652, 6656), new Uint8Array(replacement.subarray(0, 4)));
  assert.deepEqual(partial.slice(6656, 6664), new Uint8Array(bytes.subarray(512, 520)));
  seek(500, alias); const reread = invoke(0x3f, 5, 40).link!;
  const expected = Buffer.from(bytes); replacement.copy(expected, 508);
  assert.deepEqual(bytesAt(0x80100, 40), [...expected.subarray(500, 540)]);
  assert.deepEqual(reread.range, { offset: 500, length: 40 });
  invoke(0x3e, alias); invoke(0x3e, 5);
  const exported = session.machine.io.exportDiskette(), volume = inspectFat12(exported), file = volume.entries.find(e => e.name === "README.TXT")!;
  assert.deepEqual(readFat12File(exported, volume, file), new Uint8Array(expected));
  assert.deepEqual(exported.slice(6652, 6664), new Uint8Array(replacement), "Independent on-disk overwrite offset");
  assert.deepEqual(overwritten.transfers.map(t => [t.fileOffset, t.bytes]), [[508, 4]], "Later flushes must not rewrite the write call's captured DMA window");
  assert.deepEqual(crossing.regions.map(r => [r.offset, r.length]), [[6644, 12], [6656, 28]], "Past connections remain unchanged");
  activity.dispose();
});
