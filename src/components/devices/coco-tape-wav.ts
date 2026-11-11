import { cocoTapeSampleLimit, cocoTapeSampleRate } from "./coco-cassette.ts";

export const cocoTapeFileLimit = cocoTapeSampleLimit + 65_536;

/** Read RIFF structure strictly; metadata is skipped, never interpreted as samples. */
export function readCocoTapeWav(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 44 || bytes.length > cocoTapeFileLimit) throw new RangeError("Expected a WAV tape of at most two minutes.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || view.getUint32(4, true) !== bytes.length - 8) throw new Error("Invalid RIFF/WAVE tape.");
  let format = false, samples: Uint8Array | undefined;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error("Truncated WAV chunk.");
    const size = view.getUint32(offset + 4, true), start = offset + 8, end = start + size;
    if (end + (size & 1) > bytes.length) throw new Error("Truncated WAV chunk data.");
    if (tag(offset) === "fmt ") {
      if (format || size < 16 || view.getUint16(start, true) !== 1 || view.getUint16(start + 2, true) !== 1
        || view.getUint32(start + 4, true) !== cocoTapeSampleRate || view.getUint32(start + 8, true) !== cocoTapeSampleRate
        || view.getUint16(start + 12, true) !== 1 || view.getUint16(start + 14, true) !== 8) {
        throw new Error("Use mono 8-bit PCM WAV at 44,100 Hz.");
      }
      format = true;
    } else if (tag(offset) === "data") {
      if (samples !== undefined || size > cocoTapeSampleLimit) throw new Error("Invalid WAV tape data length.");
      samples = bytes.slice(start, end);
    }
    offset = end + (size & 1);
  }
  if (!format || samples === undefined) throw new Error("WAV tape requires format and data chunks.");
  return samples;
}

export function writeCocoTapeWav(samples: Uint8Array): Uint8Array {
  if (samples.length > cocoTapeSampleLimit) throw new RangeError("Tape exceeds the two-minute limit.");
  const bytes = new Uint8Array(44 + samples.length + (samples.length & 1)), view = new DataView(bytes.buffer);
  function tag(offset: number, value: string): void { for (let i = 0; i < 4; i++) bytes[offset + i] = value.charCodeAt(i); }
  tag(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); tag(8, "WAVE"); tag(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, cocoTapeSampleRate, true); view.setUint32(28, cocoTapeSampleRate, true);
  view.setUint16(32, 1, true); view.setUint16(34, 8, true); tag(36, "data"); view.setUint32(40, samples.length, true);
  bytes.set(samples, 44); return bytes;
}
