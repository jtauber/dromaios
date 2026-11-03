import { cgaColours, renderXtGraphicsFrame, renderXtTextFrame } from "../../src/machines/8088/pc-xt/video.js";
import type { XtMachine } from "./xt-session.js";

const palette = cgaColours.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));

/** Draw the monitor from the active CRTC page. The text alternative follows the same addresses. */
export function createXtScreen(canvas: HTMLCanvasElement, text: HTMLElement, notice: HTMLElement) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The XT screen requires a 2D canvas.");
  let image: ImageData | undefined;
  return (machine: XtMachine, ready: boolean) => {
    const { cga, video } = machine;
    const textMode = cga.textSupported();
    const message = !ready ? "Load the three ROMs in the Firmware panel."
      : !cga.videoEnabled() ? "Waiting for the BIOS to enable CGA video."
      : !textMode && !cga.graphicsSupported() ? "Waiting for CGA text or 320 × 200 four-colour graphics." : "";
    notice.textContent = message; notice.hidden = !message;
    canvas.hidden = Boolean(message);
    if (message) { text.textContent = ""; return; }
    const frame = textMode ? renderXtTextFrame(machine) : renderXtGraphicsFrame(machine);
    if (!image || canvas.width !== frame.width) {
      canvas.width = frame.width; canvas.height = frame.height;
      image = context.createImageData(frame.width, frame.height); image.data.fill(255);
    }
    for (let i = 0; i < frame.pixels.length; i++) {
      const colour = palette[frame.pixels[i]!]!, offset = i * 4;
      image.data[offset] = colour[0]!; image.data[offset + 1] = colour[1]!; image.data[offset + 2] = colour[2]!;
    }
    context.putImageData(image, 0, 0);
    if (!textMode) {
      const description = "320 × 200 four-colour CGA graphics.";
      if (text.textContent !== description) text.textContent = description;
      return;
    }
    const rows: string[] = [];
    for (let row = 0; row < 25; row++) {
      let line = "";
      for (let col = 0; col < cga.columns(); col++) {
        const ch = video.read(cga.memoryAddress(cga.characterAddress(row, col)));
        line += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : " ";
      }
      rows.push(line.trimEnd());
    }
    const contents = rows.join("\n");
    if (contents !== text.textContent) text.textContent = contents;
  };
}
