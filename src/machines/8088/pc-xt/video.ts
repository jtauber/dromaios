import type { create8088PcXt } from "../../generated/8088/pc-xt.ts";

type Display = Pick<ReturnType<typeof create8088PcXt>, "cga" | "video" | "font">;

/** RGBI monitor colours, including its brown correction; not composite-video decoding. */
export const cgaColours: readonly string[] = Object.freeze([
  "#000000", "#0000AA", "#00AA00", "#00AAAA", "#AA0000", "#AA00AA", "#AA5500", "#AAAAAA",
  "#555555", "#5555FF", "#55FF55", "#55FFFF", "#FF5555", "#FF55FF", "#FFFF55", "#FFFFFF",
]);

export interface XtTextFrame {
  readonly width: number;
  readonly height: number;
  /** Detached RGBI colour indices, row-major; 40-column pixels may be doubled by the presentation. */
  readonly pixels: Uint8Array;
}

/** Reconstruct the active text image from physical storage and pure device views. */
export function renderXtTextFrame({ cga, video, font }: Display): XtTextFrame {
  if (!cga.textSupported()) throw new RangeError("CGA rendering requires 40/80 by 25 non-interlaced text with an eight-line, non-blinking or hidden CRTC cursor.");
  const columns = cga.columns(), width = columns * 8, height = 200;
  const pixels = new Uint8Array(width * height);
  if (!cga.videoEnabled()) return { width, height, pixels };
  if (!font.loaded) throw new Error("CGA text rendering requires the declared character ROM.");
  for (let row = 0; row < 25; row++) for (let column = 0; column < columns; column++) {
    const address = cga.characterAddress(row, column), offset = cga.memoryAddress(address);
    const character = video.read(offset), attribute = video.read(offset + 1);
    const foreground = cga.foreground(attribute), background = cga.background(attribute), visible = cga.glyphVisible(attribute);
    for (let line = 0; line < 8; line++) {
      const glyph = font.read(cga.glyphAddress(character, line));
      if (typeof glyph !== "number") throw new Error("CGA character ROM did not supply a glyph row.");
      const dots = cga.cursorVisible(address, line) ? 0xff : visible ? glyph : 0;
      const start = (row * 8 + line) * width + column * 8;
      for (let x = 0; x < 8; x++) pixels[start + x] = dots & (0x80 >>> x) ? foreground : background;
    }
  }
  return { width, height, pixels };
}
