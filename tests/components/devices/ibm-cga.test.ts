import assert from "node:assert/strict";
import { test } from "node:test";
import { IbmCga } from "../../../src/components/devices/generated/ibm-cga.js";

function register(cga: IbmCga, index: number, value: number): void {
  cga.write(4, index); cga.write(5, value);
}
function advance(cga: IbmCga, ticks: number): void {
  for (; ticks > 0; ticks -= 255) cga.advanceOscillatorTicks(Math.min(ticks, 255));
}
function configured(columns = 80): IbmCga {
  const cga = new IbmCga();
  // IBM Technical Reference, 1-138. Both modes have 912 crystal ticks per line.
  [columns === 80 ? 0x71 : 0x38, columns, columns === 80 ? 0x5a : 0x2d, 0xa,
    0x1f, 6, 25, 0x1c, 2, 7, 6, 7, 0, 0, 0, 0].forEach((value, i) => register(cga, i, value));
  cga.write(8, columns === 80 ? 0x29 : 0x28);
  return cga;
}

test("CGA original-6845 masks, index aliases, and readback directions are explicit", () => {
  const masks = [0xff, 0xff, 0xff, 0x0f, 0x7f, 0x1f, 0x7f, 0x7f, 3, 0x1f, 0x7f, 0x1f, 0x3f, 0xff, 0x3f, 0xff];
  const cga = new IbmCga();
  for (let i = 0; i < 32; i++) {
    cga.write(i % 4 * 2, i | 0xe0); cga.write(i % 4 * 2 + 1, 0xff);
    assert.equal(cga.read(5), i === 14 ? 0x3f : i === 15 ? 0xff : 0);
  }
  assert.deepEqual(cga.snapshot().crtc, masks);
  cga.write(8, 0xff); cga.write(9, 0xff);
  assert.equal(cga.snapshot().mode, 0x3f); assert.equal(cga.snapshot().colour, 0x3f);
  for (const address of [0, 2, 4, 6, 8, 9, 11, 12]) assert.equal(cga.read(address), "bus-error");
  for (const address of [10, 11, 12, 15]) assert.equal(cga.write(address, 0), "bus-error");
});

test("CGA status follows programmed scan timing, independent of reads and video enable", () => {
  for (const columns of [40, 80]) {
    const cga = configured(columns), characterTicks = columns === 80 ? 8 : 16;
    assert.equal(cga.status(), 4); advance(cga, columns * characterTicks - 1);
    assert.equal(cga.status(), 4); advance(cga, 1); assert.equal(cga.status(), 5);
    advance(cga, 912 - columns * characterTicks); assert.equal(cga.status(), 4);
    assert.equal(cga.snapshot().line, 1);
    advance(cga, 912 * 199); assert.equal(cga.snapshot().line, 200); assert.equal(cga.status(), 5);
    advance(cga, 912 * 24); assert.equal(cga.snapshot().line, 224); assert.equal(cga.status(), 13);
    advance(cga, 912 * 16 - 1); assert.equal(cga.status(), 13);
    advance(cga, 1); assert.equal(cga.status(), 5); assert.equal(cga.snapshot().fields, 1);
    advance(cga, 912 * 22); assert.equal(cga.snapshot().line, 0); assert.equal(cga.status(), 4);
    const before = cga.snapshot(); for (let i = 0; i < 100; i++) cga.read(10);
    assert.deepEqual(cga.snapshot(), before);
    cga.write(8, columns === 80 ? 1 : 0); assert.equal(cga.videoEnabled(), false);
    assert.equal(cga.status(), 4); advance(cga, 640); assert.equal(cga.status(), 5);
  }
});

test("CGA display start latches on frame boundaries; physical RAM wraps without losing cursor address bit 13", () => {
  const cga = configured(); register(cga, 12, 0x3f); register(cga, 13, 0xff);
  assert.equal(cga.characterAddress(0, 0), 0);
  advance(cga, 912 * 262 - 1); assert.equal(cga.characterAddress(0, 0), 0);
  advance(cga, 1); assert.equal(cga.characterAddress(0, 0), 0x3fff);
  assert.equal(cga.characterAddress(0, 1), 0);
  assert.equal(cga.memoryAddress(0x3fff), 0x3ffe); assert.equal(cga.memoryAddress(0x2000), 0);
  register(cga, 14, 0x20); register(cga, 15, 0);
  assert.equal(cga.cursorVisible(0, 6), false); assert.equal(cga.cursorVisible(0x2000, 6), true);
});

test("CGA text and cursor use separate external blink divider bits", () => {
  const cga = configured(), frameTicks = 912 * 262;
  assert.equal(cga.foreground(0x9e), 14); assert.equal(cga.background(0x9e), 1);
  assert.equal(cga.glyphVisible(0x9e), true); assert.equal(cga.cursorVisible(0, 6), true);
  assert.equal(cga.cursorVisible(0, 5), false); assert.equal(cga.cursorVisible(0, 7), true);
  advance(cga, frameTicks * 8);
  assert.equal(cga.cursorVisible(0, 6), false); assert.equal(cga.glyphVisible(0x9e), true);
  advance(cga, frameTicks * 8);
  assert.equal(cga.cursorVisible(0, 6), true); assert.equal(cga.glyphVisible(0x9e), false);
  assert.equal(cga.glyphVisible(0x1e), true);
  cga.write(8, 9); assert.equal(cga.background(0x9e), 9); assert.equal(cga.glyphVisible(0x9e), true);
  register(cga, 10, 0x26); assert.equal(cga.cursorVisible(0, 6), false);
  register(cga, 10, 0x46); assert.equal(cga.textSupported(), false); // Internal CRTC blink is outside this profile.
});

test("CGA arbitrary batches and snapshots preserve scan, blink, and divider phase", () => {
  const expected = configured(); advance(expected, 912 * 262 + 137);
  const actual = configured();
  for (let ticks = 0; ticks < 912 * 262 + 137;) {
    const delta = Math.min(37, 912 * 262 + 137 - ticks); actual.advanceOscillatorTicks(delta); ticks += delta;
  }
  assert.deepEqual(actual.snapshot(), expected.snapshot());
  const saved = actual.snapshot(), restored = new IbmCga(saved);
  for (const cga of [actual, restored]) { advance(cga, 123); cga.write(8, 0x28); advance(cga, 937); }
  assert.deepEqual(restored.snapshot(), actual.snapshot());
  assert.notDeepEqual(actual.snapshot(), saved);
  for (const changes of [{ mode: 64 }, { colour: 64 }, { index: 32 }, { phase: 16 }, { fields: 64 }, { vsync_left: 17 }, { line: 8192 }]) {
    assert.throws(() => new IbmCga({ ...saved, ...changes }), /Invalid/);
  }
  const crtc: [...typeof saved.crtc] = [...saved.crtc]; crtc[12] = 0x40;
  assert.throws(() => new IbmCga({ ...saved, crtc }), /Invalid/);
  assert.throws(() => actual.advanceOscillatorTicks(256), RangeError);
  actual.reset(); assert.deepEqual(actual.snapshot(), new IbmCga().snapshot());
});
