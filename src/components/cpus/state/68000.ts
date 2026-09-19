import { defineState, unsigned, flag, boolean, group, namedChoices } from "../state.ts";
import type { StateValues } from "../state.ts";
import { flagRegister } from "../flags.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu68000StateDescription = defineState({
  d0: unsigned(32), d1: unsigned(32), d2: unsigned(32), d3: unsigned(32),
  d4: unsigned(32), d5: unsigned(32), d6: unsigned(32), d7: unsigned(32),
  a0: unsigned(32), a1: unsigned(32), a2: unsigned(32), a3: unsigned(32),
  a4: unsigned(32), a5: unsigned(32), a6: unsigned(32),
  usp: unsigned(32), ssp: unsigned(32), pc: unsigned(32), ir: unsigned(16), interruptMask: unsigned(3),
  halted: boolean, faulted: boolean, tracePending: boolean,
  entry: group({ kind: namedChoices("none", "reset", "fault", "exception", "trap"), vector: unsigned(8) }),
  flags: group({ x: flag, n: flag, z: flag, v: flag, c: flag, t: flag, s: flag }),
});

export type Cpu68000State = StateValues<typeof cpu68000StateDescription>;
export type Cpu68000Flags = Cpu68000State["flags"];

/** SR layouts share packing and instruction restoration; unlisted bits pack as zero. */
export const cpu68000ConditionCode = { ...flagRegister({ x: 4, n: 3, z: 2, v: 1, c: 0 }), width: 16 as const };
export const cpu68000SystemFlags = { ...flagRegister({ t: 15, s: 13 }), width: 16 as const };
