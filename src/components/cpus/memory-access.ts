import type { Ram } from "../memory/ram.js";

/** A completed byte access at the address supplied to RAM. */
export interface MemoryAccess {
  readonly kind: "read" | "write";
  readonly address: number;
  readonly value: number;
}

export interface RecordedMemory {
  readonly accesses: readonly MemoryAccess[];
  readonly readByte: (address: number) => number;
  readonly writeByte: (address: number, value: number) => void;
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
