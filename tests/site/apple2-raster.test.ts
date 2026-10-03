import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Apple2Video } from "../../src/components/devices/generated/apple2-video.js";
import { apple2CharacterSet } from "../../site/interactive/apple2-character-set.js";
import { apple2RasterFrame } from "../../site/interactive/apple2-raster.js";

type Frame = ReturnType<typeof apple2RasterFrame>;
const colourAt = (frame: Frame, x: number, y: number) =>
  Array.from(frame.pixels.slice((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4));
const cellAt = (frame: Frame, column: number, row: number) => Array.from({ length: 8 }, (_, y) =>
  Array.from({ length: 7 }, (_, x) => colourAt(frame, column * 7 + x, row * 8 + y)[0] === 255 ? "#" : ".").join(""));
const inverse = (lines: readonly string[]) => lines.map(line => [...line].map(dot => dot === "#" ? "." : "#").join(""));
const letterA = [".......", "...#...", "..#.#..", ".#...#.", ".#...#.", ".#####.", ".#...#.", ".#...#."];

test("the character bitmaps match the pinned dromaios-apple2 table", () => {
  assert.equal(apple2CharacterSet.length, 64);
  assert.ok(apple2CharacterSet.every(glyph => glyph.length === 8 && glyph.every(row => row >= 0 && row < 32)));
  // SHA-256 of the 512 row bytes extracted independently from v0.2.0 js/video.js.
  assert.equal(createHash("sha256").update(Uint8Array.from(apple2CharacterSet.flat())).digest("hex"),
    "d4184ed0292a449d8495e8a6e5a236bdef42dda40bcccfbfebb96dff5b531e98");
});

test("bitmap text has seven-pixel cells, original glyphs, and full-cell inverse and flash", () => {
  const bytes = new Uint8Array(0xc000).fill(0xa0);
  bytes.set([0xc1, 0x81, 0x01, 0x41, 0xa0, 0x20, 0xb0, 0xdc, 0xc0], 0x400);
  const video = new Apple2Video(), ram = { read: (address: number) => bytes[address]! };
  const frame = apple2RasterFrame(ram, video, false), flash = apple2RasterFrame(ram, video, true);
  assert.equal(frame.width, 280); assert.equal(frame.height, 192);
  assert.equal(frame.pixels.length, 280 * 192 * 4);
  for (let offset = 0; offset < frame.pixels.length; offset += 4) {
    const pixel = frame.pixels.slice(offset, offset + 4);
    assert.ok(pixel[0] === 0 || pixel[0] === 255);
    assert.deepEqual(Array.from(pixel), [pixel[0], pixel[0], pixel[0], 255]);
  }
  for (const column of [0, 1, 3]) assert.deepEqual(cellAt(frame, column, 0), letterA);
  for (const phase of [frame, flash]) assert.deepEqual(cellAt(phase, 2, 0), inverse(letterA));
  assert.deepEqual(cellAt(flash, 3, 0), inverse(letterA));
  assert.deepEqual(cellAt(frame, 4, 0), new Array(8).fill("......."));
  assert.deepEqual(cellAt(frame, 5, 0), new Array(8).fill("#######"));
  assert.deepEqual(cellAt(frame, 6, 0), [".......", "..###..", ".#...#.", ".#..##.", ".#.#.#.", ".##..#.", ".#...#.", "..###.."]);
  assert.deepEqual(cellAt(frame, 7, 0), [".......", ".......", ".#.....", "..#....", "...#...", "....#..", ".....#.", "......."]);
  assert.deepEqual(cellAt(frame, 8, 0), [".......", "..###..", ".#...#.", ".#.#.#.", ".#.###.", ".#.##..", ".#.....", "..####."]);
  assert.equal(frame.text[0]!.map(cell => cell.character).join("").trimEnd(), "AAAA  0\\@");
});

test("all 256 screen bytes use the correct glyph aliases in both flash phases", () => {
  const bytes = new Uint8Array(0xc000).fill(0xa0);
  // First seven page-one row addresses, transcribed independently of the video views.
  const rows = [0x400, 0x480, 0x500, 0x580, 0x600, 0x680, 0x700];
  for (let byte = 0; byte < 256; byte++) bytes[rows[Math.floor(byte / 40)]! + byte % 40] = byte;
  const video = new Apple2Video(), before = video.snapshot();
  for (const flash of [false, true]) {
    const frame = apple2RasterFrame({ read: address => bytes[address]! }, video, flash);
    const glyph = (byte: number) => cellAt(frame, byte % 40, Math.floor(byte / 40));
    for (let byte = 0; byte < 256; byte++) {
      const normal = glyph(128 + byte % 64);
      assert.deepEqual(glyph(byte), byte < 64 || (byte < 128 && flash) ? inverse(normal) : normal);
    }
  }
  assert.deepEqual(video.snapshot(), before);
});

test("both graphics pages share the raster with four text rows without covering graphics", () => {
  for (const page2 of [false, true]) for (const hires of [false, true]) {
    const bytes = new Uint8Array(0xc000);
    bytes.fill(0xa0, 0x400, 0xc00);
    const textPage = page2 ? 0x800 : 0x400, graphicsPage = page2 ? 0x4000 : 0x2000;
    bytes[textPage] = 0x61; // Magenta top block, medium blue bottom block.
    bytes[graphicsPage] = 0x01; // Violet even dot; colour fills the pair.
    bytes[textPage + 0x250] = 0xc1; // A at row 20, column 0.
    const video = new Apple2Video({ text: false, mixed: true, page2, hires });
    const before = video.snapshot(), reads: number[] = [];
    const ram = { read(address: number) { reads.push(address); return bytes[address]!; } };
    const frame = apple2RasterFrame(ram, video, false);
    assert.deepEqual(colourAt(frame, 0, 0), hires ? [255, 68, 253, 255] : [208, 0, 48, 255]);
    assert.deepEqual(colourAt(frame, hires ? 1 : 6, 0), colourAt(frame, 0, 0));
    assert.deepEqual(colourAt(frame, hires ? 2 : 7, 0), [0, 0, 0, 255]);
    if (!hires) assert.deepEqual(colourAt(frame, 0, 4), [0, 0, 255, 255]);
    assert.deepEqual(cellAt(frame, 0, 20), letterA);
    assert.ok(frame.text.slice(0, 20).flat().every(cell => cell.character === " "));
    assert.equal(reads.length, (hires ? 6400 : 1600) + 160);
    assert.deepEqual(video.snapshot(), before);
    assert.ok(reads.every(address => address >= textPage && address < textPage + 0x400
      || hires && address >= graphicsPage && address < graphicsPage + 0x2000));
    video.write(2, 0); // Full graphics removes the text overlay.
    assert.ok(apple2RasterFrame(ram, video, false).text.flat().every(cell => cell.character === " "));
    video.write(1, 0); // TEXT removes graphics from the freshly composed frame.
    assert.deepEqual(colourAt(apple2RasterFrame(ram, video, false), 0, 0), [0, 0, 0, 255]);
  }
});
