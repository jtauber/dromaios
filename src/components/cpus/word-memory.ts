import type { MemoryConnection } from "../memory/connection.ts";
import { checkUnsigned } from "../validation.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess, RecordedMemory } from "./memory-access.ts";
import type { WordMemory, WordMemoryFault } from "./word-execution.ts";
import type { WordBusFault } from "./word-events.ts";

// Only explicit connection results create this private unwinding signal. Host throws propagate.
class BusFault implements WordMemoryFault {
  constructor(readonly operation: WordMemoryFault["operation"], readonly address: number, readonly programSpace: boolean) {}
}
export function busFaultFromError(error: unknown): WordBusFault | undefined {
  return error instanceof BusFault ? { source: "bus-error", operation: error.operation, address: error.address, programSpace: error.programSpace } : undefined;
}
export function busFaultRecord(error: unknown): Omit<WordBusFault, "programSpace"> | undefined {
  const fault = busFaultFromError(error);
  return fault && { source: fault.source, operation: fault.operation, address: fault.address };
}

/** Logical faults retain their address space; completed transfers record projected bus addresses. */
export function wordMemory(connection: MemoryConnection, physicalBits: number, logicalBits: number) {
  const physicalMask = 2 ** physicalBits - 1, logicalMask = 2 ** logicalBits - 1;
  return (onAccess?: (access: MemoryAccess) => void): RecordedMemory & WordMemory => {
    const failed = Symbol("failed memory transfer");
    const { accesses, readByte, writeByte } = recordMemory({
      read: address => {
        const value = connection.read(address);
        if (value === "bus-error") throw failed;
        checkUnsigned("Memory byte", value, 255);
        return value;
      },
      write: (address, value) => {
        const result = connection.write(address, value);
        if (result === "bus-error") throw failed;
        if (result !== undefined) throw new TypeError("A successful memory write must return nothing.");
      },
    }, onAccess);
    const transfer = <T>(address: number, operation: WordMemoryFault["operation"], programSpace: boolean, run: (physical: number) => T): T => {
      try { return run((address & physicalMask) >>> 0); }
      catch (error) {
        if (error !== failed) throw error;
        throw new BusFault(operation, (address & logicalMask) >>> 0, programSpace);
      }
    };
    return {
      accesses,
      fetchByte: address => transfer(address, "fetch", true, readByte),
      readProgramByte: address => transfer(address, "read", true, readByte),
      readByte: address => transfer(address, "read", false, readByte),
      writeByte: (address, value) => transfer(address, "write", false, physical => writeByte(physical, value)),
    };
  };
}
