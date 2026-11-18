import assert from "node:assert/strict";
import { test } from "node:test";
import { dosBufferRegions, createXtDosFileLinks } from "../../site/interactive/xt-dos-file-links.js";
import { fat12FileSectors, fat12FileRegions, inspectFat12 } from "../../site/interactive/fat12.js";
import { createXtSession } from "../../site/interactive/xt-session.js";
import { createXtDiskActivity } from "../../site/interactive/xt-disk-activity.js";
import type { DosCall } from "../../site/interactive/xt-dos-services.js";
import { xtRomGuide } from "./xt-inspection-fixture.js";
import { xtFileRangeDisk } from "./xt-file-range-fixture.js";

function fixture() {
  const { disk } = xtFileRangeDisk(), session = createXtSession();
  session.insertDisk("RANGES.IMG", disk, { writable: true });
  const activity = createXtDiskActivity(() => session.machine.io), links = createXtDosFileLinks(() => session.machine.io, activity);
  const service = xtRomGuide.dos.services.find(s => s.function === "3F")!;
  const call: DosCall = { id: 1, service, state: "pending", caller: { cs: 0x8000, ip: 0 }, arguments: [],
    returnTo: { cs: 0x8000, ip: 2, ss: 0x8000, sp: 0xfffe },
    buffer: { segment: 0xffff, offset: 8, length: 40, bytes: [], end: "complete" },
    file: { scope: "DOS:PSP", entry: 0x2400, offset: 1000,
      disk: { drive: 0, firstCluster: 2, directory: 2592, name: "README  TXT" } } };
  function finish(overrides: Partial<DosCall> = {}) {
    const returned: DosCall = { ...call, state: "returned", result: { ax: 40, dx: 8, carry: false, file: { ...call.file!, offset: 1040 } }, ...overrides };
    links.observe(returned); return links.get(returned);
  }
  return { session, activity, links, call, finish };
}

test("DOS byte ranges split at sectors and fragmented clusters without including slack or metadata", () => {
  const { disk } = xtFileRangeDisk(), volume = inspectFat12(disk), file = volume.entries[1]!;
  assert.deepEqual(fat12FileSectors(fat12FileRegions(volume, file), 500, 540).map(r => [r.offset, r.fileOffset, r.length, r.cluster]),
    [[6644, 500, 12, 2], [6656, 512, 512, 2], [9216, 1024, 16, 5]]);
  assert.deepEqual(fat12FileSectors(fat12FileRegions(volume, file), 2048, 50).map(r => [r.offset, r.length]), [[8192, 2]]);
  assert.deepEqual(fat12FileSectors(fat12FileRegions(volume, file), 0, 0), []);
  assert.deepEqual(dosBufferRegions(0xffff, 8, 1000, 40), [{ address: 0xffff8, length: 8, fileOffset: 1000 }, { address: 0, length: 32, fileOffset: 1008 }]);
  assert.deepEqual(dosBufferRegions(0x1000, 0xfffe, 4, 4), [{ address: 0x1fffe, length: 2, fileOffset: 4 }, { address: 0x10000, length: 2, fileOffset: 6 }]);
});

test("connections use guarded directory identity, not basenames, and keep captured allocation immutable", () => {
  const f = fixture(); f.links.observe(f.call); const link = f.finish()!;
  assert.equal(link.entry!.name, "README.TXT"); assert.equal(link.call.filename, undefined, "A restored call needs no invented opening-name history");
  assert.equal(link.complete, true); assert.equal(link.dmaBytes, 0); assert.deepEqual(link.transfers, []);
  assert.deepEqual(link.regions.map(r => [r.offset, r.length]), [[7144, 24], [9216, 16]]);
  f.session.ejectDisk(); f.activity.reset();
  assert.equal(link.entry!.size, 2050); assert.equal(link.epoch !== f.activity.epoch, true);
  f.activity.dispose();
});

test("changed media, wrong drives, subdirectories, mismatched names, and stale allocation do not acquire links", () => {
  for (const disk of [{ drive: 1 }, { directory: 6144 }, { name: "OTHER   TXT" }, { firstCluster: 3 }]) {
    const f = fixture(), call = { ...f.call, file: { ...f.call.file!, disk: { ...f.call.file!.disk!, ...disk } } };
    f.links.observe(call); const link = f.finish({ result: { ax: 40, dx: 8, carry: false, file: { ...call.file, offset: 1040 } } })!;
    assert.equal(link.regions.length, 0); assert.ok(link.note); f.activity.dispose();
  }
  const f = fixture(); f.links.observe(f.call); f.activity.reset(); const changed = f.finish()!;
  assert.equal(changed.complete, false); assert.equal(changed.regions.length, 0); assert.match(changed.note!, /changed during/);
  f.links.reset(); assert.equal(f.links.get(f.call), undefined); f.activity.dispose();
  const g = fixture(); g.links.observe(g.call);
  const beyond = g.finish({ result: { ax: 1100, dx: 8, carry: false, file: { ...g.call.file!, offset: 2100 } }, buffer: { ...g.call.buffer!, length: 1100 } })!;
  assert.equal(beyond.regions.length, 0); assert.match(beyond.note!, /not yet present/); g.activity.dispose();
});

test("partial recording and unobserved controller access cannot masquerade as a cached read", () => {
  const f = fixture(); f.links.observe(f.call); f.activity.record(false); f.activity.record(true);
  assert.equal(f.finish()!.complete, false); f.activity.dispose();
  const g = fixture(); g.links.observe(g.call); g.session.machine.io.write(0xf2, 0);
  assert.equal(g.finish()!.complete, false); g.activity.dispose();
  const h = fixture(); h.activity.record(false); h.links.observe(h.call); assert.equal(h.finish()!.complete, false); h.activity.dispose();
});

test("failed and zero-byte calls supply no transfer connection, and restoring inside a call cannot invent one", () => {
  const f = fixture(); f.links.observe(f.call); assert.equal(f.finish({ result: { ax: 6, dx: 8, carry: true } }), undefined);
  f.links.observe(f.call); assert.equal(f.finish({ result: { ax: 0, dx: 8, carry: false, file: f.call.file } }), undefined);
  f.links.observe(f.call); f.links.reset(); assert.equal(f.finish(), undefined); f.activity.dispose();
});
