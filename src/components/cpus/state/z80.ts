import { flagRegister } from "../flags.ts";
import { defineState, unsigned, flag, boolean, choices, group } from "../state.ts";
import type { StateValues } from "../state.ts";

const bankFields = defineState({
  a: unsigned(8), b: unsigned(8), c: unsigned(8), d: unsigned(8), e: unsigned(8), h: unsigned(8), l: unsigned(8),
  flags: group({ s: flag, z: flag, h: flag, pv: flag, n: flag, c: flag }),
});

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpuZ80StateDescription = defineState({
  ...bankFields, alternate: group(bankFields),
  ix: unsigned(16), iy: unsigned(16), pc: unsigned(16), sp: unsigned(16), i: unsigned(8), r: unsigned(8),
  iff1: boolean, iff2: boolean, im: choices(0, 1, 2),
  interruptDeferred: boolean, nmiDeferred: boolean, halted: boolean,
});

export type CpuZ80State = StateValues<typeof cpuZ80StateDescription>;
/** The six documented flags; undocumented F bits 3 and 5 are outside this model. */
export type CpuZ80Flags = CpuZ80State["flags"];

export type CpuZ80RegisterBank = StateValues<typeof bankFields>;

// F = S Z 0 H 0 PV N C. Unmodeled bits 5/3 pack as zero, not hardware constants.
export const cpuZ80Status = flagRegister({ s: 7, z: 6, h: 4, pv: 2, n: 1, c: 0 });
