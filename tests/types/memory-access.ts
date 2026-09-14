import { recordMemory } from "../../src/components/cpus/memory-access.js";
import type { MemoryAccess, RecordedMemory } from "../../src/components/cpus/memory-access.js";
import type { Ram } from "../../src/components/memory/ram.js";

// Compiled, never called: callbacks are independent of a receiver and traces are readonly.
export function checkRecordedMemory(ram: Ram, access: MemoryAccess): void {
  const memory: RecordedMemory = recordMemory(ram);
  const { readByte, writeByte } = memory;
  const value: number = readByte(0);
  writeByte(0, value);
  const accesses: readonly MemoryAccess[] = memory.accesses;
  const kind: "read" | "write" = access.kind;
  // @ts-expect-error The access list is readonly.
  accesses.push(access);
  // @ts-expect-error The recorder's list cannot be replaced.
  memory.accesses = [];
  // @ts-expect-error Access entries are readonly.
  access.value = 0;
  // @ts-expect-error Byte values are numeric.
  writeByte(0, true);
  // @ts-expect-error CPU instruction bytes are not part of the memory recorder.
  memory.bytes;
}
