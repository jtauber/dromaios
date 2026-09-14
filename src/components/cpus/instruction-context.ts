import type { ByteMemory } from "./memory-access.ts";

/** Byte operands fetched from the instruction stream, plus separate data-memory access. */
export interface ByteInstructionContext extends ByteMemory {
  readonly fetchByte: () => number;
}

/** Adds a 16-bit operand fetch in the CPU's byte order. */
export interface WordInstructionContext extends ByteInstructionContext {
  readonly fetchWord: () => number;
}
