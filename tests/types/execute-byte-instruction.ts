import type { Ram } from "../../src/components/memory/ram.js";
import { executeByteInstruction } from "../../src/components/cpus/execute-byte-instruction.js";
import { readWordLE } from "../../src/components/cpus/binary.js";
import type { FetchedInstruction } from "../../src/components/cpus/execution-records.js";
import type { MemoryAccess } from "../../src/components/cpus/memory-access.js";

// Compiled, never called: shared execution retains readonly records and required word contexts.
export function checkByteInstructionExecution(ram: Ram, state: { pc: number }): void {
  const result = executeByteInstruction(state, ram, {
    0: ({ fetchWord, writeByte }) => writeByte(fetchWord(), 0),
  }, readWordLE);
  const instruction: FetchedInstruction = result.instruction;
  const accesses: readonly MemoryAccess[] = result.accesses;
  const executed: boolean = result.executed;
  // @ts-expect-error The execution result is readonly.
  result.executed = false;
  // @ts-expect-error Instruction addresses are readonly.
  result.instruction.address = 0;
  // @ts-expect-error Instruction bytes are readonly.
  result.instruction.bytes.push(0);
  // @ts-expect-error The access log is readonly.
  result.accesses.push({ kind: "read", address: 0, value: 0 });
  // @ts-expect-error Access entries are readonly.
  result.accesses[0]!.value = 0;
  // @ts-expect-error A segmented IP alone does not satisfy the flat PC contract.
  executeByteInstruction({ ip: 0 }, ram, {}, readWordLE);
}
