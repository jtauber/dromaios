import { flagRegister } from "../flags.ts";
export { state as cpu8080StateDescription } from "../semantics/generated/state/8080.ts";
export type { StoredState as Cpu8080State } from "../semantics/generated/state/8080.ts";
import type { StoredState } from "../semantics/generated/state/8080.ts";

export type Cpu8080Flags = StoredState["flags"];

// PSW low byte: S Z 0 AC 0 P 1 CY. This layout migrates with the status families.
export const cpu8080Status = flagRegister({ s: 7, z: 6, ac: 4, p: 2, cy: 0 }, 0x02);
