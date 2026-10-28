import assert from "node:assert/strict";
import { test } from "node:test";
import { Mc6847 } from "../../../src/components/devices/generated/mc6847.js";
import { characterRows } from "../../../src/components/devices/mc6847-character-set.js";

test("VDG internal text ignores GM, chooses CSS colours, and inverts whole cells", () => {
  const vdg = new Mc6847();
  for (let byte = 0; byte < 128; byte++) for (let gm = 0; gm < 8; gm++) for (const css of [0, 1]) {
    const pins = gm * 16 + css * 8;
    assert.equal(vdg.alphaMode(pins), true); assert.equal(vdg.alphaMode(pins | 0x80), false);
    assert.equal(vdg.semigraphics(byte), false); assert.equal(vdg.glyph(byte), byte % 64);
    assert.equal(vdg.characterCode(byte), byte % 64 < 32 ? byte % 64 + 64 : byte % 64);
    assert.equal(vdg.foreground(byte, pins), css ? 7 : 0); assert.equal(vdg.background(byte, pins), css ? 10 : 9);
    for (const row of [0, 0x22, 0x3e]) assert.equal(vdg.textPixels(byte, row), byte & 64 ? 255 - row : row);
  }
  assert.deepEqual(vdg.snapshot(), {}); vdg.reset(); assert.deepEqual(new Mc6847({}).snapshot(), {});
  assert.throws(() => vdg.textPixels(256, 0), RangeError);
  assert.throws(() => vdg.foreground(0, -1), RangeError);
});

test("VDG SG4 bits select TL/TR/BL/BR and all eight colours independently of CSS", () => {
  const vdg = new Mc6847();
  for (let colour = 0; colour < 8; colour++) for (let blocks = 0; blocks < 16; blocks++) {
    const byte = 0x80 + colour * 16 + blocks;
    assert.equal(vdg.semigraphics(byte), true);
    for (const css of [0, 8]) {
      assert.equal(vdg.foreground(byte, css), colour); assert.equal(vdg.background(byte, css), 8);
    }
    for (let row = 0; row < 12; row++) for (let x = 0; x < 8; x++) {
      const block = (row < 6 ? 0 : 2) + (x < 4 ? 0 : 1);
      assert.equal(Boolean(vdg.semigraphicsPixels(byte, row) & (0x80 >> x)), Boolean(blocks & (8 >> block)));
    }
  }
});

test("the original character ROM has 64 cells with the documented margins and arrow glyphs", () => {
  assert.equal(characterRows.length, 64 * 12);
  for (let glyph = 0; glyph < 64; glyph++) {
    const rows = characterRows.slice(glyph * 12, (glyph + 1) * 12);
    assert.deepEqual(rows.slice(0, 3), [0, 0, 0]); assert.deepEqual(rows.slice(10), [0, 0]);
    for (const row of rows) assert.equal(row & 0xc1, 0);
  }
  // B's shape and placement are drawn explicitly in Motorola Figure 19.
  assert.deepEqual(characterRows.slice(2 * 12, 3 * 12), [0, 0, 0, 0x3c, 0x12, 0x12, 0x1c, 0x12, 0x12, 0x3c, 0, 0]);
  assert.deepEqual(characterRows.slice(0x1e * 12 + 3, 0x1e * 12 + 10), [8, 0x1c, 0x2a, 8, 8, 8, 8]);
  assert.deepEqual(characterRows.slice(0x20 * 12, 0x21 * 12), Array(12).fill(0));
});
