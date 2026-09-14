/** Interpret an unsigned byte as a signed integer. The input must already be in range. */
export function signed8(byte: number): number {
  return byte < 0x80 ? byte : byte - 0x100;
}

/** Read two unsigned bytes, low byte first. The callback owns addressing and any side effects. */
export function readWordLE(nextByte: () => number): number {
  const low = nextByte();
  const high = nextByte();
  return low | (high << 8);
}

/** Read two unsigned bytes, high byte first. The callback owns addressing and any side effects. */
export function readWordBE(nextByte: () => number): number {
  const high = nextByte();
  const low = nextByte();
  return (high << 8) | low;
}
