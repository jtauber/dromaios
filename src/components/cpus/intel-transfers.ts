import { opcodeFamily } from "./opcodes.ts";

export type IntelByteOperand = "a" | "b" | "c" | "d" | "e" | "h" | "l" | "m";

/** One encoding inventory for generated definitions and their execution bindings. */
function byteTransferForms(operands: readonly IntelByteOperand[], matrix: string) {
  return {
    // 00 ddd 110: fetch an immediate byte, then write the selected destination.
    immediate: opcodeFamily("00 ddd 110", { d: operands }, ({ d: destination }) => ({ destination, source: "immediate" as const })),
    // ddd selects the destination, sss the source; the memory-to-memory slot is HALT.
    matrix: opcodeFamily(matrix, { d: operands, s: operands }, ({ d: destination, s: source }) => ({ destination, source }))
      .filter(([, { destination, source }]) => destination !== "m" || source !== "m"),
  } as const;
}

// 8080/Z80: M is selector 110; 01 110 110 is HALT.
export const intelByteTransferForms = byteTransferForms(["b", "c", "d", "e", "h", "l", "m", "a"], "01 ddd sss");
// 8008: A is selector 000, M is 111; 11 111 111 is HLT.
export const intel8008ByteTransferForms = byteTransferForms(["a", "b", "c", "d", "e", "h", "l", "m"], "11 ddd sss");
