import { xtDisketteSize } from "../../src/machines/8088/pc-xt/io.js";
import { checkMachineSnapshot } from "../../src/machines/snapshot.js";
import type { XtSessionState } from "./xt-session.js";

// Keep the storage slot stable so earlier browser checkpoints remain discoverable.
export const xtCheckpointKey = "dromaios:ibm-xt:checkpoint:v1";

function pack(bytes: readonly number[]): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.slice(i, i + 8192));
  return btoa(binary);
}
function unpack(value: unknown, size: number, field = "memory"): number[] {
  if (typeof value !== "string" || value.length !== Math.ceil(size / 3) * 4) throw new Error(`Incorrect XT checkpoint ${field} size.`);
  const bytes = atob(value);
  if (bytes.length !== size) throw new Error(`Incomplete XT checkpoint ${field}.`);
  return Array.from(bytes, char => char.charCodeAt(0));
}

/** RAM, video and the mounted disk each have one packed copy. */
export function encodeXtCheckpoint({ hardware, keyboard, diskName }: XtSessionState): string {
  const { io } = hardware;
  const video = "ega" in hardware
    ? { ega: { ...hardware.ega, planes: pack(hardware.ega.planes) } } : { video: pack(hardware.video) };
  return JSON.stringify({ version: 2, machine: "ega" in hardware ? "ibm-pc-xt-ega" : "ibm-pc-xt", keyboard, diskName, hardware: {
    ...hardware, ram: pack(hardware.ram), ...video,
    io: { ...io, disketteImage: io.disketteImage && pack(io.disketteImage) },
  } });
}
export function decodeXtCheckpoint(text: string, ega = false): XtSessionState {
  if (text.length > 1_100_000 + xtDisketteSize / 3 * 4 + (ega ? 350_000 : 0)) throw new Error("XT checkpoint is too large.");
  const data = JSON.parse(text);
  const legacy = !ega && data?.version === 1;
  if (data?.machine !== (ega ? "ibm-pc-xt-ega" : "ibm-pc-xt") || (!legacy && data.version !== 2)) {
    throw new Error("This checkpoint belongs to a different machine or version.");
  }
  checkMachineSnapshot(data, legacy ? ["version", "machine", "hardware", "keyboard"] : ["version", "machine", "hardware", "keyboard", "diskName"]);
  const hardware = { ...data.hardware, ram: unpack(data.hardware?.ram, 0xa0000), ...(ega
    ? { ega: { ...data.hardware?.ega, planes: unpack(data.hardware?.ega?.planes, 0x40000, "EGA planes") } }
    : { video: unpack(data.hardware?.video, 0x4000) }) };
  // The version-1 laboratory always had an empty drive. Its oldest board snapshots predate disketteImage.
  if (legacy) return { hardware, keyboard: data.keyboard, diskName: null };
  const disk = hardware.io?.disketteImage;
  if (disk !== null) hardware.io = { ...hardware.io, disketteImage: unpack(disk, xtDisketteSize, "disk") };
  return { hardware, keyboard: data.keyboard, diskName: data.diskName };
}
