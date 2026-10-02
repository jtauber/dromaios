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
    assert.throws(() => video.loresAddress(byte, 0), RangeError);
    assert.throws(() => video.loresAddress(0, byte), RangeError);
    assert.throws(() => video.loresColour(byte, 0), RangeError);
    assert.throws(() => video.loresColour(0, byte), RangeError);
    assert.throws(() => video.visibleLoresRow(byte), RangeError);
    assert.throws(() => video.hiresAddress(byte, 0), RangeError);
    assert.throws(() => video.hiresAddress(0, byte), RangeError);
    assert.throws(() => video.visibleHiresRow(byte), RangeError);
    assert.throws(() => video.hiresPairColour(byte, 0, 0), RangeError);
    assert.throws(() => video.hiresPairColour(0, byte, 0), RangeError);
    assert.throws(() => video.hiresPairColour(0, 0, byte), RangeError);
  }
  assert.throws(() => video.hiresPairColour(0, 0, 8), RangeError);
  assert.throws(() => video.inverse(0, 1 as never), TypeError);
  assert.deepEqual(video.snapshot(), before);
});

test("low-resolution graphics shares text addresses and decodes both nibbles independently", () => {
  const video = new Apple2Video();
  for (const page of [1, 2]) {
    video.write(page === 1 ? 4 : 5, 0);
    rows.forEach((address, pair) => {
      for (let column = 0; column < 40; column++) {
        const expected = address + (page - 1) * 0x400 + column;
        assert.equal(video.loresAddress(pair * 2, column), expected);
        assert.equal(video.loresAddress(pair * 2 + 1, column), expected);
      }
    });
  }
  const before = video.snapshot();
  for (let high = 0; high < 16; high++) for (let low = 0; low < 16; low++) {
    const byte = high * 16 + low;
    for (let row = 0; row < 48; row++) assert.equal(video.loresColour(byte, row), row % 2 === 0 ? low : high);
  }
  assert.deepEqual(video.snapshot(), before);
});

test("all display modes select exactly their visible text and graphics rows", () => {
  for (const text of [false, true]) for (const mixed of [false, true]) {
    for (const page2 of [false, true]) for (const hires of [false, true]) {
      const state = { text, mixed, page2, hires }, video = new Apple2Video(state);
      for (let row = 0; row < 256; row++) {
        assert.equal(video.visibleLoresRow(row), !text && !hires && row < (mixed ? 40 : 48));
        assert.equal(video.visibleHiresRow(row), !text && hires && row < (mixed ? 160 : 192));
        assert.equal(video.visibleRow(row), row < 24 && (text || mixed && row >= 20));
      }
      assert.deepEqual(video.snapshot(), state);
    }
  }
});

test("high-resolution pages interleave all scan lines while leaving their screen holes unread", () => {
  // Manual's base addresses for scan lines 0, 8, 16, ... 184; the seven intervening lines add 0400 each.
  const bases = [0x2000, 0x2080, 0x2100, 0x2180, 0x2200, 0x2280, 0x2300, 0x2380,
    0x2028, 0x20a8, 0x2128, 0x21a8, 0x2228, 0x22a8, 0x2328, 0x23a8,
    0x2050, 0x20d0, 0x2150, 0x21d0, 0x2250, 0x22d0, 0x2350, 0x23d0];
  for (const page2 of [false, true]) {
    const video = new Apple2Video({ text: false, mixed: false, page2, hires: true });
    const before = video.snapshot(), visited = new Set<number>();
    bases.forEach((base, group) => {
      for (let line = 0; line < 8; line++) for (let column = 0; column < 40; column++) {
        const address = video.hiresAddress(group * 8 + line, column);
        assert.equal(address, base + (page2 ? 0x2000 : 0) + line * 0x400 + column);
        visited.add(address);
      }
    });
    assert.equal(visited.size, 7680);
    for (let block = 0; block < 64; block++) for (let hole = 120; hole < 128; hole++) {
      assert.equal(visited.has((page2 ? 0x4000 : 0x2000) + block * 128 + hole), false);
    }
    assert.deepEqual(video.snapshot(), before);
  }
});

test("high-resolution colour pairs cover every byte combination, including separate phases at their boundary", () => {
  const video = new Apple2Video(), before = video.snapshot();
  // Each entry identifies the even and odd dot independently, without packing or shifting a combined word.
  const positions = [[0, 1, 0, 2], [0, 4, 0, 8], [0, 16, 0, 32], [0, 64, 1, 1],
    [1, 2, 1, 4], [1, 8, 1, 16], [1, 32, 1, 64]] as const;
  for (let first = 0; first < 256; first++) for (let second = 0; second < 256; second++) {
    const bytes = [first, second];
    positions.forEach(([evenByte, evenMask, oddByte, oddMask], pair) => {
      const even = bytes[evenByte]!, odd = bytes[oddByte]!;
      const expected = even & evenMask
        ? odd & oddMask ? 3 : even >= 128 ? 6 : 2
        : odd & oddMask ? odd >= 128 ? 5 : 1 : 0;
      assert.equal(video.hiresPairColour(first, second, pair), expected);
    });
    assert.equal(video.hiresPairColour(first, second, 7), 0);
  }
  // Record the declared approximation: neighbors spanning distinct pairs do not turn white.
  assert.equal(video.hiresPairColour(0x06, 0, 0), 1);
  assert.equal(video.hiresPairColour(0x06, 0, 1), 2);
  assert.deepEqual(video.snapshot(), before);
});
