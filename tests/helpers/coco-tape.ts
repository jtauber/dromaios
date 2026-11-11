import assert from "node:assert/strict";

// Independent format check: recover periods from the waveform, then decode LSB-first
// bytes and the manual's $55/$3C/type/length/data/checksum blocks. Never used to load RAM.
export function tapeBlocks(samples: Uint8Array) {
  const bits: number[] = []; let previous = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i]! > 128 && samples[i - 1]! <= 128) {
    const period = i - previous; previous = i;
    bits.push(period >= 17 && period <= 46 ? Number(period < 30) : -1);
  }
  function byte(at: number): number {
    let result = 0;
    for (let bit = 0; bit < 8; bit++) {
      const value = bits[at + bit]; if (value === undefined || value < 0) return -1;
      result |= value << bit;
    }
    return result;
  }
  const blocks: { type: number; data: number[] }[] = [];
  for (let i = 0; i + 32 < bits.length; i++) {
    if (byte(i) !== 0x55 || byte(i + 8) !== 0x3c) continue;
    const type = byte(i + 16), size = byte(i + 24), data = Array.from({ length: size }, (_, j) => byte(i + 32 + j * 8));
    assert.ok(type >= 0 && size >= 0 && data.every(value => value >= 0));
    assert.equal(byte(i + 32 + size * 8), (type + size + data.reduce((sum, value) => sum + value, 0)) & 255);
    blocks.push({ type, data }); i += (5 + size) * 8 - 1;
  }
  return blocks;
}


/** Construct ordinary CAS blocks independently of the production waveform importer. */
export function casBlock(type: number, data: readonly number[]): number[] {
  return [0x55, 0x3c, type, data.length, ...data,
    (type + data.length + data.reduce((sum, byte) => sum + byte, 0)) & 255, 0x55];
}
