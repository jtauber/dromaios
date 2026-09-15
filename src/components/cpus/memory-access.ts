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

/** Create a fresh log; optionally report completed accesses to a combined bus log as they happen. */
export function recordMemory(ram: Ram, onAccess?: (access: MemoryAccess) => void): RecordedMemory {
  const accesses: MemoryAccess[] = [];
  const record = (access: MemoryAccess): void => { accesses.push(access); onAccess?.(access); };
  return {
    accesses,
    readByte: address => {
      const value = ram.read(address);
      record({ kind: "read", address, value });
      return value;
    },
    writeByte: (address, value) => {
      ram.write(address, value);
      record({ kind: "write", address, value });
    },
  };
}
