export { state as cpu6809StateDescription } from "../semantics/generated/state/6809.ts";
import type { StoredState } from "../semantics/generated/state/6809.ts";

export type Cpu6809State = StoredState;
export type Cpu6809Flags = Cpu6809State["flags"];
