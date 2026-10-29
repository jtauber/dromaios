import { captureMemory, memoryViewport } from "./memory-window.js";
import { createInspectorChoices } from "./inspector-controls.js";

const hex = (value: number, width = 4) => value.toString(16).toUpperCase().padStart(width, "0");
type Follow = "fixed" | "pc" | "changed";

/** A scrolling 16-bit storage inspector. Its controls and repainting use detached observations. */
export function createMemoryInspector(panel: HTMLElement, storageKey: string) {
  const scroller = panel.querySelector<HTMLElement>("[data-memory-scroll]")!;
  const space = panel.querySelector<HTMLElement>("[data-memory-space]")!;
  const output = panel.querySelector<HTMLElement>("[data-memory-output]")!;
  let image: Int16Array = new Int16Array(0x10000).fill(-1), previous: Int16Array = image;
  let initialized = false, address = 0x400, rowWidth: 8 | 16 = 16, follow: Follow = "fixed";
  let expectedScroll: number | undefined, height = 0, observedPc = 0;
  const changed = new Set<number>();
  try { if (localStorage.getItem(`${storageKey}:width`) === "8") rowWidth = 8; }
  catch { /* Default widths work without browser storage. */ }
  const input = document.createElement("input"); input.value = hex(address); input.maxLength = 6;
  input.setAttribute("aria-label", "Memory address"); input.spellcheck = false;
  const form = document.createElement("form"); form.className = "lab-memory-address"; form.append(input);
  const modes = createInspectorChoices<Follow>("Memory follows", [
    { value: "fixed", label: "FIX", title: "Keep the memory position fixed" },
    { value: "pc", label: "PC", title: "Follow the program counter" },
    { value: "changed", label: "CHG", title: "Follow the first changed byte since the previous observation" },
  ], follow, value => {
    follow = value;
    const target = value === "pc" ? observedPc : value === "changed" ? changed.values().next().value : undefined;
    if (target !== undefined) jump(target);
  });
  const widths = createInspectorChoices("Bytes per row", [
    { value: 8 as const, label: "8", title: "8 bytes per row" },
    { value: 16 as const, label: "16", title: "16 bytes per row" },
  ], rowWidth, value => {
    rowWidth = value; jump(address);
    try { localStorage.setItem(`${storageKey}:width`, String(value)); } catch { /* Keep this visit's choice. */ }
  });
  const controls = document.createElement("span"); controls.className = "lab-inspector-controls";
  controls.append(form, modes.element, widths.element);
  function lineHeight(): number { return parseFloat(getComputedStyle(output).lineHeight) || 19.2; }
  function viewport() { return memoryViewport(scroller.scrollTop, scroller.clientHeight, rowWidth, lineHeight()); }
  function draw(): void {
    const view = viewport(); space.style.height = `${view.totalHeight}px`; output.style.top = `${view.top}px`;
    const contents = document.createDocumentFragment();
    for (let start = view.start; start < view.start + view.length; start += rowWidth) {
      contents.append(`${start === view.start ? "" : "\n"}${hex(start)} `);
      for (let offset = 0; offset < rowWidth; offset++) {
        const location = start + offset, value = image[location]!;
        const byte = document.createElement("span"); byte.className = "lab-memory-byte";
        byte.dataset.memoryByte = hex(location); byte.textContent = value < 0 ? "--" : hex(value, 2);
        byte.classList.toggle("is-selected", location === address);
        byte.classList.toggle("is-changed", changed.has(location));
        byte.title = value < 0 ? `$${hex(location)}: no observable storage`
          : `$${hex(location)}` + (changed.has(location) ? `: ${hex(previous[location]!, 2)} → ${hex(value, 2)}` : "");
        contents.append(" ", byte);
      }
    }
    output.replaceChildren(contents);
  }
  function jump(value: number): void {
    address = value; input.value = hex(address);
    space.style.height = `${0x10000 / rowWidth * lineHeight()}px`;
    scroller.scrollTop = Math.floor(address / rowWidth) * lineHeight();
    expectedScroll = scroller.scrollTop; draw();
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    const text = input.value.trim().replace(/^\$|^0x/i, "");
    if (!/^[0-9a-f]{1,4}$/i.test(text)) { input.setCustomValidity("Enter a hexadecimal address from 0000 to FFFF."); input.reportValidity(); return; }
    follow = "fixed"; modes.select(follow); jump(parseInt(text, 16));
  });
  input.addEventListener("input", () => input.setCustomValidity(""));
  scroller.addEventListener("scroll", () => {
    // Layout changes can clamp scrollTop before ResizeObserver has run.
    if (height !== scroller.clientHeight) return;
    if (expectedScroll !== undefined && Math.abs(scroller.scrollTop - expectedScroll) < .5) { expectedScroll = undefined; draw(); return; }
    expectedScroll = undefined;
    follow = "fixed"; modes.select(follow); address = viewport().address; input.value = hex(address); draw();
  });
  new ResizeObserver(() => {
    const resized = height !== scroller.clientHeight; height = scroller.clientHeight;
    if (resized && height > 0) jump(address); else draw();
  }).observe(scroller);
  return {
    controls,
    reset(): void { initialized = false; changed.clear(); },
    refresh(read: (address: number) => number | undefined, pc: number): void {
      observedPc = pc;
      const first = !initialized;
      previous = image; image = captureMemory(read); changed.clear();
      if (initialized) for (let i = 0; i < image.length; i++) {
        if (image[i]! >= 0 && previous[i]! >= 0 && image[i] !== previous[i]) changed.add(i);
      }
      initialized = true;
      const target = follow === "pc" ? pc : follow === "changed" ? changed.values().next().value : undefined;
      if (first || target !== undefined && target !== address) jump(target ?? address); else draw();
    },
  };
}
