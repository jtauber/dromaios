import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoSavedState } from "../../site/interactive/coco-saved-state.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import { cocoScreenText, readCocoStorage } from "../../site/interactive/coco-inspection.js";
import { observeCocoRoms } from "../../site/interactive/coco-rom-guide.js";
import { cocoDebugLocation } from "../../site/interactive/coco-debugger.js";
import { previewCocoInstruction } from "../../site/interactive/coco-instruction-preview.js";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/6809/coco-disk.js";
import { answerDisk } from "../machines/6809/coco/disk-fixture.js";
import { catalogue6809 } from "./6809-inspection-fixture.js";
import { cocoDefaultLayout, cocoWorkspaceKey, migrateCocoWorkspace } from "../../site/interactive/coco-workspace.js";
import { groups, closePanel, panelGroup, collapseGroup } from "../../site/interactive/workspace/layout.js";
import { decodeWorkspaceState, encodeWorkspaceState } from "../../site/interactive/workspace/state.js";

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("Drive 0 survives power-on and packed checkpoints; replacement and failed restores are atomic", () => {
  const session = createCocoSession(), disk = answerDisk(), local = storage();
  const saved = cocoSavedState(() => local, session.machine.clock.hertz!);
  session.mountDisk("ANSWER.dsk", disk); disk[0] = 0;
  session.machine.ram.write(0x6000, 99); session.powerOn();
  assert.equal(session.diskName, "ANSWER.dsk"); assert.equal(session.machine.disk.snapshot().image![0], 0x31);
  assert.equal(session.machine.ram.read(0x6000), 0);
  session.machine.disk.write(0, 0xa9); session.machine.disk.write(8, 0x80); session.machine.disk.advanceCpuClocks(60);
  const checkpoint = session.snapshot(); assert.equal(checkpoint.hardware.disk.circuit.drq, true);
  assert.throws(() => session.ejectDisk(), /Finish or abort/); assert.deepEqual(session.snapshot(), checkpoint);
  saved.save(checkpoint);
  const [key, text] = [...local.values][0]!, packed = JSON.parse(text);
  assert.equal(typeof packed.state.hardware.disk.image, "string"); assert.equal(packed.version, 7);
  session.powerOn(); session.mountDisk("OTHER.dsk", new Uint8Array(161280));
  session.restore(saved.read()!.state); assert.deepEqual(session.snapshot(), checkpoint);
  for (const invalid of [null, "", 99]) {
    assert.throws(() => session.restore({ ...checkpoint, diskName: invalid })); assert.deepEqual(session.snapshot(), checkpoint);
  }
  for (const image of [[], "AA==", "!bad", "A".repeat(215041)]) {
    local.setItem(key, JSON.stringify({ ...packed, state: { ...packed.state, hardware: {
      ...packed.state.hardware, disk: { ...packed.state.hardware.disk, image },
    } } }));
    assert.throws(() => saved.read()); assert.deepEqual(session.snapshot(), checkpoint);
  }
  local.setItem(key, text);
  local.setItem = () => { throw new Error("Quota"); };
  assert.throws(() => saved.save(checkpoint), /Quota/); assert.equal(local.getItem(key), text);
  session.powerOn(); const before = session.snapshot();
  assert.throws(() => session.mountDisk("bad.dsk", new Uint8Array(256))); assert.deepEqual(session.snapshot(), before);
  session.ejectDisk(); assert.equal(session.diskName, null); session.powerOn(); assert.equal(session.machine.disk.snapshot().image, null);
});

test("version-6 checkpoints gain an empty cartridge, without rewriting the stored checkpoint", () => {
  const session = createCocoSession(), local = storage(), saved = cocoSavedState(() => local, session.machine.clock.hertz!);
  session.machine.ram.write(0x2000, 42); const expected = session.snapshot(); saved.save(expected);
  const [key, text] = [...local.values][0]!, envelope = JSON.parse(text);
  delete envelope.state.diskName; delete envelope.state.hardware.disk; delete envelope.state.hardware.dos; envelope.version = 6;
  const legacy = JSON.stringify(envelope); local.setItem(key, legacy);
  const restored = saved.read()!; assert.equal(restored.version, 7);
  session.restore(restored.state); assert.deepEqual(session.snapshot(), expected); assert.equal(local.getItem(key), legacy);
  envelope.version = 7; local.setItem(key, JSON.stringify(envelope)); assert.throws(() => saved.read());
});

test("disk HALT and NMI previews observe the controller without acknowledging it", () => {
  const session = createCocoSession(), initial = session.snapshot();
  session.restore({ ...initial, hardware: { ...initial.hardware, cpu: { ...initial.hardware.cpu, pc: 0x200, s: 0x7000, nmiArmed: true } } });
  const machine = session.machine; machine.ram.write(0x200, 0x12); machine.disk.write(0, 0xa9);
  machine.memory.read = () => { throw new Error("No guest bus access during inspection"); };
  const halted = session.snapshot();
  assert.match(previewCocoInstruction(machine, catalogue6809).assembly, /HALT/);
  assert.deepEqual(session.snapshot(), halted);
  machine.disk.write(8, 0xd8); const pending = session.snapshot();
  assert.match(previewCocoInstruction(machine, catalogue6809).assembly, /NMI/);
  for (let address = 0xff40; address < 0xff60; address++) assert.equal(readCocoStorage(machine, address), undefined);
  assert.deepEqual(session.snapshot(), pending); assert.equal(machine.disk.inspect().nmi_pending, true);
});

test("Drive 0 joins existing cassette tabs once, preserving hidden tools and selected/collapsed groups", () => {
  const ids = groups(cocoDefaultLayout).flatMap(group => group.panels), local = storage();
  const previous = closePanel(closePanel(cocoDefaultLayout, "disk"), "pias"), cassette = panelGroup(previous, "cassette")!;
  local.setItem("dromaios:workspace:coco:9", encodeWorkspaceState(collapseGroup(previous, cassette.id, true)));
  migrateCocoWorkspace(local, ids);
  const next = decodeWorkspaceState(local.getItem(cocoWorkspaceKey)!, ids);
  assert.deepEqual(panelGroup(next, "disk")?.panels, [...cassette.panels, "disk"]);
  assert.equal(panelGroup(next, "disk")?.active, cassette.active); assert.equal(panelGroup(next, "disk")?.collapsed, true);
  assert.equal(panelGroup(next, "pias"), undefined);
  const hidden = encodeWorkspaceState(closePanel(next, "disk")); local.setItem(cocoWorkspaceKey, hidden);
  migrateCocoWorkspace(local, ids); assert.equal(local.getItem(cocoWorkspaceKey), hidden);
});

const needsRoms = !(process.env.COCO_ROM && process.env.COCO_EXTENDED_ROM && process.env.COCO_DISK_ROM)
  && "Set COCO_ROM, COCO_EXTENDED_ROM and COCO_DISK_ROM for the browser Disk BASIC session.";

test("browser Disk BASIC runs ANSWER, replays a stored mid-sector checkpoint, and loads again after fresh power-on", { skip: needsRoms }, async () => {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware, digest);
  const extended = await RomImage.verify(readFileSync(process.env.COCO_EXTENDED_ROM!), romImages.extended, digest);
  const dosBytes = readFileSync(process.env.COCO_DISK_ROM!);
  const dos = await RomImage.verify(dosBytes, romImages.dos, digest);
  const session = createCocoSession(firmware, extended, dos), local = storage(), saved = cocoSavedState(() => local, session.machine.clock.hertz!);
  session.mountDisk("ANSWER.dsk", answerDisk());
  let reads = 0;
  function step() { const record = session.step(); reads += record.accesses.filter(a => a.kind === "read" && a.address === 0xff4b).length; return record; }
  function run(count: number) { for (let i = 0; i < count; i++) step(); }
  function until(done: () => boolean): number {
    for (let i = 1; i <= 3_000_000; i++) { step(); if (done()) return i; }
    assert.fail(cocoScreenText(session.machine));
  }
  function prompt() { return session.inputSettled && /\nOK(?:\n█)?$/.test(cocoScreenText(session.machine)); }
  function line(text: string) { session.send(cocoTextInput(text + "\n")); until(() => session.inputSettled); run(20_000); until(prompt); }
  function boot() { run(720_000); assert.match(cocoScreenText(session.machine), /^DISK EXTENDED COLOR BASIC 1\.1/); }
  boot(); line("DIR"); assert.match(cocoScreenText(session.machine), /ANSWER\s+BAS\s+0 A 1/);
  const before = session.snapshot();
  for (const address of [0xc000, 0xd881, 0xe000, 0xfeff]) {
    assert.equal(readCocoStorage(session.machine, address), dosBytes[address & 0x1fff]);
    assert.equal(cocoDebugLocation(session.machine, address).space, "rom"); assert.equal(observeCocoRoms(session.machine).mapped(address), true);
  }
  assert.deepEqual(session.snapshot(), before);
  reads = 0; session.send(cocoTextInput('LOAD "ANSWER"\n')); until(() => reads === 128);
  saved.save(session.snapshot()); const checkpoint = saved.read()!.state;
  assert.equal(checkpoint.hardware.disk.circuit.phase, 3);
  const count = until(prompt), complete = session.snapshot();
  session.powerOn(); session.mountDisk("OTHER.dsk", new Uint8Array(161280));
  session.restore(checkpoint); run(count); assert.deepEqual(session.snapshot(), complete);
  line("RUN"); assert.match(cocoScreenText(session.machine), /RUN\n 42\nOK/);
  session.powerOn(); assert.equal(session.diskName, "ANSWER.dsk"); assert.equal(session.machine.disk.inspect().phase, 0);
  boot(); line("DIR"); line('LOAD "ANSWER"'); line("RUN"); assert.match(cocoScreenText(session.machine), /RUN\n 42\nOK/);
  const current = session.snapshot(), missingDos = createCocoSession(firmware, extended), empty = missingDos.snapshot();
  assert.throws(() => missingDos.restore(current)); assert.deepEqual(missingDos.snapshot(), empty);
  session.configureRoms({ firmware, extended, dos: null }); assert.equal(session.diskName, "ANSWER.dsk");
  session.configureRoms({ firmware, extended: null, dos }); assert.equal(session.ready, false); assert.throws(() => session.step(), /requires Extended/);
  session.configureRoms({ firmware, extended, dos }); assert.equal(session.ready, true); assert.equal(session.diskName, "ANSWER.dsk");
});
