import type { ByteMemory, RecordedMemory } from "../../src/components/cpus/memory-access.js";
import type { ByteInstructionContext, WordInstructionContext } from "../../src/components/cpus/instruction-context.js";

// Compiled, never called: memory access, byte fetches, and word fetches are distinct capabilities.
export function checkInstructionContexts(memory: RecordedMemory, fetchByte: () => number, fetchWord: () => number): void {
  const data: ByteMemory = memory;
  const byte: ByteInstructionContext = { readByte: data.readByte, writeByte: data.writeByte, fetchByte };
  const word: WordInstructionContext = { ...byte, fetchWord };
  const byteView: ByteInstructionContext = word;
  const dataView: ByteMemory = byte;
  const operand: number = word.fetchWord();
  const value: number = byteView.fetchByte();
  dataView.writeByte(operand, value);

  // @ts-expect-error A data-memory connection has no instruction-stream fetches.
  const missingByteFetch: ByteInstructionContext = data;
  // @ts-expect-error Byte contexts need not offer a word fetch.
  const missingWordFetch: WordInstructionContext = byte;
  // @ts-expect-error Byte contexts expose no word fetch to a handler.
  byte.fetchWord();
  // @ts-expect-error Callbacks in an instruction context are readonly.
  word.fetchWord = fetchWord;
  // @ts-expect-error Inherited fetch callbacks remain readonly.
  word.fetchByte = fetchByte;
  // @ts-expect-error Inherited memory callbacks remain readonly.
  word.writeByte = data.writeByte;
  // @ts-expect-error Byte and word contexts do not expose the recorder's log.
  word.accesses;
  // @ts-expect-error A word context does not promise long-value operations.
  word.fetchLong();
  // @ts-expect-error Fetches return numeric operands.
  const invalidFetch: WordInstructionContext = { ...byte, fetchWord: () => true };
}
