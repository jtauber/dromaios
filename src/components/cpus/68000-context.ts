/** Address decoding stages auto-updates locally; instruction definitions choose when to commit them. */
export interface Cpu68000AddressContext {
  readonly resolveAddress: (size: 8 | 16 | 32, mode: number, code: number) => number;
  readonly commitAddressUpdates: () => void;
  readonly readProgramByte: (address: number) => number;
}

/** A rejected operand access; the CPU boundary owns exception delivery. */
export interface OperandAlignmentFault {
  readonly operation: "read" | "write";
  readonly address: number;
  readonly programSpace?: boolean;
}

/** Control flow selects a target independently of the sequential instruction-fetch cursor. */
export interface Cpu68000ControlContext {
  readonly nextAddress: () => number;
  readonly jump: (address: number) => void;
}

/** A taken odd target is rejected before selection; no instruction byte is fetched there. */
export interface TargetAlignmentFault {
  readonly operation: "fetch";
  readonly address: number;
}
