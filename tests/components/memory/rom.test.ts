import assert from "node:assert/strict";
import { test } from "node:test";
import { Rom } from "../../../src/components/memory/rom.js";

test("ROM copies array and typed-array images, preserving every byte", () => {
  for (const image of [Array.from({ length: 256 }, (_, value) => value), Uint8Array.from({ length: 256 }, (_, value) => value)]) {
    const rom = new Rom(image);
    image.fill(0);
    assert.equal(rom.size, 256);
    for (let address = 0; address < 256; address++) assert.equal(rom.read(address), address);
  }
});

test("ROM reports bus errors for writes without changing any bytes", () => {
  const rom = new Rom([0x12, 0x34]);
  for (const address of [0, 1]) for (let value = 0; value < 256; value++) {
    assert.equal(rom.write(address, value), "bus-error");
    assert.equal(rom.read(0), 0x12);
    assert.equal(rom.read(1), 0x34);
  }
});

test("ROM rejects empty and invalid images without silently truncating bytes", () => {
  for (const bytes of [[], new Uint8Array(), [-1], [256], [1.5], [NaN], [Infinity], new Array<number>(2)]) {
    assert.throws(() => new Rom(bytes), RangeError);
  }
});

test("ROM rejects invalid host addresses and byte values instead of reporting bus errors", () => {
  const rom = new Rom([0x5a, 0xa5]);
  for (const address of [-1, 2, 0x1000000, 0.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => rom.read(address), RangeError);
    assert.throws(() => rom.write(address, 0), RangeError);
  }
  for (const value of [-1, 256, 0.5, NaN, Infinity]) assert.throws(() => rom.write(0, value), RangeError);
  assert.equal(rom.read(0), 0x5a);
  assert.equal(rom.read(1), 0xa5);
});
