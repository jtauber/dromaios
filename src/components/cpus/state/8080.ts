import { defineState, unsigned, flag, boolean, group } from "../state.ts";
import type { StateValues } from "../state.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu8080StateDescription = defineState({
  a: unsigned(8), b: unsigned(8), c: unsigned(8), d: unsigned(8), e: unsigned(8), h: unsigned(8), l: unsigned(8),
  pc: unsigned(16), sp: unsigned(16),
  flags: group({ s: flag, z: flag, ac: flag, p: flag, cy: flag }),
  interruptEnabled: boolean, interruptDeferred: boolean, halted: boolean,
});

export type Cpu8080State = StateValues<typeof cpu8080StateDescription>;
export type Cpu8080Flags = Cpu8080State["flags"];
