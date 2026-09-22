export type { WordAddressContext as Cpu68000AddressContext } from "./word-execution.ts";

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

/** RESET asserts the connected device reset signal; it does not reset CPU state. */
export interface Cpu68000ResetContext {
  readonly resetDevices: () => void;
}
