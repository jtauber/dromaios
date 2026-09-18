import { flagRegister } from "../flags.ts";
import { defineState, unsigned, flag, boolean, group } from "../state.ts";
import type { StateValues } from "../state.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu6800StateDescription = defineState({
  a: unsigned(8), b: unsigned(8), x: unsigned(16), sp: unsigned(16), pc: unsigned(16),
  flags: group({ h: flag, i: flag, n: flag, z: flag, v: flag, c: flag }),
  waiting: boolean,
});

export type Cpu6800State = StateValues<typeof cpu6800StateDescription>;
export type Cpu6800Flags = Cpu6800State["flags"];

/** Packed status layout; reserved output bits are fixed and never stored as flags. */
export const cpu6800Status = flagRegister({ h: 5, i: 4, n: 3, z: 2, v: 1, c: 0 }, 0xc0);
