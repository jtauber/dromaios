export { state as cpu8008StateDescription } from "../semantics/generated/state/8008.ts";
export type { StoredState as Cpu8008StoredState } from "../semantics/generated/state/8008.ts";
import type { StoredState as Cpu8008StoredState } from "../semantics/generated/state/8008.ts";

/** Eight physical address registers; stackIndex selects the current program counter. */
export type Cpu8008AddressStack = Cpu8008StoredState["addressStack"];

export type Cpu8008State = Omit<Cpu8008StoredState, "addressStack"> & {
  addressStack: Readonly<Cpu8008AddressStack>;
};
export type Cpu8008Flags = Cpu8008State["flags"];
