import type { Apple2Video } from "../../src/components/devices/generated/apple2-video.js";

export interface TextCell { readonly character: string; readonly inverse: boolean }

/** Frame inspection uses RAM and read-only generated views, never guest I/O reads. */
export function apple2TextFrame(ram: { read(address: number): number }, video: Apple2Video, flash: boolean): readonly (readonly TextCell[])[] {
  return Array.from({ length: 24 }, (_, row) => Array.from({ length: 40 }, (_, column) => {
    if (!video.visibleRow(row)) return { character: " ", inverse: false };
    const byte = ram.read(video.textAddress(row, column));
    return { character: String.fromCharCode(video.characterCode(byte)), inverse: video.inverse(byte, flash) };
  }));
}
