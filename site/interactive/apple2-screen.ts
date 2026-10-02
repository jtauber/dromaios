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

/** Invisible rows are absent; only visible graphics fetch bytes from RAM. */
export function apple2LoresFrame(ram: { read(address: number): number }, video: Apple2Video): readonly (readonly number[] | undefined)[] {
  return Array.from({ length: 48 }, (_, row) => video.visibleLoresRow(row)
    ? Array.from({ length: 40 }, (_, column) => video.loresColour(ram.read(video.loresAddress(row, column)), row))
    : undefined);
}

/** Forty captured bytes supply seven colour pairs per two-byte group. */
export function apple2HiresFrame(ram: { read(address: number): number }, video: Apple2Video): readonly (readonly number[] | undefined)[] {
  return Array.from({ length: 192 }, (_, row) => {
    if (!video.visibleHiresRow(row)) return undefined;
    const bytes = Array.from({ length: 40 }, (_, column) => ram.read(video.hiresAddress(row, column)));
    return Array.from({ length: 140 }, (_, column) => {
      const group = Math.floor(column / 7) * 2;
      return video.hiresPairColour(bytes[group]!, bytes[group + 1]!, column % 7);
    });
  });
}
