import type { Apple2Video } from "../../src/components/devices/generated/apple2-video.js";
import { apple2RasterFrame } from "./apple2-raster.js";

/** Bitmap display with selectable, accessible text and optional presentation scanlines. */
export function createApple2Screen(screen: HTMLElement, scanlines: HTMLInputElement) {
  const raster = document.createElement("div"); raster.className = "apple2-raster";
  const canvas = document.createElement("canvas"); canvas.width = 280; canvas.height = 192;
  canvas.setAttribute("role", "img");
  const context = canvas.getContext("2d")!;
  raster.append(canvas);
  const cells = Array.from({ length: 24 }, () => {
    const row = document.createElement("div"); row.className = "apple2-row";
    const cells = Array.from({ length: 40 }, () => {
      const cell = document.createElement("span"); cell.textContent = " "; row.append(cell); return cell;
    });
    raster.append(row); return cells;
  });
  screen.replaceChildren(raster);
  const updateScanlines = () => raster.classList.toggle("apple2-scanlines", scanlines.checked);
  scanlines.disabled = false;
  scanlines.addEventListener("change", updateScanlines);
  updateScanlines();
  // Match the reference: a dark band per native row, at least one displayed pixel tall.
  new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.height === 0) return;
    const rowHeight = entry.contentRect.height / 192;
    const dark = Math.min(rowHeight, Math.max(1, rowHeight * 0.25));
    raster.style.setProperty("--scanline-row", `${rowHeight}px`);
    raster.style.setProperty("--scanline-clear", `${rowHeight - dark}px`);
  }).observe(raster);

  return (ram: { read(address: number): number }, video: Apple2Video, flash: boolean, monochrome: boolean): void => {
    const { width, height, pixels, text } = apple2RasterFrame(ram, video, flash, monochrome);
    const mode = video.snapshot();
    canvas.setAttribute("aria-hidden", String(mode.text));
    canvas.setAttribute("aria-label", mode.hires ? "High-resolution graphics" : "Low-resolution graphics");
    context.putImageData(new ImageData(pixels, width, height), 0, 0);
    text.forEach((row, y) => row.forEach((cell, x) => {
      const span = cells[y]![x]!;
      if (span.textContent !== cell.character) span.textContent = cell.character;
    }));
  };
}
