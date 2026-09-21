import type { StoredState } from "../semantics/generated/state/8088.ts";

// Keep the public type names while the chapter takes over the implementation.
export { state as cpu8088StateDescription } from "../semantics/generated/state/8088.ts";
export type { StoredState as Cpu8088State } from "../semantics/generated/state/8088.ts";
export type Cpu8088Flags = StoredState["flags"];
