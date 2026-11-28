import { cgaColours, renderXtGraphicsFrame, renderXtTextFrame } from "../../src/machines/8088/pc-xt/video.js";
import { egaMonitorFrame } from "./xt-ega-screen.js";
import type { XtMachine } from "./xt-session.js";

const cgaPalette = cgaColours.map(hex => parseInt(hex.slice(1), 16));

function screenText(rows: number, columns: number, character: (row: number, column: number) => number) {
  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    let line = "";
    for (let column = 0; column < columns; column++) {
      const ch = character(row, column);
      line += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : " ";
    }
    lines.push(line.trimEnd());
  }
  return lines.join("\n");
}

function monitor(machine: XtMachine, ready: boolean) {
  if (!ready) return "Load the three ROMs in the Firmware panel.";
  if ("ega" in machine) {
    const { ega } = machine;
    const frame = egaMonitorFrame(ega);
    if (!frame) return "Waiting for EGA text or 320 × 200 sixteen-colour graphics.";
    return { ...frame, description: ega.textEnabled ? screenText(ega.rows, ega.columns, (row, col) => ega.character(row, col))
      : "320 × 200 sixteen-colour EGA graphics." };
  }
  const { cga, video } = machine;
  if (!cga.videoEnabled()) return "Waiting for the BIOS to enable CGA video.";
  if (cga.textSupported()) {
    return { ...renderXtTextFrame(machine), palette: cgaPalette,
      description: screenText(25, cga.columns(), (row, col) => video.read(cga.memoryAddress(cga.characterAddress(row, col)))) };
  }
  if (cga.graphicsSupported()) return { ...renderXtGraphicsFrame(machine), palette: cgaPalette,
    description: "320 × 200 four-colour CGA graphics." };
  return "Waiting for CGA text or 320 × 200 four-colour graphics.";
}

/** Draw the monitor from the active CRTC page. The text alternative follows the same addresses. */
export function createXtScreen(canvas: HTMLCanvasElement, text: HTMLElement, notice: HTMLElement) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The XT screen requires a 2D canvas.");
  let image: ImageData | undefined;
  return (machine: XtMachine, ready: boolean) => {
    const display = monitor(machine, ready);
    const message = typeof display === "string" ? display : "";
    notice.textContent = message; notice.hidden = !message;
    canvas.hidden = Boolean(message);
    if (typeof display === "string") { text.textContent = ""; return; }
    const { width, height, pixels, palette, description } = display;
    if (!image || canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
      image = context.createImageData(width, height); image.data.fill(255);
    }
    for (let i = 0; i < pixels.length; i++) {
      const colour = palette[pixels[i]!]!, offset = i * 4;
      image.data[offset] = colour >>> 16; image.data[offset + 1] = (colour >>> 8) & 255; image.data[offset + 2] = colour & 255;
    }
    context.putImageData(image, 0, 0);
    if (description !== text.textContent) text.textContent = description;
  };
}
