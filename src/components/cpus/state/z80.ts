import type { StoredState } from "../semantics/generated/state/z80.ts";

export { state as cpuZ80StateDescription } from "../semantics/generated/state/z80.ts";
export type CpuZ80State = StoredState;
/** The six documented flags; undocumented F bits 3 and 5 are outside this model. */
export type CpuZ80Flags = CpuZ80State["flags"];
export type CpuZ80RegisterBank = CpuZ80State["alternate"];
