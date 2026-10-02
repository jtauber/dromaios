import { RomImage } from "../../src/machines/rom-image.js";
import type { RomIdentity } from "../../src/machines/rom-image.js";

export interface RomFile { readonly name: string; readonly image: RomImage }
export interface RomContainer { readonly bytes: number; readonly sha256: string; readonly offset: number }

/** Verify a complete file before normalizing it; the caller replaces hardware only after success. */
export async function readRomFile(file: {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}, expected: RomIdentity, container?: RomContainer): Promise<RomFile> {
  if (container !== undefined && (!Number.isSafeInteger(container.offset) || container.offset < 0
    || container.offset + expected.size !== container.bytes)) throw new Error("Invalid ROM container layout.");
  if (file.size !== expected.size && file.size !== container?.bytes) {
    throw new Error(`Choose the ${expected.size.toLocaleString()}-byte ROM${container ? ` or its ${container.bytes.toLocaleString()}-byte container` : ""}.`);
  }
  let bytes = new Uint8Array(new Uint8Array(await file.arrayBuffer()));
  if (bytes.length !== file.size) throw new Error("The ROM file size changed while reading.");
  if (bytes.length !== expected.size) {
    await RomImage.verify(bytes, { size: container!.bytes, sha256: container!.sha256 }, sha256);
    bytes = bytes.slice(container!.offset);
  }
  return { name: file.name, image: await RomImage.verify(bytes, expected, sha256) };
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
