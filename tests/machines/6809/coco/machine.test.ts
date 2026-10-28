import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { compileMachine } from "../../../../scripts/generate-machines.js";
import { create6809Coco, romImages } from "../../../../src/machines/generated/6809/coco.js";
import { renderCocoFrame, stepCoco } from "../../../../src/machines/6809/coco/runtime.js";
import type { Coco } from "../../../../src/machines/6809/coco/runtime.js";
import { RomImage } from "../../../../src/machines/rom-image.js";

function videoPins(machine: Coco, pins: number): void {
  machine.pias.write(0x23, 0); machine.pias.write(0x22, 0xf8);
  machine.pias.write(0x23, 4); machine.pias.write(0x22, pins);
}

test("CoCo hardware exists without firmware, with explicit cold state and owned snapshots", () => {
  const machine = create6809Coco({ firmware: null });
  assert.equal(machine.ram.size, 0x8000); assert.equal(machine.ram.read(0x7fff), 0);
  assert.equal(machine.firmware.loaded, false); assert.equal(machine.memory.read(0xa000), 255);
  assert.equal(machine.firmware.read(0), "bus-error"); assert.equal(machine.cpu.snapshot().pc, 0);
  assert.equal(machine.sam.displayStart(), 0); assert.deepEqual(machine.vdg.snapshot(), {});
  machine.ram.write(0x200, 0x12); // NOP can run in RAM without firmware.
  const saved = machine.snapshot();
  const resumed = create6809Coco({ firmware: null }, { ...saved, cpu: { ...saved.cpu, pc: 0x200 } });
  assert.equal(stepCoco(resumed).after.pc, 0x201);
  machine.ram.write(0x200, 0); machine.pias.setKey("A", true);
  assert.equal(saved.ram[0x200], 0x12);
  assert.throws(() => create6809Coco({ firmware: null }, { ...saved, firmware: romImages.firmware.sha256 }), /Snapshot ROM identity/);
  const { sam: omitted, ...incomplete } = saved;
  assert.throws(() => create6809Coco({ firmware: null }, incomplete as never), /Machine snapshot requires/);
});

test("native CoCo synthetic ROM, interrupt wiring, and restored continuation", async t => {
  const bytes = new Uint8Array(0x2000).fill(0x12);
  bytes.set([
    0x10, 0xce, 0x7f, 0xff,       // LDS #$7FFF
    0x86, 0xff, 0xb7, 0xff, 0x02, // DDRB = FF
    0x86, 0x04, 0xb7, 0xff, 0x01, 0xb7, 0xff, 0x03,
    0x86, 0xfd, 0xb7, 0xff, 0x1e, // Select A through a PIA mirror.
    0xb6, 0xff, 0x1c, 0xb7, 0x04, 0x00, // Read keyboard row and retain in RAM.
    0xb7, 0xff, 0xc9,             // SAM F1=1, irrespective of the stored FE byte.
  ]);
  bytes.set([0xb6, 0xff, 0x00, 0x3b], 0x100); // IRQ: acknowledge PIA0 A, RTI.
  bytes.set([0xb6, 0xff, 0x20, 0x3b], 0x110); // FIRQ: acknowledge PIA1 A, RTI.
  bytes.set([0xa1, 0x10, 0xa1, 0x00], 0x1ff6); // FIRQ, IRQ vectors.
  bytes.set([0xa0, 0x00], 0x1ffe);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const firmware = await RomImage.verify(bytes, { size: bytes.length, sha256 }, async data => createHash("sha256").update(data).digest("hex"));
  assert.throws(() => create6809Coco({ firmware }), /does not match/);
  // Exercise the actual literate composition, replacing only its ROM identity for this fixture.
  const chapter = readFileSync("src/machines/6809/coco.md", "utf8").replace(romImages.firmware.sha256, sha256);
  const generated = compileMachine(chapter, "6809/coco.md").replace(/from "([^"]+)"/g,
    (_, path: string) => `from "${new URL(path, new URL("../../../../src/machines/generated/6809/coco.js", import.meta.url)).href}"`);
  const directory = mkdtempSync(join(tmpdir(), "dromaios-coco-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(join(directory, "machine.ts"), generated);
  const { create6809Coco: create } = await import(pathToFileURL(join(directory, "machine.ts")).href) as { create6809Coco: typeof create6809Coco };
  const machine = create({ firmware: null }), before = machine.snapshot();
  machine.firmware.install(firmware);
  assert.deepEqual(machine.snapshot(), { ...before, firmware: sha256 });
  for (let offset = 0; offset < 32; offset++) assert.equal(machine.memory.read(0xffe0 + offset), bytes[0x1fe0 + offset]);
  for (const address of [0x8000, 0x9fff, 0xc000, 0xfeff, 0xff40, 0xffbf, 0xffc0, 0xffdf]) {
    assert.equal(machine.memory.read(address), 255);
  }
  for (const address of [0xa000, 0xbfff, 0xffe0, 0xffff]) {
    const value = machine.memory.read(address); machine.memory.write(address, 0); assert.equal(machine.memory.read(address), value);
  }
  const reads: number[] = [], read = machine.memory.read.bind(machine.memory);
  machine.memory.read = address => { reads.push(address); return read(address); };
  machine.reset(); assert.deepEqual(reads, [0xfffe, 0xffff]); assert.equal(machine.cpu.snapshot().pc, 0xa000);
  machine.memory.read = read; machine.pias.setKey("A", true);
  for (let i = 0; i < 11; i++) assert.equal(stepCoco(machine).outcome, "executed");
  assert.equal(machine.ram.read(0x400), 0xfe); assert.equal(machine.sam.displayStart(), 0x400);
  assert.equal(machine.cpu.snapshot().s, 0x7fff);

  // Both board requests are held. FIRQ wins; acknowledging one does not clear the other.
  machine.pias.write(1, 5); machine.pias.write(0x21, 5);
  machine.pias.setHorizontalSync(false); machine.pias.setCarrierDetect(false);
  const snapshot = machine.snapshot();
  const state = { ...snapshot, cpu: { ...snapshot.cpu, flags: { ...snapshot.cpu.flags, f: false, i: false } } };
  const original = create({ firmware }, state), restored = create({ firmware }, state);
  for (const expected of ["accepted", "executed", "executed", "accepted", "executed", "executed", "executed"]) {
    const record = stepCoco(original); assert.deepEqual(stepCoco(restored), record); assert.equal(record.outcome, expected);
  }
  assert.equal(original.pias.irq, false); assert.equal(original.pias.firq, false);
  assert.deepEqual(original.snapshot(), restored.snapshot());
  assert.equal(original.pias.snapshot().keyboard.rows[0], 2);
  const preserved = original.snapshot(); original.reset();
  assert.deepEqual(original.snapshot(), { ...preserved, cpu: original.cpu.snapshot() });
  assert.throws(() => create({ firmware: null }, state), /Snapshot ROM identity/);
  assert.throws(() => create({ firmware }, { ...state, firmware: null }), /Snapshot ROM identity/);
});

test("CoCo frames follow physical pages and resolved PIA pins without acknowledging interrupts", () => {
  const machine = create6809Coco({ firmware: null }); videoPins(machine, 0);
  machine.sam.write(9, 0); // Text at 0400.
  machine.ram.write(0x400, 0x01); machine.ram.write(0x401, 0x41); // A and inverse A.
  machine.ram.write(0x402, 0xd9); // Cyan, TL and BR SG4 blocks.
  const frame = renderCocoFrame(machine);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 8; x++) {
    assert.equal(frame[y * 256 + x] === 0, frame[y * 256 + 8 + x] === 9);
    assert.equal(frame[y * 256 + 16 + x], (y < 6) === (x < 4) ? 5 : 8);
  }
  assert.equal(frame[3 * 256 + 4], 0); assert.equal(frame[3 * 256 + 3], 9); // A's top dot.
  videoPins(machine, 8); const orange = renderCocoFrame(machine);
  assert.equal(orange[3 * 256 + 4], 7); assert.equal(orange[3 * 256 + 3], 10);
  assert.equal(orange[16], 5);
  // High F values wrap through physical RAM, never through CPU I/O.
  for (let address = 7; address <= 19; address += 2) machine.sam.write(address, 0);
  machine.ram.write(0x7e00, 0x8f); machine.ram.write(0x7fff, 0xff);
  machine.pias.write(3, 5); machine.pias.setFieldSync(false);
  const saved = machine.snapshot(); assert.equal(machine.pias.irq, true);
  machine.memory.read = () => { throw new Error("Rendering must not read the CPU bus"); };
  const high = renderCocoFrame(machine); assert.equal(high[0], 0); assert.equal(high.at(-1), 7);
  assert.deepEqual(machine.snapshot(), saved); assert.equal(machine.pias.irq, true);
  // Inspection did not acknowledge; a real data read does.
  machine.pias.read(2); assert.equal(machine.pias.irq, false);
  machine.sam.write(1, 0); assert.throws(() => renderCocoFrame(machine), /Unsupported CoCo display/);
  machine.sam.write(0, 0); videoPins(machine, 0x80);
  assert.throws(() => renderCocoFrame(machine), /Unsupported CoCo display/);
});

test("unsupported SAM memory settings stop before another CPU boundary and remain inspectable", () => {
  for (const address of [0x1d, 0x1f]) {
    const machine = create6809Coco({ firmware: null }); machine.sam.write(address, 0);
    const before = machine.snapshot();
    assert.throws(() => stepCoco(machine), /Unsupported CoCo memory/);
    assert.throws(() => renderCocoFrame(machine), /Unsupported CoCo memory/);
    assert.deepEqual(machine.snapshot(), before);
    machine.sam.write(address - 1, 255); assert.equal(machine.sam.supportedMemory(), true);
  }
});

test("masked FIRQ releases SYNC without being queued and does not block an enabled IRQ", () => {
  const base = create6809Coco({ firmware: null }).snapshot();
  const machine = create6809Coco({ firmware: null }, { ...base, cpu: { ...base.cpu, pc: 0x200, s: 0x4000 } });
  machine.ram.write(0x200, 0x13); machine.ram.write(0x201, 0x12); // SYNC; NOP
  assert.equal(stepCoco(machine).outcome, "waiting");
  machine.pias.write(0x21, 5); machine.pias.setCarrierDetect(false);
  const resumed = stepCoco(machine); assert.equal(resumed.outcome, "resumed");
  assert.equal(resumed.after.pc, 0x201); assert.equal(resumed.after.waitMode, "none");
  assert.equal(stepCoco(machine).outcome, "executed"); assert.equal(machine.cpu.snapshot().pc, 0x202);
  const saved = machine.snapshot();
  const irq = create6809Coco({ firmware: null }, { ...saved, cpu: { ...saved.cpu, flags: { ...saved.cpu.flags, i: false } } });
  irq.pias.write(1, 5); irq.pias.setHorizontalSync(false);
  const accepted = stepCoco(irq);
  assert.equal(accepted.outcome, "accepted"); assert.ok("source" in accepted); assert.equal(accepted.source, "irq");
  assert.equal(irq.pias.irq, true); assert.equal(irq.pias.firq, true);
});
