import type { ByteMemory } from "./memory-access.ts";

/**
 * Modify a byte at an already resolved address. Both sequences read, transform, then write the result;
 * NMOS writeback inserts an original-value write before the transform. Unchanged writes still occur.
 * The transform may update flags; callers schedule any later flags after this returns.
 * Errors propagate without rollback or later effects. Address mapping belongs to the memory callbacks.
 */
export function modifyByte(address: number, transform: (value: number) => number, { readByte, writeByte }: ByteMemory,
  writeback: "result" | "original-and-result" = "result"): number {
  const value = readByte(address);
  if (writeback === "original-and-result") writeByte(address, value);
  const result = transform(value);
  writeByte(address, result);
  return result;
}
