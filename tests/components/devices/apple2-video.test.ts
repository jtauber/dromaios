import assert from "node:assert/strict";
import { test } from "node:test";
import { Apple2Video } from "../../../src/components/devices/generated/apple2-video.js";

// Independently transcribed screen map and character rows from the Apple II manual.
const rows = [0x400, 0x480, 0x500, 0x580, 0x600, 0x680, 0x700, 0x780,
  0x428, 0x4a8, 0x528, 0x5a8, 0x628, 0x6a8, 0x728, 0x7a8,
  0x450, 0x4d0, 0x550, 0x5d0, 0x650, 0x6d0, 0x750, 0x7d0];
const characters = "@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !\"#$%&'()*+,-./0123456789:;<=>?";

test("Apple II video addresses every visible cell on both interleaved text pages", () => {
  const video = new Apple2Video();
  for (const page of [1, 2]) {
    video.write(page === 1 ? 4 : 5, 0);
    const visited = new Set<number>();
    rows.forEach((base, row) => {
      for (let column = 0; column < 40; column++) {
        const address = video.textAddress(row, column);
        assert.equal(address, base + (page - 1) * 0x400 + column);
        visited.add(address);
      }
    });
    assert.equal(visited.size, 960);
    for (let block = 0; block < 8; block++) {
      for (let hole = 120; hole < 128; hole++) assert.equal(visited.has(page * 0x400 + block * 128 + hole), false);
    }
  }
});

test("Apple II character decoding distinguishes normal, inverse, and both flashing phases", () => {
  const video = new Apple2Video(), before = video.snapshot();
  for (let byte = 0; byte < 256; byte++) {
    assert.equal(String.fromCharCode(video.characterCode(byte)), characters[byte % 64]);
    assert.equal(video.inverse(byte, false), byte < 64);
    assert.equal(video.inverse(byte, true), byte < 128);
  }
  assert.deepEqual(video.snapshot(), before);
});

test("both switch access directions change only their selected latch, with reset and snapshot preservation", () => {
  for (const direction of ["read", "write"] as const) {
    const video = new Apple2Video();
    assert.deepEqual(video.snapshot(), { text: true, mixed: false, page2: false, hires: false });
    for (const [pair, field] of ["text", "mixed", "page2", "hires"].entries()) {
      for (const selected of [1, 0]) {
        const before = video.snapshot(), address = pair * 2 + selected;
        if (direction === "read") assert.equal(video.read(address), 0);
        else assert.equal(video.write(address, 0xff), undefined);
        assert.deepEqual(video.snapshot(), { ...before, [field]: Boolean(selected) });
      }
    }
    video.write(3, 0); video.read(5); video.read(7);
    const saved = video.snapshot(), restored = new Apple2Video(saved);
    video.reset(); assert.deepEqual(video.snapshot(), saved);
    video.read(1); assert.deepEqual(restored.snapshot(), saved);
    for (let row = 0; row < 256; row++) {
      assert.equal(video.visibleRow(row), row < 24);
      assert.equal(restored.visibleRow(row), row >= 20 && row < 24);
    }
    restored.read(2);
    for (let row = 0; row < 24; row++) assert.equal(restored.visibleRow(row), false);
  }
});

test("read-only video views reject invalid arguments without changing state", () => {
  const video = new Apple2Video(), before = video.snapshot();
  for (const byte of [-1, 256, 1.5, NaN, Infinity]) {
    assert.throws(() => video.textAddress(byte, 0), RangeError);
    assert.throws(() => video.textAddress(0, byte), RangeError);
    assert.throws(() => video.visibleRow(byte), RangeError);
    assert.throws(() => video.characterCode(byte), RangeError);
    assert.throws(() => video.inverse(byte, false), RangeError);
  }
  assert.throws(() => video.inverse(0, 1 as never), TypeError);
  assert.deepEqual(video.snapshot(), before);
});
