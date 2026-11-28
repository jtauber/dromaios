import { pixelColour, type ScreenComparison } from "./screen-comparison.js";
import { rasterPixelAt } from "./raster-pixel.js";

export function createScreenComparisonView(panel: HTMLElement, inspectPixel: (x: number, y: number) => void) {
  const view = panel.querySelector<HTMLElement>("[data-screen-comparison]")!;
  const status = panel.querySelector<HTMLElement>("[data-screen-comparison-status]")!;
  const canvas = view.querySelector("canvas")!, context = canvas.getContext("2d")!;
  const marker = view.querySelector<HTMLElement>("[data-comparison-marker]")!;
  const inspect = view.querySelector<HTMLButtonElement>("[data-comparison-inspect]")!;
  const prev = view.querySelector<HTMLButtonElement>("[data-comparison-prev]")!;
  const next = view.querySelector<HTMLButtonElement>("[data-comparison-next]")!;
  const colours = view.querySelector("output")!;
  let capture: ScreenComparison | undefined, selected = 0;

  function select(index: number): void {
    if (!capture) return;
    const dot = capture.changed[index];
    if (dot === undefined) return;
    selected = index;
    const x = dot % canvas.width, y = Math.floor(dot / canvas.width);
    marker.style.left = `${(x + 0.5) / canvas.width * 100}%`;
    marker.style.top = `${(y + 0.5) / canvas.height * 100}%`;
    inspect.textContent = inspect.disabled ? `(${x},${y})` : `Inspect (${x},${y})`;
    const rgb = (frame: ScreenComparison["before"]) => "#" + pixelColour(frame, dot).toString(16).padStart(6, "0").toUpperCase();
    colours.textContent = `${rgb(capture.before)} → ${rgb(capture.after)}`;
    prev.disabled = index === 0; next.disabled = index === capture.changed.length - 1;
  }
  prev.onclick = () => select(selected - 1);
  next.onclick = () => select(selected + 1);
  inspect.onclick = () => {
    const dot = capture?.changed[selected];
    if (dot !== undefined) inspectPixel(dot % canvas.width, Math.floor(dot / canvas.width));
  };
  canvas.onclick = event => {
    const point = rasterPixelAt(canvas.getBoundingClientRect(), event.clientX, event.clientY, canvas.width, canvas.height);
    if (!point || !capture) return;
    const index = capture.changed.indexOf(point.y * canvas.width + point.x);
    if (index >= 0) { select(index); if (!inspect.disabled) inspectPixel(point.x, point.y); }
  };
  function clear(): void { capture = undefined; view.hidden = true; status.textContent = ""; }
  return {
    clear,
    show(label: string, compare: () => ScreenComparison, inspectable = true): void {
      clear();
      try { capture = compare(); }
      catch (cause) { status.textContent = `Screen comparison unavailable. ${cause instanceof Error ? cause.message : cause}`; return; }
      const { before, after, changed } = capture;
      status.textContent = `Screen · ${changed.length.toLocaleString()} changed dot${changed.length === 1 ? "" : "s"} · ${label}`;
      if (!changed.length) return;
      canvas.width = after.width; canvas.height = after.height;
      inspect.disabled = !inspectable;
      canvas.title = inspectable ? "Click a highlighted dot to inspect it" : "Click a highlighted dot to compare its colours";
      const image = context.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < after.pixels.length; i++) {
        const rgb = pixelColour(after, i);
        const shade = ((rgb >> 16) + 2 * ((rgb >> 8) & 255) + (rgb & 255)) >> 4;
        const different = pixelColour(before, i) !== rgb;
        image.data[4 * i] = different ? 255 : shade;
        image.data[4 * i + 1] = different ? 200 : shade;
        image.data[4 * i + 2] = different ? 80 : shade;
        image.data[4 * i + 3] = 255;
      }
      context.putImageData(image, 0, 0); select(0); view.hidden = false;
    },
  };
}
