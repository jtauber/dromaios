import assert from "node:assert/strict";
import { test } from "node:test";
import { I8255a } from "../../../src/components/devices/generated/i8255a.js";

test("all sixteen mode-0 direction combinations select pins or output latches", () => {
  for (let directions = 0; directions < 16; directions++) {
    const ppi = new I8255a();
    const a = Boolean(directions & 8), highC = Boolean(directions & 4);
    const b = Boolean(directions & 2), lowC = Boolean(directions & 1);
    ppi.write(3, 0x80 | (a ? 0x10 : 0) | (highC ? 8 : 0) | (b ? 2 : 0) | (lowC ? 1 : 0));
    ppi.setPortInputs(0xa5, 0x3c, 0x96);
    ppi.write(0, 0x5a); ppi.write(1, 0xc3); ppi.write(2, 0x69);
    assert.equal(ppi.read(0), a ? 0xa5 : 0x5a);
    assert.equal(ppi.read(1), b ? 0x3c : 0xc3);
    assert.equal(ppi.driveB(), b ? 0xff : 0xc3);
    assert.equal(ppi.read(2), (highC ? 0x90 : 0x60) | (lowC ? 6 : 9));
    const before = ppi.snapshot();
    ppi.portA(); ppi.portB(); ppi.portC(); ppi.driveB();
    assert.deepEqual(ppi.snapshot(), before);
    assert.deepEqual(new I8255a(before).snapshot(), before);
  }
});

test("mode writes clear latches, BSR preserves mode, and reset preserves external levels", () => {
  const ppi = new I8255a();
  ppi.setPortInputs(0x12, 0x34, 0x56);
  assert.deepEqual([ppi.read(0), ppi.read(1), ppi.read(2), ppi.read(3)], [0x12, 0x34, 0x56, "bus-error"]);
  ppi.write(0, 0xff); ppi.write(1, 0xff); ppi.write(2, 0xff);
  ppi.write(3, 0x80);
  assert.deepEqual([ppi.read(0), ppi.read(1), ppi.read(2)], [0, 0, 0]);
  for (let bit = 0; bit < 8; bit++) {
    ppi.write(3, 0x70 | bit * 2 | 1); // BSR's upper bits are don't-care.
    assert.equal(ppi.read(2), 1 << bit); assert.equal(ppi.snapshot().mode, 0x80);
    ppi.write(3, bit * 2); assert.equal(ppi.read(2), 0);
  }
  ppi.write(1, 0x55); ppi.write(3, 0x80); assert.equal(ppi.read(1), 0);
  ppi.reset(); assert.equal(ppi.snapshot().mode, 0x9b);
  assert.deepEqual([ppi.read(0), ppi.read(1), ppi.read(2)], [0x12, 0x34, 0x56]);
});

test("unsupported PPI modes and invalid inputs preserve every field", () => {
  const ppi = new I8255a(); ppi.write(3, 0x99); ppi.write(1, 0x4c);
  const before = ppi.snapshot();
  for (const mode of [0xa0, 0xc0, 0x84, 0xff]) assert.throws(() => ppi.write(3, mode), /Unsupported/);
  assert.throws(() => ppi.setPortInputs(1, 2, 256), RangeError);
  assert.throws(() => ppi.write(4, 0), RangeError);
  assert.throws(() => ppi.read(-1), RangeError);
  assert.deepEqual(ppi.snapshot(), before);
  assert.throws(() => new I8255a({ ...before, mode: 0x19 }), /Invalid/);
});
