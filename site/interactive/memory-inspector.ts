import { captureMemory, memoryViewport, parseMemoryAddress } from "./memory-window.js";
import { createInspectorChoices } from "./inspector-controls.js";
import { checkUnsigned } from "../../src/components/validation.js";

const hex = (value: number, width = 4) => value.toString(16).toUpperCase().padStart(width, "0");
interface MemoryInspectorOptions {
  readonly size?: number;
  readonly initialAddress?: number;
  readonly parseAddress?: (text: string) => number;
  readonly followChoices?: readonly { readonly value: string; readonly label: string; readonly title: string }[];
}

/** A scrolling storage inspector. Its controls and repainting use detached observations. */
export function createMemoryInspector(panel: HTMLElement, storageKey: string, moved: () => void = () => {}, options: MemoryInspectorOptions = {}) {
  const size = options.size ?? 0x10000, digits = (size - 1).toString(16).length;
  const addressText = (value: number) => hex(value, digits);
  const parseAddress = options.parseAddress ?? (text => parseMemoryAddress(text, size - 1));
  const scroller = panel.querySelector<HTMLElement>("[data-memory-scroll]")!;
  const space = panel.querySelector<HTMLElement>("[data-memory-space]")!;
  const output = panel.querySelector<HTMLElement>("[data-memory-output]")!;
  let image: Int16Array = new Int16Array(size).fill(-1), previous: Int16Array = image;
  let initialized = false, address = options.initialAddress ?? 0x400, rowWidth: 8 | 16 = 16, follow = "fixed";
  let expectedScroll: number | undefined, lastScroll = 0, height = 0;
  let observed: Readonly<Record<string, number>> = {};
  const changed = new Set<number>();
  try { if (localStorage.getItem(`${storageKey}:width`) === "8") rowWidth = 8; }
  catch { /* Default widths work without browser storage. */ }
  const input = document.createElement("input"); input.value = addressText(address); input.maxLength = options.parseAddress ? 32 : digits + 2;
  input.setAttribute("aria-label", "Memory address"); input.spellcheck = false;
  const form = document.createElement("form"); form.className = "lab-memory-address"; form.append(input);
  const modes = createInspectorChoices("Memory follows", [
    { value: "fixed", label: "FIX", title: "Keep the memory position fixed" },
    ...(options.followChoices ?? [
      { value: "pc", label: "PC", title: "Follow the program counter" },
      { value: "changed", label: "CHG", title: "Follow the first changed byte since the previous observation" },
    ]),
  ], follow, value => {
    follow = value;
    const destination = target();
    if (destination !== undefined) jump(destination);
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
  function target() { return follow === "changed" ? changed.values().next().value : observed[follow]; }
  function viewport() { return memoryViewport(scroller.scrollTop, scroller.clientHeight, rowWidth, lineHeight(), size); }
  function draw(): void {
    const view = viewport(); space.style.height = `${view.totalHeight}px`; output.style.top = `${view.top}px`;
    const contents = document.createDocumentFragment();
    for (let start = view.start; start < view.start + view.length; start += rowWidth) {
      contents.append(`${start === view.start ? "" : "\n"}${addressText(start)} `);
      for (let offset = 0; offset < rowWidth; offset++) {
        const location = start + offset, value = image[location]!;
        const byte = document.createElement("span"); byte.className = "lab-memory-byte";
        byte.dataset.memoryByte = addressText(location); byte.textContent = value < 0 ? "--" : hex(value, 2);
        byte.classList.toggle("is-selected", location === address);
        byte.classList.toggle("is-changed", changed.has(location));
        byte.title = value < 0 ? `$${addressText(location)}: no observable storage`
          : `$${addressText(location)}` + (changed.has(location) ? `: ${hex(previous[location]!, 2)} → ${hex(value, 2)}` : "");
        contents.append(" ", byte);
      }
    }
    output.replaceChildren(contents);
  }
  function jump(value: number): void {
    checkUnsigned("Memory address", value, size - 1);
    const changed = address !== value; address = value; input.value = addressText(address);
    input.setCustomValidity("");
    space.style.height = `${size / rowWidth * lineHeight()}px`;
    scroller.scrollTop = Math.floor(address / rowWidth) * lineHeight();
    expectedScroll = lastScroll = scroller.scrollTop; draw(); if (changed) moved();
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    try {
      const value = parseAddress(input.value);
      checkUnsigned("Memory address", value, size - 1);
      follow = "fixed"; modes.select(follow); jump(value);
    } catch (error) { input.setCustomValidity((error as Error).message); input.reportValidity(); }
  });
  input.addEventListener("input", () => input.setCustomValidity(""));
  scroller.addEventListener("scroll", () => {
    // Layout changes can clamp scrollTop before ResizeObserver has run.
    if (height !== scroller.clientHeight) return;
    if (expectedScroll !== undefined && Math.abs(scroller.scrollTop - expectedScroll) < .5) { expectedScroll = undefined; draw(); return; }
    expectedScroll = undefined;
    if (Math.abs(scroller.scrollTop - lastScroll) < .5) return;
    lastScroll = scroller.scrollTop;
    follow = "fixed"; modes.select(follow); address = viewport().address; input.value = addressText(address); input.setCustomValidity(""); draw(); moved();
  });
  new ResizeObserver(() => {
    const resized = height !== scroller.clientHeight; height = scroller.clientHeight;
    if (resized && height > 0) jump(address); else draw();
  }).observe(scroller);
  return {
    controls,
    get address() { return address; },
    browse(value: number): void { follow = "fixed"; modes.select(follow); jump(value); },
    reset(): void { initialized = false; changed.clear(); },
    refresh(read: (address: number) => number | undefined, pc: number, pointers: Readonly<Record<string, number>> = {}): void {
      observed = { ...pointers, pc };
      const first = !initialized;
      previous = image; image = captureMemory(read, size); changed.clear();
      if (initialized) for (let i = 0; i < image.length; i++) {
        if (image[i]! >= 0 && previous[i]! >= 0 && image[i] !== previous[i]) changed.add(i);
      }
      initialized = true;
      const destination = target();
      if (first || destination !== undefined && destination !== address) jump(destination ?? address); else draw();
    },
  };
}
