import type { ByteOutputSnapshot } from "../../src/components/devices/byte-output.js";
import { renderLamps } from "./lamp-bank.js";
import { hex } from "./register-programs.js";

/** Display the device's stored byte, without reading a port or emitting another write. */
export function renderByteOutput(root: HTMLElement, state: ByteOutputSnapshot & { readonly writes: number }, running: boolean): void {
  const { lastByte, writes } = state;
  const bank = root.querySelector<HTMLElement>("[data-output-lamps]")!;
  const value = lastByte === null ? "No byte sent yet" : `${lastByte} decimal · ${hex(lastByte, 2)} hex`;
  renderLamps(bank, lastByte);
  bank.setAttribute("aria-label", `Output device: ${value}`);
  const status = root.querySelector<HTMLElement>("[data-output-status]")!;
  status.setAttribute("aria-live", running ? "off" : "polite");
  const description = `${value}. ${writes} ${writes === 1 ? "write" : "writes"} received.`;
  if (status.textContent !== description) status.textContent = description;
}
