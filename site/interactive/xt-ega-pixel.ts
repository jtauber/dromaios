import type { IbmEga } from "../../src/components/devices/ibm-ega.js";
import { egaRgb } from "../../src/machines/8088/pc-xt/video.js";
import type { XtBoundary } from "./xt-session.js";
import { xtHex } from "./8088-disassembly.js";

/** Map a click on the stretched 4:3 picture to its native mode 0Dh raster. */
export function egaPixelAt(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number) {
  const x = Math.floor((clientX - rect.left) * 320 / rect.width);
  const y = Math.floor((clientY - rect.top) * 200 / rect.height);
  if (x >= 0 && x < 320 && y >= 0 && y < 200) return { x, y };
}

/** Sample the same monitor output as the canvas without touching the EGA read latches. */
function sample(ega: IbmEga, x: number, y: number) {
  const dot = ega.inspectGraphicsPixel(x, y);
  if (!dot) return undefined;
  const colour = "#" + egaRgb(dot.pins, ega.rgbiOutput).map(v => xtHex(v, 2)).join("");
  return { ...dot, colour };
}

type PixelSample = NonNullable<ReturnType<typeof sample>>;
export interface XtPixelChange {
  readonly x: number;
  readonly y: number;
  readonly before: PixelSample;
  readonly after: PixelSample;
  readonly afterBlanking: boolean;
  readonly record: XtBoundary;
}

export function describeXtPixel(dot: PixelSample): string {
  const bytes = dot.planeBytes.map(b => xtHex(b, 2)).join(" ");
  const bits = dot.planeBytes.map(b => b >> dot.bit & 1).join(" ");
  return `plane offset $${xtHex(dot.offset, 4)} · P0–P3: ${bytes} · bit ${dot.bit}: ${bits}`
    + ` · index ${dot.index} · palette[${dot.paletteIndex}] = $${xtHex(dot.pins, 2)} · ${dot.colour}`;
}

export function xtEgaPixelReadout(ega: IbmEga, x: number, y: number): string {
  const dot = sample(ega, x, y);
  return `Pixel (${x},${y}) · ${dot ? describeXtPixel(dot) : "waiting for an enabled mode 0Dh display."}`;
}

const inVideoMemory = (address: number) => address >= 0xa0000 && address < 0xc0000;
export function dmaWritesXtVideo({ dma }: XtBoundary): boolean {
  return dma?.direction === "disk-to-memory" && inVideoMemory(dma.address);
}

export function watchXtEgaPixel(ega: IbmEga, x: number, y: number) {
  const initial = sample(ega, x, y);
  if (!initial) throw new Error("Select a visible dot in mode 0Dh first.");
  let previous = initial, blanked = false;
  function observe(record: XtBoundary): XtPixelChange | "mode-ended" | undefined {
    // Mode 0Dh has no blinking dots. A video store or display register write can change scanout.
    if (!dmaWritesXtVideo(record) && !record.accesses.some(a => a.kind === "write" && inVideoMemory(a.address)
      || a.kind === "output" && a.port >= 0x3b0 && a.port <= 0x3df)) return;
    if (!ega.graphicsSupported) return "mode-ended";
    const next = sample(ega, x, y);
    // BIOS palette calls can blank video while programming the card. Compare the next visible dot.
    if (!next) { blanked = true; return; }
    if (next.colour !== previous.colour) return { x, y, before: previous, after: next, afterBlanking: blanked, record };
    previous = next; blanked = false;
  }
  return { x, y, observe };
}
