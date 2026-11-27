import { inspectCocoPixel, type Coco } from "../../src/machines/6809/coco/runtime.js";
import { cocoHex } from "./coco-inspection.js";
import { rasterPixelAt } from "./raster-pixel.js";

interface PausedCocoFrame { machine: Coco; image: ImageData }

/** Keep the selected dot across steps and restores. Report the colour of the actual rendered frame. */
export function createCocoPixelInspector(root: HTMLElement, watchWrites: (address: number) => void) {
  const screen = root.querySelector<HTMLElement>("[data-coco-screen]")!, canvas = screen.querySelector("canvas")!;
  const marker = screen.querySelector<HTMLElement>("[data-pixel-marker]")!;
  const toggle = root.querySelector<HTMLButtonElement>("[data-screen-inspect]")!;
  const panel = root.querySelector<HTMLElement>("[data-pixel-inspector]")!;
  const readout = panel.querySelector<HTMLOutputElement>("output")!;
  const watch = panel.querySelector<HTMLButtonElement>("button")!;
  const notice = panel.querySelector<HTMLElement>("[data-pixel-message]")!;
  let paused: PausedCocoFrame | undefined;
  let enabled = false, x = 128, y = 96, address: number | undefined;

  function render(): void {
    const dot = paused && inspectCocoPixel(paused.machine, x, y);
    const active = enabled && dot !== undefined;
    if (!active || dot.address !== address) notice.textContent = "";
    address = active ? dot.address : undefined;
    toggle.disabled = !dot; toggle.setAttribute("aria-pressed", String(active));
    marker.hidden = panel.hidden = !active; screen.classList.toggle("is-inspecting", active);
    screen.setAttribute("aria-describedby", active ? readout.id : "coco-keys");
    if (!paused || !active) return;
    marker.style.left = `${(x + 0.5) / canvas.width * 100}%`;
    marker.style.top = `${(y + 0.5) / canvas.height * 100}%`;
    const offset = 4 * (y * canvas.width + x);
    const rgb = paused.image.data.subarray(offset, offset + 3);
    const detail = `(${x},${y}) · RAM $${cocoHex(dot.address)} = $${cocoHex(dot.byte, 2)}`
      + ` · bit ${dot.bit} = ${dot.byte >> dot.bit & 1} · RGB(${rgb.join(", ")})`;
    if (readout.textContent !== detail) readout.textContent = detail;
  }
  toggle.onclick = () => { enabled = !enabled; render(); screen.focus({ preventScroll: true }); };
  canvas.addEventListener("click", event => {
    if (address === undefined) return;
    const dot = rasterPixelAt(canvas.getBoundingClientRect(), event.clientX, event.clientY, canvas.width, canvas.height);
    if (dot) { x = dot.x; y = dot.y; render(); screen.focus({ preventScroll: true }); }
  });
  watch.onclick = () => {
    if (address === undefined) return;
    try {
      watchWrites(address);
      notice.textContent = `Watching writes to physical RAM $${cocoHex(address)}.`;
    } catch (cause) { notice.textContent = (cause as Error).message; }
  };
  return {
    get active() { return address !== undefined; },
    refresh(frame?: PausedCocoFrame): void {
      if (!frame && !paused) return;
      paused = frame; render();
    },
    handleKey(event: KeyboardEvent): boolean {
      if (address === undefined) return false;
      switch (event.key) {
        case "ArrowLeft": x = Math.max(0, x - 1); break;
        case "ArrowRight": x = Math.min(canvas.width - 1, x + 1); break;
        case "ArrowUp": y = Math.max(0, y - 1); break;
        case "ArrowDown": y = Math.min(canvas.height - 1, y + 1); break;
        case "Escape": enabled = false; break;
        default: return true;
      }
      event.preventDefault(); render(); return true;
    },
  };
}
