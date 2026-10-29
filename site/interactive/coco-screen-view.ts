import { renderCocoFrame } from "../../src/machines/6809/coco/runtime.js";
import type { Coco } from "../../src/machines/6809/coco/runtime.js";
import { cocoDisplayStatus, cocoScreenText } from "./coco-inspection.js";

// Fixed presentation colours, not a composite signal or measured NTSC palette.
const colours = [0x00dc00, 0xffff00, 0x3030ff, 0xff3030, 0xffffc8, 0x00ffff, 0xff00ff, 0xff8c00, 0x000000, 0x003c00, 0x462300];

export function createCocoScreen(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>("[data-coco-canvas]")!;
  const context = canvas.getContext("2d")!;
  const text = root.querySelector<HTMLElement>("[data-coco-text]")!;
  const status = root.querySelector<HTMLElement>("[data-display-status]")!;
  const notice = root.querySelector<HTMLElement>("[data-screen-notice]")!;
  const image = context.createImageData(256, 192);
  return {
    refresh(machine: Coco): void {
      let pixels: Uint8Array;
      try { pixels = renderCocoFrame(machine); }
      catch (cause) {
        context.clearRect(0, 0, 256, 192); text.textContent = ""; notice.hidden = false;
        notice.textContent = machine.firmware.loaded ? "Display mode not supported yet" : "Load your Color BASIC ROM";
        status.textContent = machine.firmware.loaded ? (cause instanceof Error ? cause.message : String(cause)) : "32 KiB RAM ready · no ROM loaded";
        return;
      }
      notice.hidden = true;
      for (let i = 0; i < pixels.length; i++) {
        const rgb = colours[pixels[i]!]!;
        image.data[i * 4] = rgb >> 16; image.data[i * 4 + 1] = rgb >> 8 & 255;
        image.data[i * 4 + 2] = rgb & 255; image.data[i * 4 + 3] = 255;
      }
      context.putImageData(image, 0, 0); text.textContent = cocoScreenText(machine);
      status.textContent = cocoDisplayStatus(machine);
    },
  };
}
