import type { ByteOutputSnapshot } from "../../src/components/devices/byte-output.js";
import { describeCharacterByte, terminalOutputLimit } from "./terminal-lesson.js";
import type { TerminalOutputSnapshot } from "./terminal-lesson.js";

/** Render captured output only; input and CPU state must not invent characters on the display. */
export function renderTerminalOutput(root: HTMLElement, output: TerminalOutputSnapshot,
  device: ByteOutputSnapshot & { readonly writes: number }, running: boolean): void {
  const screen = root.querySelector<HTMLElement>("[data-terminal-text]")!;
  const status = root.querySelector<HTMLElement>("[data-output-status]")!;
  const count = root.querySelector<HTMLElement>("[data-terminal-count]")!;
  const placeholder = root.querySelector<HTMLElement>("[data-terminal-empty]")!;
  if (screen.textContent !== output.text) screen.textContent = output.text;
  placeholder.hidden = output.retained !== 0;
  const message = device.lastByte === null ? "No byte sent yet."
    : `Last output: ${describeCharacterByte(device.lastByte)}.`;
  status.setAttribute("aria-live", running ? "off" : "polite");
  if (status.textContent !== message) status.textContent = message;
  const total = `${device.writes} ${device.writes === 1 ? "write" : "writes"} received. Showing the latest ${output.retained} ${output.retained === 1 ? "byte" : "bytes"} (up to ${terminalOutputLimit}).`;
  // A write can leave the retained text identical. Use the count, not text equality, to follow output.
  if (count.textContent !== total) {
    count.textContent = total;
    screen.scrollTop = screen.scrollHeight;
  }
}
