import { cocoTapeSampleLimit, cocoTapeSampleRate } from "./coco-cassette.ts";

/** Ordinary byte-aligned CoCo CAS blocks become a waveform, never guest memory. */
export function readCocoTapeCas(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0 || bytes.length > 65_536) throw new RangeError("Choose a CoCo CAS file of at most 64 KiB.");
  const samples = new Uint8Array(cocoTapeSampleLimit);
  let position = 0, ticks = 0;
  // One tick is a 2400 Hz cycle. Absolute boundaries prevent accumulated rounding drift.
  function interval(duration: number, wave: boolean): void {
    ticks += duration;
    const end = Math.round(ticks * cocoTapeSampleRate / 2400), start = position;
    if (end > samples.length) throw new RangeError("CAS waveform exceeds the one-minute tape limit.");
    for (; position < end; position++) samples[position] = wave
      ? Math.round(128 + 100 * Math.sin(2 * Math.PI * (position - start + .5) / (end - start))) : 128;
  }
  function byte(value: number): void {
    for (let bit = 0; bit < 8; bit++) interval(value & (1 << bit) ? 1 : 2, true);
  }

  let offset = 0, open = false, files = 0, gapped = false, afterHeader = false;
  while (offset < bytes.length) {
    let leader = 0;
    // CAS stores bytes, not silence lengths. Accept zero padding and short leaders.
    while (bytes[offset] === 0 || bytes[offset] === 0x55) {
      if (bytes[offset] === 0x55) leader++;
      offset++;
    }
    if (offset === bytes.length) break;
    const start = offset;
    if (bytes[offset++] !== 0x3c || offset + 2 > bytes.length) throw new Error("Expected a byte-aligned CoCo CAS block.");
    const type = bytes[offset++]!, length = bytes[offset++]!, end = offset + length;
    if (end >= bytes.length) throw new Error("Truncated CAS block.");
    let checksum = type + length;
    for (let i = offset; i < end; i++) checksum += bytes[i]!;
    if (bytes[end] !== (checksum & 255)) throw new Error("Invalid CAS block checksum.");
    const gap = type === 0 || afterHeader || gapped;
    if (type === 0) {
      if (open || length !== 15) throw new Error("Expected a 15-byte CAS filename header after end-of-file.");
      if (bytes[offset + 8]! > 2 || ![0, 255].includes(bytes[offset + 9]!) || ![0, 255].includes(bytes[offset + 10]!)) {
        throw new Error("Unsupported CAS file type or mode.");
      }
      open = true; files++; gapped = bytes[offset + 10] === 255;
    } else if (type === 1) {
      if (!open) throw new Error("CAS data block has no filename header.");
    } else if (type === 255) {
      if (!open || length !== 0) throw new Error("Invalid CAS end-of-file block.");
      open = false; gapped = false;
    } else throw new Error("Unsupported CAS block type.");

    if (gap) interval(2400, false); // Allow the ROM's motor-start delay before sync.
    for (let i = 0; i < Math.max(leader, gap ? 128 : 1); i++) byte(0x55);
    for (let i = start; i <= end; i++) byte(bytes[i]!);
    byte(0x55);
    afterHeader = type === 0;
    offset = end + 1;
  }
  if (open || files === 0) throw new Error("CAS requires complete files with filename and end-of-file blocks.");
  return samples.slice(0, position);
}
