import type { IbmEga } from "../../src/components/devices/ibm-ega.js";
import { egaRgb } from "../../src/machines/8088/pc-xt/video.js";
import { xtHex } from "./8088-disassembly.js";

/** Map a click on the stretched 4:3 picture to its native mode 0Dh raster. */
export function egaPixelAt(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number) {
  const x = Math.floor((clientX - rect.left) * 320 / rect.width);
  const y = Math.floor((clientY - rect.top) * 200 / rect.height);
  if (x >= 0 && x < 320 && y >= 0 && y < 200) return { x, y };
}

/** One paused dot, using the same monitor decoding as the canvas. */
export function xtEgaPixelReadout(ega: IbmEga, x: number, y: number): string {
  const label = `Pixel (${x},${y})`, dot = ega.inspectGraphicsPixel(x, y);
  if (!dot) return `${label} · waiting for an enabled mode 0Dh display.`;
  const bytes = dot.planeBytes.map(b => xtHex(b, 2)).join(" ");
  const bits = dot.planeBytes.map(b => b >> dot.bit & 1).join(" ");
  const rgb = egaRgb(dot.pins, ega.rgbiOutput).map(v => xtHex(v, 2)).join("");
  return `${label} · plane offset $${xtHex(dot.offset, 4)} · P0–P3: ${bytes} · bit ${dot.bit}: ${bits}`
    + ` · index ${dot.index} · palette[${dot.paletteIndex}] = $${xtHex(dot.pins, 2)} · #${rgb}`;
}
