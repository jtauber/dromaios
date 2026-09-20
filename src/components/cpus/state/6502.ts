import { flagRegister } from "../flags.ts";
import type { StoredState } from "../semantics/generated/state/6502.ts";

export { state as cpu6502StateDescription } from "../semantics/generated/state/6502.ts";
export type Cpu6502State = StoredState;
export type Cpu6502Flags = Cpu6502State["flags"];

// Status bit 5 is fixed; PHP/BRK add the stacked B marker in bit 4. Neither is stored.
export const cpu6502Status = flagRegister({ n: 7, v: 6, d: 3, i: 2, z: 1, c: 0 }, 0x20);
