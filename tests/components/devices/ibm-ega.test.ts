import assert from "node:assert/strict";
import { test } from "node:test";
import { IbmEga } from "../../../src/components/devices/ibm-ega.js";
import { egaRgb } from "../../../src/machines/8088/pc-xt/video.js";

test("EGA exposes the four monitor switches and switches the active CRTC/status ports", () => {
  const ega = new IbmEga();
  for (let sw = 0; sw < 4; sw++) {
    ega.writePort(0x3c2, 1 | (sw << 2));
    assert.equal((ega.readPort(0x3c2) >> 4) & 1, [1, 0, 0, 1][sw]);
  }
  ega.writePort(0x3c0, 0x22);
  assert.equal(ega.readPort(0x3ba), 0xff); // Inactive status port leaves the flip-flop alone.
  ega.writePort(0x3c1, 0x2a); assert.equal(ega.colour(2), 0x2a);
  ega.writePort(0x3c0, 1); ega.readPort(0x3da);
  ega.writePort(0x3c0, 0x23); ega.writePort(0x3c0, 0x3f); assert.equal(ega.colour(3), 63);
});

test("EGA routes text and uploaded glyphs into distinct planes and restores the CPU read latches", () => {
  const ega = new IbmEga();
  function reg(port: number, index: number, value: number) { ega.writePort(port, index); ega.writePort(port + 1, value); }
  assert.equal(ega.read(0x18000), 0xff);
  ega.writePort(0x3c2, 3);
  reg(0x3c4, 2, 3); reg(0x3c4, 4, 3); reg(0x3ce, 5, 0x10); reg(0x3ce, 6, 0x0e); reg(0x3ce, 8, 255);
  ega.write(0x18000, 65); ega.write(0x18001, 7);
  assert.deepEqual([ega.character(0, 0), ega.attribute(0, 0), ega.read(0x18001), ega.read(0)], [65, 7, 7, 255]);
  reg(0x3c4, 2, 4); reg(0x3c4, 4, 7); reg(0x3ce, 5, 0); reg(0x3ce, 6, 4); reg(0x3ce, 4, 2);
  ega.write(65 * 32 + 2, 0x5a);
  assert.equal(ega.glyph(65, 7, 2), 0x5a);
  ega.read(65 * 32 + 2); ega.peek(0); // Inspection must preserve the previous CPU read.
  const copy = new IbmEga(ega.snapshot());
  copy.writePort(0x3ce, 5); copy.writePort(0x3cf, 1); // Write the latch contents into another address.
  copy.write(0xffff, 0); assert.equal(copy.peek(0xffff), 0x5a);
  assert.equal(ega.peek(0xffff), 0);
});

test("the raster and diagnostic mux see the same glyph, palette and CRTC page", () => {
  const ega = new IbmEga();
  function reg(port: number, index: number, value: number) { ega.writePort(port, index); ega.writePort(port + 1, value); }
  ega.writePort(0x3c2, 3);
  // Two 8-dot characters per scan line, one visible. Two visible scans followed by retrace.
  for (const [index, value] of [[0, 0], [1, 0], [6, 2], [9, 1], [10, 32], [13, 1],
    [0x10, 2], [0x11, 3], [0x12, 1], [0x13, 1]] as const) reg(0x3d4, index, value);
  reg(0x3c4, 1, 1); reg(0x3c4, 2, 4); reg(0x3c4, 4, 7);
  reg(0x3ce, 6, 4); reg(0x3ce, 8, 255);
  ega.write(65 * 32, 0x80);
  reg(0x3c4, 2, 3); reg(0x3c4, 4, 3); reg(0x3ce, 5, 0x10); reg(0x3ce, 6, 0x0e);
  ega.write(0x18002, 65); ega.write(0x18003, 1);
  reg(0x3c0, 0x21, 4); reg(0x3c0, 0x32, 0x0f); // Palette 1 drives primary red, mapped to diagnostic bit 5.
  assert.equal(ega.textEnabled, true); assert.equal(ega.character(0, 0), 65);
  assert.equal(ega.pixel(0, 0), 4); assert.equal(ega.pixel(1, 0), 0);
  assert.equal(ega.readPort(0x3da) & 0x39, 0x20);
  ega.advanceOscillatorTicks(8); assert.equal(ega.readPort(0x3da) & 0x39, 1);
  ega.advanceOscillatorTicks(24); assert.equal(ega.readPort(0x3da) & 0x39, 9);
  const restored = new IbmEga(ega.snapshot());
  assert.equal(restored.readPort(0x3da), ega.readPort(0x3da));
});

test("planar scanout follows the CRTC page and stride; CPU writes use the latches and plane masks", () => {
  const ega = new IbmEga();
  function reg(port: number, index: number, value: number) { ega.writePort(port, index); ega.writePort(port + 1, value); }
  ega.writePort(0x3c2, 3);
  reg(0x3c4, 1, 1); reg(0x3c4, 4, 6); reg(0x3ce, 6, 5); reg(0x3ce, 8, 255);
  for (const [i, v] of [[1, 39], [0x12, 199], [0x13, 20], [0x17, 0xe3], [0x18, 255]] as const) reg(0x3d4, i, v);
  reg(0x3c0, 0x30, 1); reg(0x3c0, 0x32, 15); reg(0x3c0, 0x27, 42);
  assert.ok(ega.graphicsSupported);
  for (const [p, byte] of [0x55, 0x33, 0x0f, 0].entries()) {
    reg(0x3c4, 2, 1 << p); ega.write(40, byte); // Row 1, eight pixels numbered 0 through 7.
  }
  const indices = (y: number) => Array.from({ length: 8 }, (_, x) => ega.graphicsIndex(x, y));
  assert.deepEqual(indices(1), [0, 1, 2, 3, 4, 5, 6, 7]); assert.equal(ega.pixel(7, 1), 42);
  reg(0x3c4, 2, 15); reg(0x3ce, 5, 1); ega.read(40); ega.write(0x8000, 0); // Copy the four latches.
  assert.deepEqual(indices(0), Array(8).fill(0));
  reg(0x3d4, 0x0c, 0x80); assert.deepEqual(indices(0), [0, 1, 2, 3, 4, 5, 6, 7]);
  reg(0x3c0, 0x32, 3); assert.equal(ega.pixel(7, 0), ega.colour(3)); // Disable planes 2 and 3 only for display.
  reg(0x3c4, 2, 1); reg(0x3ce, 5, 0); reg(0x3ce, 3, 0x19); reg(0x3ce, 8, 0xf0);
  ega.read(0x8000); ega.peek(0); ega.write(0x8000, 0x81);
  assert.equal(ega.peek(0x8000), 0x95); // Rotate 81 right once, XOR the latched 55, preserve its low nibble.
  assert.equal(ega.peek(40), 0x55);
});

test("the 5154 uses the secondary green pin for RGBI intensity at 200 lines", () => {
  assert.deepEqual(egaRgb(6, true), [170, 85, 0]); // Brown
  assert.deepEqual(egaRgb(6, false), [170, 170, 0]);
  assert.deepEqual(egaRgb(0x17, true), [255, 255, 255]);
  assert.deepEqual(egaRgb(0x17, false), [170, 255, 170]);
  assert.deepEqual(egaRgb(0x28, true), [0, 0, 0]); // Secondary red and blue do not drive this mode.
});
