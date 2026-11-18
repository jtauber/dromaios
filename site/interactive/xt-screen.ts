import { cgaColours, egaRgb, renderEgaGraphicsFrame, renderEgaTextFrame, renderXtGraphicsFrame, renderXtTextFrame } from "../../src/machines/8088/pc-xt/video.js";
import type { XtMachine } from "./xt-session.js";

const egaPalette = Array.from({ length: 64 }, (_, colour) => egaRgb(colour));
const egaRgbiPalette = Array.from({ length: 64 }, (_, colour) => egaRgb(colour, true));
const cgaPalette = cgaColours.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));

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
    const palette = ega.rgbiOutput ? egaRgbiPalette : egaPalette;
    if (ega.textEnabled) return { frame: renderEgaTextFrame(ega), palette,
      description: screenText(ega.rows, ega.columns, (row, col) => ega.character(row, col)) };
    if (ega.videoEnabled && ega.graphicsSupported) return { frame: renderEgaGraphicsFrame(ega), palette,
      description: "320 × 200 sixteen-colour EGA graphics." };
    return "Waiting for EGA text or 320 × 200 sixteen-colour graphics.";
  }
  const { cga, video } = machine;
  if (!cga.videoEnabled()) return "Waiting for the BIOS to enable CGA video.";
  if (cga.textSupported()) {
    return { frame: renderXtTextFrame(machine), palette: cgaPalette,
      description: screenText(25, cga.columns(), (row, col) => video.read(cga.memoryAddress(cga.characterAddress(row, col)))) };
  }
  if (cga.graphicsSupported()) return { frame: renderXtGraphicsFrame(machine), palette: cgaPalette,
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
    const { frame, palette, description } = display;
    if (!image || canvas.width !== frame.width || canvas.height !== frame.height) {
      canvas.width = frame.width; canvas.height = frame.height;
      image = context.createImageData(frame.width, frame.height); image.data.fill(255);
    }
    for (let i = 0; i < frame.pixels.length; i++) {
      const colour = palette[frame.pixels[i]!]!, offset = i * 4;
      image.data[offset] = colour[0]!; image.data[offset + 1] = colour[1]!; image.data[offset + 2] = colour[2]!;
    }
    context.putImageData(image, 0, 0);
    if (description !== text.textContent) text.textContent = description;
  };
}
