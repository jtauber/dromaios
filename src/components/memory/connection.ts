/** A byte-addressable connection; size describes its address space, including unmapped regions. */
export interface MemoryConnection {
  readonly size: number;
  /** Return a byte on success, or signal a failed transfer without completing it. */
  read(address: number): number | "bus-error";
  /** Return nothing on success. A failed transfer must not write the byte. */
  write(address: number, value: number): void | "bus-error";
}
