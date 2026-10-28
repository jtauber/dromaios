import assert from "node:assert/strict";
import { test } from "node:test";
import { Mc6883 } from "../../../src/components/devices/generated/mc6883.js";

test("SAM address pairs set and clear exactly one bit, independent of data", () => {
  for (const control of [0, 0xffff, 0xa55a]) for (let bit = 0; bit < 16; bit++) {
    for (const set of [0, 1]) for (const data of [0, 0xa5, 255]) {
      const sam = new Mc6883({ control }); sam.write(bit * 2 + set, data);
      assert.equal(sam.snapshot().control, set ? control | (1 << bit) : control & ~(1 << bit));
      const saved = sam.snapshot();
      for (let address = 0; address < 32; address++) assert.equal(sam.read(address), "bus-error");
      assert.deepEqual(sam.snapshot(), saved);
    }
  }
});

test("SAM starts fully reset, exposes independent fields, and restores without reinitializing", () => {
  const sam = new Mc6883(); assert.deepEqual(sam.snapshot(), { control: 0 });
  for (let address = 1; address < 32; address += 2) sam.write(address, 0);
  assert.equal(sam.videoMode(), 7); assert.equal(sam.displayStart(), 0xfe00);
  assert.equal(sam.page(), true); assert.equal(sam.clockMode(), 3); assert.equal(sam.memoryMode(), 3);
  assert.equal(sam.normalMap(), false); assert.equal(sam.supportedMemory(), false);
  const saved = sam.snapshot(), restored = new Mc6883(saved); sam.reset();
  assert.deepEqual(sam.snapshot(), { control: 0 }); assert.deepEqual(restored.snapshot(), saved);
  sam.write(0x1b, 248); sam.write(0x15, 248); sam.write(9, 248); // Actual BASIC initialization.
  assert.equal(sam.memoryMode(), 1); assert.equal(sam.page(), true); assert.equal(sam.displayStart(), 0x400);
  assert.equal(sam.supportedMemory(), true);
  for (const address of [-1, 32, 0.5, NaN]) {
    assert.throws(() => sam.read(address), RangeError); assert.throws(() => sam.write(address, 0), RangeError);
  }
  assert.throws(() => sam.write(0, 256), RangeError);
  assert.throws(() => new Mc6883({ control: 0x10000 }), RangeError);
});

test("SAM text addresses follow every F page within physical 32 KiB, independently of P1", () => {
  for (let f = 0; f < 128; f++) for (const page of [0, 1]) {
    const sam = new Mc6883({ control: 0x2000 + f * 8 + page * 0x400 });
    for (let row = 0; row < 16; row++) for (let column = 0; column < 32; column++) {
      assert.equal(sam.textAddress(row, column), (f * 512 + row * 32 + column) % 0x8000);
    }
  }
});
