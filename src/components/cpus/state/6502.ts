import { defineState, unsigned, flag, group } from "../state.ts";
import type { StateValues } from "../state.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu6502StateDescription = defineState({
  a: unsigned(8), x: unsigned(8), y: unsigned(8), sp: unsigned(8), pc: unsigned(16),
  flags: group({ n: flag, v: flag, d: flag, i: flag, z: flag, c: flag }),
});

export type Cpu6502State = StateValues<typeof cpu6502StateDescription>;
export type Cpu6502Flags = Cpu6502State["flags"];
