import assert from "node:assert/strict";
import { test } from "node:test";
import { create6809Coco64 } from "../../../../src/machines/generated/6809/coco64.js";
import { create6809CocoDisk } from "../../../../src/machines/generated/6809/coco-disk.js";
import { cocoRamAddress } from "../../../../src/machines/6809/coco/memory.js";
import { renderCocoFrame, stepCoco } from "../../../../src/machines/6809/coco/runtime.js";
import { readCocoStorage } from "../../../../site/interactive/coco-inspection.js";

const bindings = { firmware: null, extended: null, dos: null };

test("64 KiB SAM maps physical halves, protects ROM space, and retains I/O and vectors in all-RAM mode", () => {
  const machine = create6809Coco64(bindings);
  machine.ram.write(0x1234, 0x12); machine.ram.write(0x9234, 0x92);
  machine.ram.write(0xffff, 0x55);
  assert.equal(machine.memory.read(0x1234), 0x12); assert.equal(machine.memory.read(0x9234), 255);
  machine.memory.write(0x9234, 0); assert.equal(machine.ram.read(0x9234), 0x92);
  machine.memory.write(0xffdd, 0); machine.memory.write(0xffd5, 0); // M=10, P1=1.
  assert.equal(machine.memory.read(0x1234), 0x92);
  assert.equal(cocoRamAddress(machine, 0x1234), 0x9234);
  assert.equal(readCocoStorage(machine, 0x1234), 0x92);
  machine.memory.write(0x1234, 0xa5); assert.equal(machine.ram.read(0x9234), 0xa5);
  assert.equal(machine.ram.read(0x1234), 0x12);
  assert.equal(machine.memory.read(0x7fff), 0x55, "upper physical RAM's last byte is accessible through P1");
  machine.memory.write(0xffdf, 0); // TY=1 ignores P1.
  assert.equal(machine.memory.read(0x1234), 0x12); assert.equal(machine.memory.read(0x9234), 0xa5);
  for (const address of [0x8000, 0xa000, 0xc000, 0xe000, 0xfeff]) {
    machine.memory.write(address, 0x42); assert.equal(machine.ram.read(address), 0x42);
    assert.equal(readCocoStorage(machine, address), 0x42);
  }
  machine.memory.write(0xff00, 0x33); assert.equal(machine.pias.inspect().pia0.ddra, 0x33);
  assert.equal(machine.ram.read(0xff00), 0);
  machine.memory.write(0xffff, 0); assert.equal(machine.ram.read(0xffff), 0x55);
  assert.equal(machine.memory.read(0xffff), 255, "the ROM vector socket, never hidden RAM");
  machine.memory.write(0xffde, 0); assert.equal(machine.memory.read(0x1234), 0xa5);
  assert.equal(machine.memory.read(0xc000), 255);
  const saved = machine.snapshot(), restored = create6809Coco64(bindings, saved);
  assert.deepEqual(restored.snapshot(), saved); assert.equal(restored.memory.read(0x1234), 0xa5);
  assert.throws(() => create6809CocoDisk(bindings, saved), /RAM|size|length/);
});

test("TY also selects all-RAM with M=01; the preserved 32 KiB profile rejects it", () => {
  const expanded = create6809Coco64(bindings), original = create6809CocoDisk(bindings);
  for (const machine of [expanded, original]) {
    machine.sam.write(0x1b, 0); machine.sam.write(0x1f, 0);
    machine.ram.write(0, 0x12);
  }
  expanded.memory.write(0x9000, 0x68); assert.equal(expanded.ram.read(0x9000), 0x68);
  assert.equal(stepCoco(expanded).outcome, "executed");
  const before = original.snapshot(); assert.throws(() => stepCoco(original), /Unsupported CoCo memory/);
  assert.deepEqual(original.snapshot(), before);
  expanded.sam.write(0x1d, 0); assert.throws(() => stepCoco(expanded), /Unsupported CoCo memory/);
});

test("64 KiB video fetches upper physical RAM independently of the CPU's P1 and TY", () => {
  const machine = create6809Coco64(bindings);
  machine.pias.write(0x23, 0); machine.pias.write(0x22, 0xf8); machine.pias.write(0x23, 4); machine.pias.write(0x22, 0);
  machine.sam.write(0x13, 0); // Display F6: physical 8000.
  machine.ram.write(0, 0x8f); machine.ram.write(0x8000, 0xbf); // Green versus blue SG4.
  const initial = renderCocoFrame(machine); assert.equal(initial[0], 3);
  machine.sam.write(0x1d, 0); machine.sam.write(0x15, 0);
  assert.deepEqual(renderCocoFrame(machine), initial);
  machine.sam.write(0x1f, 0); assert.deepEqual(renderCocoFrame(machine), initial);
  const snapshot = machine.snapshot(); machine.memory.read = () => { throw new Error("No bus reads"); };
  assert.equal(readCocoStorage(machine, 0x8000), 0xbf);
  assert.deepEqual(machine.snapshot(), snapshot);
});
