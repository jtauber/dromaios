import { opcodeFamily } from "./opcodes.ts";

// 8080/Z80 byte-register codes: 110 denotes memory through HL (Intel calls it M).
const operands = ["b", "c", "d", "e", "h", "l", "m", "a"] as const;
export type IntelByteOperand = typeof operands[number];

/** One encoding inventory for generated definitions and their execution bindings. */
export const intelByteTransferForms = {
  // 00 ddd 110: fetch an immediate byte, then write the selected destination.
  immediate: opcodeFamily("00 ddd 110", { d: operands }, ({ d: destination }) => ({ destination, source: "immediate" as const })),
  // 01 ddd sss: copy the source to the destination; 01 110 110 belongs to HALT.
  matrix: opcodeFamily("01 ddd sss", { d: operands, s: operands }, ({ d: destination, s: source }) => ({ destination, source }))
    .filter(([, { destination, source }]) => destination !== "m" || source !== "m"),
} as const;
