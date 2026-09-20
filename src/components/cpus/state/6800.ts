import type { StoredState } from "../semantics/generated/state/6800.ts";

export { state as cpu6800StateDescription } from "../semantics/generated/state/6800.ts";
export type Cpu6800State = StoredState;
export type Cpu6800Flags = Cpu6800State["flags"];
