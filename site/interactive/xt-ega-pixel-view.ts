import type { IbmEga } from "../../src/components/devices/ibm-ega.js";
import { egaPixelAt, xtEgaPixelReadout } from "./xt-ega-pixel.js";

export function createXtEgaPixelInspector(panel: HTMLElement) {
  const screen = panel.querySelector<HTMLElement>("[data-screen]")!;
  const canvas = screen.querySelector("canvas")!;
  const toggle = panel.querySelector<HTMLButtonElement>("[data-screen-inspect]")!;
  const marker = screen.querySelector<HTMLElement>("[data-pixel-marker]")!;
  const readout = panel.querySelector<HTMLElement>("[data-pixel-readout]")!;
  const help = panel.querySelector<HTMLElement>("#xt-input-help")!, typingHelp = help.textContent;
  let selected = { x: 160, y: 100 }, enabled = false;
  let pausedDisplay: IbmEga | undefined;

  function render(): void {
    const active = enabled && pausedDisplay !== undefined;
    const wasActive = !marker.hidden;
    if (active !== wasActive) {
      marker.hidden = readout.hidden = !active;
      toggle.setAttribute("aria-pressed", String(active));
      screen.classList.toggle("is-inspecting", active);
      help.textContent = active ? "Click a dot or use the arrow keys. Escape returns to typing." : typingHelp;
    }
    if (!active) return;
    marker.style.left = `${(selected.x + 0.5) / 320 * 100}%`;
    marker.style.top = `${(selected.y + 0.5) / 200 * 100}%`;
    const detail = xtEgaPixelReadout(pausedDisplay!, selected.x, selected.y);
    if (readout.textContent !== detail) readout.textContent = detail;
  }

  function select(x: number, y: number): void {
    if (!pausedDisplay) return;
    selected = { x, y }; enabled = true;
    render(); screen.focus({ preventScroll: true });
  }

  toggle.onclick = () => {
    enabled = !enabled; render(); screen.focus({ preventScroll: true });
  };
  canvas.addEventListener("click", event => {
    if (!enabled || !pausedDisplay) return;
    const dot = egaPixelAt(canvas.getBoundingClientRect(), event.clientX, event.clientY);
    if (dot) select(dot.x, dot.y);
  });

  return {
    get available() { return Boolean(pausedDisplay); },
    get active() { return enabled && Boolean(pausedDisplay); },
    select,
    refresh(ega: IbmEga | undefined): void {
      pausedDisplay = ega?.videoEnabled && ega.graphicsSupported ? ega : undefined;
      toggle.disabled = !pausedDisplay;
      render();
    },
    handleKey(event: KeyboardEvent): boolean {
      if (!this.active) return false;
      switch (event.key) {
        case "Escape": enabled = false; break;
        case "ArrowLeft": selected.x = Math.max(0, selected.x - 1); break;
        case "ArrowRight": selected.x = Math.min(319, selected.x + 1); break;
        case "ArrowUp": selected.y = Math.max(0, selected.y - 1); break;
        case "ArrowDown": selected.y = Math.min(199, selected.y + 1); break;
        default: return true;
      }
      event.preventDefault(); render(); return true;
    },
  };
}
