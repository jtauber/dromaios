import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { compileMachine } from "../../../../scripts/generate-machines.js";
import { create6809Coco, romImages } from "../../../../src/machines/generated/6809/coco.js";
import { stepCoco } from "../../../../src/machines/6809/coco/runtime.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { readCocoStorage } from "../../../../site/interactive/coco-inspection.js";

test("the literate CoCo maps two independent ROM sockets, executes extension code, and protects both images", async t => {
  const bytes = Uint8Array.from({ length: 8192 }, (_, i) => (i * 13 + 7) & 255);
  bytes.set([0x86, 0x42, 0x39]); // $8000: LDA #$42; RTS.
  const digest = async (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
  const identity = { size: bytes.length, sha256: await digest(bytes) }, extended = await RomImage.verify(bytes, identity, digest);
  const chapter = readFileSync("src/machines/6809/coco.md", "utf8").replace(romImages.extended.sha256, identity.sha256);
  const generated = compileMachine(chapter, "6809/coco.md").replace(/from "([^"]+)"/g,
    (_, path: string) => `from "${new URL(path, new URL("../../../../src/machines/generated/6809/coco.js", import.meta.url)).href}"`);
  const directory = mkdtempSync(join(tmpdir(), "dromaios-coco-extension-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}'); writeFileSync(join(directory, "machine.ts"), generated);
  const { create6809Coco: create } = await import(pathToFileURL(join(directory, "machine.ts")).href) as { create6809Coco: typeof create6809Coco };
  const empty = create({ firmware: null, extended: null });
  assert.equal(empty.memory.read(0x8000), 255); assert.equal(readCocoStorage(empty, 0x8000), undefined);
  assert.equal(empty.snapshot().extended, null);
  const beforeInstall = empty.snapshot(); empty.extended.install(extended);
  assert.deepEqual(empty.snapshot(), { ...beforeInstall, extended: identity.sha256 });
  assert.equal(empty.firmware.loaded, false);
  for (let offset = 0; offset < bytes.length; offset++) {
    assert.equal(empty.memory.read(0x8000 + offset), bytes[offset]);
    assert.equal(readCocoStorage(empty, 0x8000 + offset), bytes[offset]);
    empty.memory.write(0x8000 + offset, 0); assert.equal(empty.memory.read(0x8000 + offset), bytes[offset]);
  }
  for (const address of [0xa000, 0xbfff, 0xc000, 0xfffe, 0xffff]) {
    assert.equal(empty.memory.read(address), 255); assert.equal(readCocoStorage(empty, address), undefined);
  }
  const initial = empty.snapshot();
  const machine = create({ firmware: null, extended }, { ...initial, cpu: { ...initial.cpu, pc: 0x200, s: 0x4000 } });
  [0xbd, 0x80, 0, 0xb7, 0x06, 0].forEach((byte, i) => machine.ram.write(0x200 + i, byte)); // JSR $8000; STA $0600.
  const records = Array.from({ length: 4 }, () => stepCoco(machine));
  assert.deepEqual(records.map(record => record.instruction?.address), [0x200, 0x8000, 0x8002, 0x203]);
  assert.equal(machine.ram.read(0x600), 0x42); assert.equal(machine.cpu.snapshot().s, 0x4000);
  const saved = machine.snapshot();
  assert.deepEqual(create({ firmware: null, extended }, saved).snapshot(), saved);
  assert.throws(() => create({ firmware: null, extended: null }, saved), /Snapshot ROM identity/);
  assert.throws(() => create({ firmware: null, extended }, { ...saved, extended: null }), /Snapshot ROM identity/);
  assert.throws(() => create6809Coco({ firmware: null, extended }), /does not match/);
  assert.throws(() => machine.firmware.install(extended), /does not match/); assert.equal(machine.firmware.loaded, false);
  const stable = machine.snapshot();
  machine.memory.read = () => { throw new Error("Inspection must not read the CPU bus"); };
  assert.equal(readCocoStorage(machine, 0x8000), 0x86); assert.deepEqual(machine.snapshot(), stable);
});
