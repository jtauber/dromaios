import assert from "node:assert/strict";
import { test } from "node:test";
import { CocoPias } from "../../../../src/machines/6809/coco/pias.js";
import { Cpu6809 } from "../../../../src/components/cpus/generated/6809-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";

test("CoCo PIA 1 aliases expose direction changes to video without disturbing the keyboard", () => {
  const io = new CocoPias(); io.write(0x23, 4); io.write(0x22, 0x80);
  assert.equal(io.videoPins, 0xff);
  io.write(0x3f, 0); io.write(0x3e, 0xff);
  assert.equal(io.videoPins, 0x80);
  io.write(0x23, 4);
  for (let alias = 0x20; alias < 0x40; alias += 4) {
    assert.equal(io.read(alias + 2), 0x80);
    assert.equal(io.read(alias + 3), 4);
  }
  assert.equal(io.read(2), 0);
});

test("CoCo IRQ and FIRQ are current levels and observation cannot acknowledge them", () => {
  const io = new CocoPias(); io.write(1, 5); io.write(3, 5); io.write(0x21, 5); io.write(0x23, 5);
  io.setHorizontalSync(false); io.setFieldSync(false); io.setCarrierDetect(false); io.setCartridgeLine(false);
  const before = io.snapshot();
  assert.equal(io.irq, true); assert.equal(io.firq, true);
  assert.equal(io.read(1), 0x85); assert.equal(io.read(3), 0x85);
  assert.equal(io.read(0x21), 0x85); assert.equal(io.read(0x23), 0x85);
  void io.videoPins; assert.deepEqual(io.snapshot(), before);
  io.read(0x1c); assert.equal(io.irq, true);
  io.read(0x1e); assert.equal(io.irq, false); assert.equal(io.firq, true);
  io.read(0x3c); assert.equal(io.firq, true);
  io.read(0x3e); assert.equal(io.firq, false);
});

test("CoCo PIA restoration preserves held keys and pending edges; reset does not release keys", () => {
  const io = new CocoPias(); io.write(2, 0xff); io.write(1, 5); io.write(3, 5);
  io.write(2, 0xfd); io.setKey("A", true); io.setFieldSync(false);
  const saved = io.snapshot(), restored = new CocoPias(saved);
  io.releaseKeys(); io.reset();
  assert.deepEqual(restored.snapshot(), saved);
  assert.equal(restored.read(0), 0xfe); assert.equal(restored.irq, true);
  restored.read(2); restored.setFieldSync(false); assert.equal(restored.irq, false);
  restored.setFieldSync(true); restored.setFieldSync(false); assert.equal(restored.irq, true);
  restored.reset(); assert.equal(restored.irq, false);
  restored.write(2, 0xff); restored.write(1, 4); restored.write(3, 4); restored.write(2, 0xfd);
  assert.equal(restored.read(0), 0xfe);
  assert.throws(() => new CocoPias({ ...saved, pia0: { ...saved.pia0, input_a: 0xff } }), /wiring/);
  assert.throws(() => new CocoPias({ ...saved, pia1: { ...saved.pia1, input_b: 0 } }), /wiring/);
  assert.throws(() => new CocoPias({ ...saved, pia0: undefined } as never), /requires both/);
  assert.throws(() => new CocoPias({ ...saved, keyboard: undefined } as never), /requires both/);
  const before = restored.snapshot();
  for (const address of [-1, 0x40, 0.5, NaN]) {
    assert.throws(() => restored.read(address), RangeError);
    assert.throws(() => restored.write(address, 0), RangeError);
  }
  assert.throws(() => restored.write(0, 256), RangeError);
  assert.throws(() => restored.setFieldSync(0 as never), TypeError);
  assert.deepEqual(restored.snapshot(), before);
});

test("the generated 6809 scans a key and CLR performs the PIA read before writing", () => {
  const io = new CocoPias(), ram = new Ram(0x10000);
  const program = [
    0x86, 0xff, 0xb7, 0xff, 0x02, // DDRB = FF
    0x86, 0x34, 0xb7, 0xff, 0x01, 0xb7, 0xff, 0x03, // Data registers, manual C2 low
    0x86, 0xfd, 0xb7, 0xff, 0x1e, // PB1 selects A's column through a mirror
    0xb6, 0xff, 0x1c, 0xb7, 0x00, 0x80, // Read PA; store the result
    0x7f, 0xff, 0x1e, // CLR reads ORB (acknowledges CB1), then writes zero
  ];
  program.forEach((byte, i) => ram.write(0x200 + i, byte));
  const memory = {
    size: 0x10000,
    read: (address: number) => address >= 0xff00 && address < 0xff40 ? io.read(address - 0xff00) : ram.read(address),
    write: (address: number, value: number) => address >= 0xff00 && address < 0xff40 ? io.write(address - 0xff00, value) : ram.write(address, value),
  };
  const cpu = new Cpu6809(memory, { a: 0, b: 0, dp: 0, x: 0, y: 0, s: 0x8000, u: 0, pc: 0x200,
    nmiArmed: false, waitMode: "none", flags: { e: false, f: false, h: false, i: false, n: false, z: false, v: false, c: false } });
  io.setKey("A", true);
  for (let i = 0; i < 9; i++) assert.equal(cpu.step().outcome, "executed");
  assert.equal(ram.read(0x80), 0xfe); assert.equal(cpu.snapshot().pc, 0x218);
  io.setFieldSync(false); assert.equal(io.read(3), 0xb4);
  const clr = cpu.step();
  assert.equal(clr.outcome, "executed");
  assert.deepEqual(clr.accesses.slice(-2), [
    { kind: "read", address: 0xff1e, value: 0xfd },
    { kind: "write", address: 0xff1e, value: 0 },
  ]);
  assert.equal(io.read(3), 0x34);
});
