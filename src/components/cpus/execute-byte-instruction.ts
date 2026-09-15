import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction } from "./execution-records.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext } from "./instruction-context.ts";

type OpcodeHandler = (instruction: WordInstructionContext) => "unsupported" | void;

export interface ByteInstructionExecution {
  readonly instruction: FetchedInstruction;
  readonly accesses: readonly MemoryAccess[];
  readonly executed: boolean;
}

/** Expose a CPU's selected address register or IP through the executor's live PC interface. */
export function programCounter(read: () => number, write: (value: number) => void): { pc: number } {
  return { get pc() { return read(); }, set pc(value) { write(value); } };
}

/**
 * Attempt one byte opcode with a wrapping 16-bit PC, using the supplied word byte order.
 * A PC view can impose a narrower wrap; mapFetchAddress translates instruction addresses only.
 * Unknown opcodes record only their fetch. Handlers may reject an encoding after operand fetches,
 * but must do so before changing other state or RAM. Either rejection restores PC.
 * A lookup callback may bind extra per-step capabilities after the opcode has been fetched.
 * Callers own snapshots and HALT.
 */
export function executeByteInstruction(
  state: { pc: number }, ram: Ram,
  handlers: Readonly<Partial<Record<number, OpcodeHandler>>> | ((opcode: number) => OpcodeHandler | undefined),
  readWord: (nextByte: () => number) => number,
  mapFetchAddress: (pc: number) => number = pc => pc,
): ByteInstructionExecution {
  const { accesses, readByte, writeByte } = recordMemory(ram);
  const initialPc = state.pc;
  const address = mapFetchAddress(initialPc);
  const opcode = readByte(address);
  const bytes = [opcode];
  const handler = typeof handlers === "function" ? handlers(opcode) : handlers[opcode];
  let executed = false;
  if (handler) {
    state.pc = (initialPc + 1) & 0xffff;
    // Read the live PC and RAM: handlers may interleave operand fetches with state changes or writes.
    const fetchByte = (): number => {
      const pc = state.pc;
      const byte = readByte(mapFetchAddress(pc));
      state.pc = (pc + 1) & 0xffff;
      bytes.push(byte);
      return byte;
    };
    executed = handler({ fetchByte, fetchWord: () => readWord(fetchByte), readByte, writeByte }) !== "unsupported";
    if (!executed) state.pc = initialPc;
  }
  return { instruction: { address, bytes }, accesses, executed };
}
