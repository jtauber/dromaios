import type { IbmEga } from "../../src/components/devices/ibm-ega.js";
import { describeXtPixel, dmaWritesXtVideo, egaPixelAt, xtEgaPixelReadout } from "./xt-ega-pixel.js";
import type { Catalogue8088 } from "./8088-disassembly.js";
import type { DebugLocation } from "./instruction-debugger.js";
import { xtBoundaryEvent, xtHistoryAssembly } from "./xt-history.js";
import { xtDebugLocation, type createXtDebugger } from "./xt-debugger.js";

export function createXtEgaPixelInspector(panel: HTMLElement, debug: Pick<ReturnType<typeof createXtDebugger>, "pixelTarget" | "pixelHit">,
  cpu: Catalogue8088, run: (x: number, y: number) => void, browse: (location: DebugLocation) => void) {
  const screen = panel.querySelector<HTMLElement>("[data-screen]")!;
  const canvas = screen.querySelector("canvas")!;
  const toggle = panel.querySelector<HTMLButtonElement>("[data-screen-inspect]")!;
  const marker = screen.querySelector<HTMLElement>("[data-pixel-marker]")!;
  const readout = panel.querySelector<HTMLElement>("[data-pixel-readout]")!;
  const until = panel.querySelector<HTMLButtonElement>("[data-pixel-until]")!;
  const waiting = panel.querySelector<HTMLElement>("[data-pixel-waiting]")!;
  const result = panel.querySelector<HTMLElement>("[data-pixel-result]")!;
  const writer = result.querySelector("button")!, before = result.querySelector<HTMLElement>("[data-pixel-before]")!;
  const after = result.querySelector<HTMLElement>("[data-pixel-after]")!;
  const help = panel.querySelector<HTMLElement>("#xt-input-help")!, typingHelp = help.textContent;
  let selected = { x: 160, y: 100 }, enabled = false;
  let pausedDisplay: IbmEga | undefined;

  function render(): void {
    const active = enabled && pausedDisplay !== undefined;
    const wasActive = !marker.hidden;
    if (active !== wasActive) {
      marker.hidden = until.hidden = !active;
      toggle.setAttribute("aria-pressed", String(active));
      screen.classList.toggle("is-inspecting", active);
      help.textContent = active ? "Click a dot or use the arrow keys. Escape returns to typing." : typingHelp;
    }
    const target = debug.pixelTarget, hit = debug.pixelHit;
    waiting.hidden = !target;
    if (target) waiting.textContent = `Waiting for pixel (${target.x},${target.y}) to change…`;
    const showHit = active && hit?.x === selected.x && hit.y === selected.y;
    result.hidden = !showHit; readout.hidden = !active || showHit;
    if (!active) return;
    marker.style.left = `${(selected.x + 0.5) / 320 * 100}%`;
    marker.style.top = `${(selected.y + 0.5) / 200 * 100}%`;
    if (showHit) {
      const caller = xtDebugLocation(hit.record.before), bytes = hit.record.instruction?.bytes;
      const assembly = bytes ? xtHistoryAssembly(cpu, caller, bytes) : xtBoundaryEvent(hit.record);
      writer.textContent = `${caller.space} · ${assembly}${dmaWritesXtVideo(hit.record) ? " (DMA2 video write at this boundary)" : ""}`;
      before.textContent = `Pixel (${hit.x},${hit.y}) · ${hit.afterBlanking ? "Before blanking" : "Before"} · ${describeXtPixel(hit.before)}`;
      after.textContent = `${hit.afterBlanking ? "Display re-enabled" : "After"} · ${describeXtPixel(hit.after)}`;
    } else {
      const detail = xtEgaPixelReadout(pausedDisplay!, selected.x, selected.y);
      if (readout.textContent !== detail) readout.textContent = detail;
    }
  }

  function select(x: number, y: number): void {
    if (!pausedDisplay) return;
    selected = { x, y }; enabled = true;
    render(); screen.focus({ preventScroll: true });
  }

  toggle.onclick = () => {
    enabled = !enabled; render(); screen.focus({ preventScroll: true });
  };
  until.onclick = () => { if (pausedDisplay && enabled) run(selected.x, selected.y); };
  writer.onclick = () => { if (debug.pixelHit) browse(xtDebugLocation(debug.pixelHit.record.before)); };
  canvas.addEventListener("click", event => {
    if (!enabled || !pausedDisplay) return;
    const dot = egaPixelAt(canvas.getBoundingClientRect(), event.clientX, event.clientY);
    if (dot) select(dot.x, dot.y);
  });

  return {
    get available() { return Boolean(pausedDisplay); },
    get active() { return enabled && Boolean(pausedDisplay); },
    select,
    refresh(ega: IbmEga | undefined, runnable: boolean): void {
      pausedDisplay = ega?.videoEnabled && ega.graphicsSupported ? ega : undefined;
      toggle.disabled = !pausedDisplay;
      until.disabled = !runnable || !pausedDisplay;
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
