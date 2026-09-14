import type { Ram } from "../memory/ram.js";

/** A completed byte access at the address supplied to RAM. */
export interface MemoryAccess {
  readonly kind: "read" | "write";
  readonly address: number;
  readonly value: number;
}

/** Byte-memory callbacks; their caller selects the addresses to access. */
export interface ByteMemory {
  readonly readByte: (address: number) => number;
  readonly writeByte: (address: number, value: number) => void;
}

export interface RecordedMemory extends ByteMemory {
  readonly accesses: readonly MemoryAccess[];
}

/** Create a fresh access log for one step or reset. Creation does not access RAM. */
export function recordMemory(ram: Ram): RecordedMemory {
  const accesses: MemoryAccess[] = [];
  return {
    accesses,
    readByte: address => {
      const value = ram.read(address);
      accesses.push({ kind: "read", address, value });
      return value;
    },
    writeByte: (address, value) => {
      ram.write(address, value);
      accesses.push({ kind: "write", address, value });
    },
  };
}
