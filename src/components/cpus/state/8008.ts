import { defineState, unsigned, flag, boolean, array, group } from "../state.ts";
import type { StateValues } from "../state.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu8008StateDescription = defineState({
  a: unsigned(8), b: unsigned(8), c: unsigned(8), d: unsigned(8), e: unsigned(8), h: unsigned(8), l: unsigned(8),
  flags: group({ s: flag, z: flag, p: flag, c: flag }),
  addressStack: array(8, unsigned(14)), stackIndex: unsigned(3), halted: boolean,
});

export type Cpu8008StoredState = StateValues<typeof cpu8008StateDescription>;
/** Eight physical address registers; stackIndex selects the current program counter. */
export type Cpu8008AddressStack = Cpu8008StoredState["addressStack"];

export type Cpu8008State = Omit<Cpu8008StoredState, "addressStack"> & {
  addressStack: Readonly<Cpu8008AddressStack>;
};
export type Cpu8008Flags = Cpu8008State["flags"];
