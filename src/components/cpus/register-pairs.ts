interface PairedBytes { b: number; c: number; d: number; e: number; h: number; l: number }

// Each word is a view of its high and low stored bytes, never separate state.
export const pairBytes = { bc: ["b", "c"], de: ["d", "e"], hl: ["h", "l"] } as const;
export type RegisterPair = keyof typeof pairBytes;

export function readRegisterPair(bank: Readonly<PairedBytes>, pair: RegisterPair): number {
  const [high, low] = pairBytes[pair];
  return (bank[high] << 8) | bank[low];
}

export function writeRegisterPair(bank: PairedBytes, pair: RegisterPair, value: number): void {
  const [high, low] = pairBytes[pair];
  bank[high] = value >>> 8;
  bank[low] = value & 0xff;
}

/** Detached derived views for the 8080 and either Z80 register bank. */
export function pairViews(bank: Readonly<PairedBytes>): Readonly<Record<RegisterPair, number>> {
  return { bc: readRegisterPair(bank, "bc"), de: readRegisterPair(bank, "de"), hl: readRegisterPair(bank, "hl") };
}
