import { flagRegister } from "../flags.ts";
import { defineState, unsigned, flag, boolean, namedChoices, group } from "../state.ts";
import type { StateValues } from "../state.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu6809StateDescription = defineState({
  a: unsigned(8), b: unsigned(8), dp: unsigned(8),
  x: unsigned(16), y: unsigned(16), s: unsigned(16), u: unsigned(16), pc: unsigned(16),
  waitMode: namedChoices("none", "sync", "cwai"), nmiArmed: boolean,
  flags: group({ e: flag, f: flag, h: flag, i: flag, n: flag, z: flag, v: flag, c: flag }),
});

export type Cpu6809State = StateValues<typeof cpu6809StateDescription>;
export type Cpu6809Flags = Cpu6809State["flags"];

/** Packed status layout; reserved output bits are fixed and never stored as flags. */
export const cpu6809Status = flagRegister({ e: 7, f: 6, h: 5, i: 4, n: 3, z: 2, v: 1, c: 0 });
