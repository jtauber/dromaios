import { checkMachineSnapshot } from "../../src/machines/snapshot.js";
import type { XtSessionState } from "./xt-session.js";

export const xtCheckpointKey = "dromaios:ibm-xt:checkpoint:v1";

function pack(bytes: readonly number[]): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.slice(i, i + 8192));
  return btoa(binary);
}
function unpack(value: unknown, size: number): number[] {
  if (typeof value !== "string" || value.length !== Math.ceil(size / 3) * 4) throw new Error("Incorrect XT checkpoint memory size.");
  const bytes = atob(value);
  if (bytes.length !== size) throw new Error("Incomplete XT checkpoint memory.");
  return Array.from(bytes, char => char.charCodeAt(0));
}

/** Keep the two RAM arrays compact enough for browser storage. ROM sockets contain identities only. */
export function encodeXtCheckpoint({ hardware, keyboard }: XtSessionState): string {
  return JSON.stringify({ version: 1, machine: "ibm-pc-xt", hardware: { ...hardware, ram: pack(hardware.ram), video: pack(hardware.video) }, keyboard });
}
export function decodeXtCheckpoint(text: string): XtSessionState {
  if (text.length > 1_100_000) throw new Error("XT checkpoint is too large.");
  const data = JSON.parse(text);
  checkMachineSnapshot(data, ["version", "machine", "hardware", "keyboard"]);
  if (data.version !== 1 || data.machine !== "ibm-pc-xt") throw new Error("This checkpoint belongs to a different machine or version.");
  const hardware = { ...data.hardware, ram: unpack(data.hardware?.ram, 0xa0000), video: unpack(data.hardware?.video, 0x4000) };
  return { hardware, keyboard: data.keyboard };
}
