import { checkUnsigned } from "../validation.ts";

/** Externally supplied instruction bytes have no RAM fetch address. */
export interface InterruptInstruction {
  readonly source: "interrupt";
  readonly bytes: readonly number[];
}

export interface InterruptAcknowledge {
  readonly kind: "acknowledge";
  readonly value: number;
}

/** Record supplied bytes without advancing PC; acceptance and decoding belong to the CPU. */
export function recordInterruptInstruction(acknowledge: () => number, onAccess: (access: InterruptAcknowledge) => void): {
  readonly instruction: InterruptInstruction;
  readonly fetchByte: () => number;
} {
  const bytes: number[] = [];
  return {
    instruction: { source: "interrupt", bytes },
    fetchByte: () => {
      const value = acknowledge();
      checkUnsigned("Interrupt instruction byte", value, 0xff);
      bytes.push(value);
      onAccess({ kind: "acknowledge", value });
      return value;
    },
  };
}
