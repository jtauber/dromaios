import type { Apple2Video } from "../../src/components/devices/generated/apple2-video.js";
import { apple2CharacterSet } from "./apple2-character-set.js";
import { apple2HiresFrame, apple2LoresFrame, apple2TextFrame } from "./apple2-screen.js";

// Presentation colours from the pinned dromaios-apple2 renderer, not an NTSC model.
const loresColours = [
  0x000000, 0xd00030, 0x000080, 0xff00ff, // black, magenta, dark blue, purple
  0x008000, 0x808080, 0x0000ff, 0x60a0ff, // dark green, grey 1, medium blue, light blue
  0x805000, 0xff8000, 0xc0c0c0, 0xff9080, // brown, orange, grey 2, pink
  0x00ff00, 0xffff00, 0x40ff90, 0xffffff, // light green, yellow, aquamarine, white
] as const;
const hiresColours = [
  0x000000, 0x14f53c, 0xff44fd, 0xffffff, // black, green, violet, white
  0x000000, 0xff6a3c, 0x14cffd, 0xffffff, // black, orange, blue, white
] as const;
const phosphorGreen = 0x00c800;
// Average the four repeating LORES bits into five green brightness levels.
const monochromeLoresColours = loresColours.map((_, pattern) => {
  const dots = (pattern & 1) + ((pattern >> 1) & 1) + ((pattern >> 2) & 1) + ((pattern >> 3) & 1);
  return (200 * dots / 4) << 8;
});
const monochromeHiresColours = [0x000000, phosphorGreen];

/** Compose bitmap text and decoded graphics on the native 280×192 raster. */
export function apple2RasterFrame(ram: { read(address: number): number }, video: Apple2Video, flash: boolean, monochrome = false) {
  const width = 280, height = 192;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let alpha = 3; alpha < pixels.length; alpha += 4) pixels[alpha] = 255;

  function rectangle(x: number, y: number, w: number, h: number, colour: number): void {
    const red = colour >> 16, green = (colour >> 8) & 0xff, blue = colour & 0xff;
    for (let row = y; row < y + h; row++) {
      for (let column = x; column < x + w; column++) {
        const offset = (row * width + column) * 4;
        pixels[offset] = red; pixels[offset + 1] = green; pixels[offset + 2] = blue;
      }
    }
  }

  const hires = video.snapshot().hires;
  const graphics = hires ? apple2HiresFrame(ram, video, monochrome) : apple2LoresFrame(ram, video);
  const hiresPalette = monochrome ? monochromeHiresColours : hiresColours;
  const loresPalette = monochrome ? monochromeLoresColours : loresColours;
  const colours = hires ? hiresPalette : loresPalette;
  const hiresDotWidth = monochrome ? 1 : 2;
  const blockWidth = hires ? hiresDotWidth : 7, blockHeight = hires ? 1 : 4;
  graphics.forEach((row, y) => row?.forEach((colour, x) => {
    rectangle(x * blockWidth, y * blockHeight, blockWidth, blockHeight, colours[colour]!);
  }));

  const text = apple2TextFrame(ram, video, flash);
  text.forEach((row, y) => {
    if (!video.visibleRow(y)) return;
    row.forEach((cell, x) => {
      const glyph = apple2CharacterSet[cell.character.charCodeAt(0) & 0x3f]!;
      glyph.forEach((bits, line) => {
        // Shift the five-bit glyph into its seven-bit cell, then invert the whole cell.
        const dots = (bits << 1) ^ (cell.inverse ? 0x7f : 0);
        for (let dot = 0; dot < 7; dot++) {
          if (dots & (0x40 >> dot)) rectangle(x * 7 + dot, y * 8 + line, 1, 1, monochrome ? phosphorGreen : 0xffffff);
        }
      });
    });
  });
  return { width, height, pixels, text };
}
