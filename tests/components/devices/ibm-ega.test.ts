import assert from "node:assert/strict";
import { test } from "node:test";
import { IbmEga } from "../../../src/components/devices/ibm-ega.js";

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
