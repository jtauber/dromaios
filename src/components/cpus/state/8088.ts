import { flagRegister } from "../flags.ts";
import { defineState, unsigned, flag, boolean, group } from "../state.ts";
import type { StateValues } from "../state.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu8088StateDescription = defineState({
  ax: unsigned(16), bx: unsigned(16), cx: unsigned(16), dx: unsigned(16),
  sp: unsigned(16), bp: unsigned(16), si: unsigned(16), di: unsigned(16),
  cs: unsigned(16), ds: unsigned(16), ss: unsigned(16), es: unsigned(16), ip: unsigned(16),
  halted: boolean, waiting: boolean, interruptDeferred: boolean, recognitionDeferred: boolean, trapPending: boolean,
  flags: group({ cf: flag, pf: flag, af: flag, zf: flag, sf: flag, tf: flag, if: flag, df: flag, of: flag }),
});

export type Cpu8088State = StateValues<typeof cpu8088StateDescription>;
export type Cpu8088Flags = Cpu8088State["flags"];

/** Low FLAGS layout shared by LAHF/SAHF and full-word runtime packing. */
export const cpu8088Status = flagRegister({ cf: 0, pf: 2, af: 4, zf: 6, sf: 7 }, 0x02);
