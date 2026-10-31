import assert from "node:assert/strict";
import { test } from "node:test";
import { create8088PcXt, romImages } from "../../../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";

async function syntheticImages() {
  const bios = new Uint8Array(0x2000).fill(0xf4);
  bios.set([0xea, 0, 0xe0, 0, 0xf0], 0x1ff0); // Hardware reset -> F000:E000.
  bios.set([0xb8, 0x34, 0x12, 0xa3, 0, 3, 0xf4]); // MOV AX,1234; MOV [0300],AX; HLT.
  const basic = Uint8Array.from({ length: 0x8000 }, (_, i) => (i >>> 13) * 0x10 + (i & 0xf));
  // Stub only the host digest for synthetic map tests; real-ROM acceptance uses SHA-256.
  return {
    font: null,
    bios: await RomImage.verify(bios, romImages.bios, async () => romImages.bios.sha256),
    basic: await RomImage.verify(basic, romImages.basic, async () => romImages.basic.sha256),
  };
}

test("XT physical map bounds RAM, aliases video/BASIC, protects ROM, and leaves holes unanswered", async () => {
  const machine = create8088PcXt(await syntheticImages()), { memory } = machine;
  assert.equal(memory.size, 0x100000); assert.equal(machine.ram.size, 0xa0000);
  for (const address of [0, 0x9ffff, 0xb8000, 0xbbfff]) {
    memory.write(address, 0x5a); assert.equal(memory.read(address), 0x5a);
  }
  assert.equal(memory.read(0xbc000), 0x5a); assert.equal(memory.read(0xbffff), 0x5a);
  memory.write(0xbc123, 0xa5); assert.equal(memory.read(0xb8123), 0xa5);
  for (const address of [0xa0000, 0xb7fff, 0xc0000, 0xeffff]) {
    assert.equal(memory.read(address), 0xff); memory.write(address, 0);
    assert.equal(memory.read(address), 0xff);
  }
  for (const base of [0xf0000, 0xf2000, 0xf4000, 0xf6000]) {
    assert.equal(memory.read(base), 0); assert.equal(memory.read(base + 0x1fff), 0xf);
    memory.write(base, 0x99); assert.equal(memory.read(base), 0);
  }
  for (const [address, expected] of [[0xf8000, 0x10], [0xfa000, 0x20], [0xfc000, 0x30], [0xfdfff, 0x3f],
    [0xfe000, 0xb8], [0xffff0, 0xea], [0xfffff, 0xf4]]) {
    memory.write(address!, 0); assert.equal(memory.read(address!), expected);
  }
});

test("XT starts through its reset ROM and snapshots restore detached storage and firmware identity", async () => {
  const bindings = await syntheticImages(), machine = create8088PcXt(bindings);
  assert.equal(machine.cpu.snapshot().ip, 0); assert.equal(machine.ram.read(0x300), 0);
  machine.reset(); assert.equal(machine.cpu.snapshot().pc, 0xffff0);
  const jump = stepTimedXtCpu(machine).record;
  assert.deepEqual(jump.instruction?.bytes, [0xea, 0, 0xe0, 0, 0xf0]);
  assert.equal(jump.after.cs, 0xf000); assert.equal(jump.after.ip, 0xe000);
  const saved = machine.snapshot(), restored = create8088PcXt(bindings, saved);
  for (let i = 0; i < 3; i++) assert.deepEqual(stepTimedXtCpu(restored), stepTimedXtCpu(machine));
  assert.equal(machine.cpu.snapshot().halted, true);
  assert.equal(machine.ram.read(0x300), 0x34); assert.equal(machine.ram.read(0x301), 0x12);
  assert.deepEqual(restored.snapshot(), machine.snapshot());
  restored.ram.write(0x300, 0x99); assert.equal(machine.ram.read(0x300), 0x34);
  assert.equal(saved.ram[0x300], 0);
  assert.throws(() => create8088PcXt({ ...bindings, bios: null }, saved), /identity/);
  assert.throws(() => create8088PcXt(bindings, { ...saved, basic: null }), /identity/);
  machine.reset(); assert.equal(machine.cpu.snapshot().pc, 0xffff0);
  assert.equal(machine.ram.read(0x300), 0x34); assert.equal(machine.io.oscillatorTicks, 0);
  assert.equal(machine.memory.read(0xffff0), 0xea);
});

test("XT firmware installation and unanswered ports have no hidden CPU or RAM initialization", async () => {
  const machine = create8088PcXt({ bios: null, basic: null, font: null });
  for (const address of [0xf0000, 0xf6000, 0xfe000, 0xffff0]) assert.equal(machine.memory.read(address), 0xff);
  const cpu = machine.cpu.snapshot(), { bios, basic } = await syntheticImages();
  machine.bios.install(bios); machine.basic.install(basic);
  assert.deepEqual(machine.cpu.snapshot(), cpu); assert.ok(machine.snapshot().ram.every(byte => byte === 0));
  const before = machine.io.snapshot();
  for (const port of [0xa0, 0x213, 0x3d8, 0x3f2, 0xffff]) assert.equal(machine.ports.readPort(port), 0xff);
  for (const port of [0x213, 0x3f4, 0xffff]) machine.ports.writePort(port, 0x80);
  assert.deepEqual(machine.io.snapshot(), before);
  machine.ports.writePort(0x63, 0x99); machine.ports.writePort(0x61, 0x40);
  machine.ports.writePort(0xa0, 0x80); machine.io.setCheckErrors(true, false);
  assert.equal(machine.ports.readPort(0x62), 0x8d); assert.equal(machine.io.nmiPending, true);
});
