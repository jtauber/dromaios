import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import type { RomIdentity } from "../../src/machines/rom-image.js";
import { readRomFile, sha256 } from "./rom-file.js";
import type { RomContainer, RomFile } from "./rom-file.js";

interface LocalFile {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface Apple2Media extends RomContainer {
  readonly bootstrap: RomContainer;
  readonly disk: { readonly bytes: number; readonly sha256: string };
}
export interface Apple2RomFile extends RomFile { readonly bootstrap?: readonly number[] }
export interface Apple2DiskFile { readonly name: string; readonly disk: Dos33Disk }

/** The verified container supplies both motherboard firmware and the slot-6 bootstrap. */
export async function readApple2Rom(file: LocalFile, expected: RomIdentity, media: Apple2Media): Promise<Apple2RomFile> {
  // Reuse the same read for container validation and extraction.
  let buffer: Promise<ArrayBuffer> | undefined;
  const arrayBuffer = () => buffer ??= file.arrayBuffer();
  const rom = await readRomFile({ name: file.name, size: file.size, arrayBuffer }, expected, media);
  if (file.size === expected.size) return rom;
  const { bytes, offset, sha256: hash } = media.bootstrap;
  if (bytes !== 256 || !Number.isSafeInteger(offset) || offset < 0 || offset + bytes > media.bytes) {
    throw new Error("Invalid Disk II bootstrap layout.");
  }
  const bootstrap = new Uint8Array(await arrayBuffer()).slice(offset, offset + bytes);
  if (await sha256(bootstrap) !== hash) throw new Error("Disk II bootstrap does not match its declared identity.");
  return { ...rom, bootstrap: Object.freeze(Array.from(bootstrap)) };
}

/** This first profile accepts the selected System Master, without downloading or changing it. */
export async function readApple2Disk(file: LocalFile, expected: Apple2Media["disk"]): Promise<Apple2DiskFile> {
  if (file.size !== expected.bytes || expected.bytes !== Dos33Disk.size) throw new Error("Choose the 143,360-byte DOS 3.3 System Master disk.");
  const bytes = new Uint8Array(new Uint8Array(await file.arrayBuffer()));
  if (bytes.length !== file.size || await sha256(bytes) !== expected.sha256) throw new Error("Disk does not match the selected DOS 3.3 System Master.");
  return { name: file.name, disk: new Dos33Disk(bytes) };
}
