import { renderCocoFrame } from "../../src/machines/6809/coco/runtime.js";
import type { Coco, CocoVideoSignal } from "../../src/machines/6809/coco/runtime.js";
import { cocoDisplayStatus, cocoMonitorColours, cocoScreenText } from "./coco-inspection.js";

export function createCocoScreen(root: HTMLElement, changed: () => void) {
  const canvas = root.querySelector<HTMLCanvasElement>("[data-coco-canvas]")!;
  const context = canvas.getContext("2d")!;
  const text = root.querySelector<HTMLElement>("[data-coco-text]")!;
  const status = root.querySelector<HTMLElement>("[data-display-status]")!;
  const notice = root.querySelector<HTMLElement>("[data-screen-notice]")!;
  const image = context.createImageData(256, 192);
  const direct = root.querySelector<HTMLButtonElement>('[data-coco-signal="direct"]')!;
  const composite = root.querySelector<HTMLButtonElement>('[data-coco-signal="composite"]')!;
  const swap = root.querySelector<HTMLButtonElement>("[data-coco-phase]")!;
  let useComposite = true, reverse = false;
  direct.addEventListener("click", () => { if (useComposite) { useComposite = false; changed(); } });
  composite.addEventListener("click", () => { if (!useComposite) { useComposite = true; changed(); } });
  swap.addEventListener("click", () => { reverse = !reverse; changed(); });
  return {
    get signal(): CocoVideoSignal { return useComposite ? (reverse ? "composite-reversed" : "composite") : "direct"; },
    refresh(machine: Coco): ImageData | undefined {
      direct.setAttribute("aria-pressed", String(!useComposite));
      composite.setAttribute("aria-pressed", String(useComposite));
      swap.setAttribute("aria-pressed", String(reverse));
      swap.disabled = !useComposite || !machine.vdg.artifactMode(machine.pias.videoPins);
      let pixels: Uint8Array;
      try { pixels = renderCocoFrame(machine, this.signal); }
      catch (cause) {
        swap.disabled = true;
        context.clearRect(0, 0, 256, 192); text.textContent = ""; notice.hidden = false;
        notice.textContent = machine.firmware.loaded ? "Display mode not supported yet" : "Load your Color BASIC ROM";
        status.textContent = machine.firmware.loaded ? (cause instanceof Error ? cause.message : String(cause)) : `${machine.ram.size / 1024} KiB RAM ready · no ROM loaded`;
        return;
      }
      notice.hidden = true;
      for (let i = 0; i < pixels.length; i++) {
        const rgb = cocoMonitorColours[pixels[i]!]!;
        image.data[i * 4] = rgb >> 16; image.data[i * 4 + 1] = rgb >> 8 & 255;
        image.data[i * 4 + 2] = rgb & 255; image.data[i * 4 + 3] = 255;
      }
      context.putImageData(image, 0, 0); text.textContent = cocoScreenText(machine);
      const description = useComposite && machine.vdg.artifactMode(machine.pias.videoPins)
        ? ` · Composite${reverse ? " · swapped" : ""}` : "";
      status.textContent = cocoDisplayStatus(machine) + description;
      return image;
    },
  };
}
