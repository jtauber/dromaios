import { createApple2MemoryView } from "./apple2-memory-view.js";
import { captureMemory, memoryViewport } from "./apple2-memory-window.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import type { UpcomingMemoryAccesses } from "./apple2-memory-accesses.js";

/** Scroll a detached storage image. Rendering and scrolling never touch the machine. */
export function createApple2MemoryScrollView(container: HTMLElement | null, navigate: (address: number) => void) {
  if (!container) return undefined;
  const output = container, space = output.parentElement!, scroller = space.parentElement!;
  let image: Int16Array = new Int16Array(0x10000).fill(-1), changes: ReadonlyMap<number, Apple2MemoryChange> = new Map();
  let upcoming: UpcomingMemoryAccesses = new Map();
  let address = 0x400, expectedScroll: number | undefined, initialized = false, lastScrollTop = 0;
  let height = 0;
  const bytes = createApple2MemoryView(output, 128, () => {
    // Keep the selected byte visible, including near FFFF when fewer rows fit.
    jump(address);
  })!;
  function lineHeight(): number { return parseFloat(getComputedStyle(output).lineHeight) || 19.2; }
  function viewport() { return memoryViewport(scroller.scrollTop, scroller.clientHeight, bytes.rowWidth, lineHeight()); }
  function draw(): void {
    const view = viewport(); space.style.height = `${view.totalHeight}px`; output.style.top = `${view.top}px`;
    bytes.render(location => image[location]! < 0 ? undefined : image[location], view.start, changes, upcoming, view.length);
    for (const field of output.querySelectorAll<HTMLElement>("[data-memory-byte], [data-memory-character]")) {
      field.classList.toggle("is-selected", parseInt((field.dataset.memoryByte ?? field.dataset.memoryCharacter)!, 16) === address);
    }
  }
  function jump(value: number): void {
    space.style.height = `${0x10000 / bytes.rowWidth * lineHeight()}px`;
    scroller.scrollTop = Math.floor(value / bytes.rowWidth) * lineHeight();
    expectedScroll = lastScrollTop = scroller.scrollTop; draw();
  }
  scroller.addEventListener("scroll", () => {
    // Resizing near the bottom can clamp scrollTop before ResizeObserver runs.
    if (scroller.clientHeight !== height) { height = scroller.clientHeight; jump(address); return; }
    if (expectedScroll !== undefined && Math.abs(scroller.scrollTop - expectedScroll) < .5) { expectedScroll = undefined; draw(); return; }
    expectedScroll = undefined;
    if (Math.abs(scroller.scrollTop - lastScrollTop) < .5) return;
    lastScrollTop = scroller.scrollTop;
    address = viewport().address; draw(); navigate(address);
  });
  new ResizeObserver(() => {
    const resized = height !== scroller.clientHeight;
    height = scroller.clientHeight;
    // Preserve selection and following mode across docking, resizing and reveal.
    if (resized && height > 0 && initialized) jump(address); else draw();
  }).observe(scroller);
  return {
    control: bytes.control,
    get rowWidth() { return bytes.rowWidth; },
    get visibleStart() { return viewport().address; },
    get visibleBytes() { return viewport().visibleBytes; },
    render(read: (address: number) => number | undefined, start: number, highlights: ReadonlyMap<number, Apple2MemoryChange>, accesses: UpcomingMemoryAccesses): void {
      const first = !initialized; initialized = true;
      image = captureMemory(read); changes = new Map(highlights); upcoming = accesses;
      const moved = first || address !== start; address = start;
      if (moved) jump(start); else draw();
    },
  };
}
