import type { Cpu6800State } from "../../src/components/cpus/state/6800.js";
import type { ByteInstructionContext } from "../../src/components/cpus/instruction-context.js";
import type { ByteMemory } from "../../src/components/cpus/memory-access.js";

const unexpected = (): never => { throw new Error("Unexpected data-memory access"); };

/** Supply an extended address to a complete body, retaining the shared operand-effect probes. */
export function extended6800(execute: (state: Cpu6800State, context: ByteInstructionContext) => void) {
  return (state: Cpu6800State, address: number, context: Partial<ByteMemory>): void => {
    const bytes = [address >> 8, address & 0xff];
    execute(state, { readByte: unexpected, writeByte: unexpected, ...context, fetchByte: () => bytes.shift()! });
  };
}
