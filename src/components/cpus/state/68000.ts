import type { StoredState } from "../semantics/generated/state/68000.ts";

/** Compatibility names for the native boundary while the chapter migration continues. */
export { state as cpu68000StateDescription } from "../semantics/generated/state/68000.ts";
export type Cpu68000State = StoredState;
export type Cpu68000Flags = Cpu68000State["flags"];
