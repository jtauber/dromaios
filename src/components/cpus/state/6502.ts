import type { StoredState } from "../semantics/generated/state/6502.ts";

export { state as cpu6502StateDescription } from "../semantics/generated/state/6502.ts";
export type Cpu6502State = StoredState;
export type Cpu6502Flags = Cpu6502State["flags"];
