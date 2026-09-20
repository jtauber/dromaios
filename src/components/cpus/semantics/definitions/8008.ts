import { instructionSet } from "../builders.ts";
import { cpu8008StateDescription } from "../../state/8008.ts";
import { families, views } from "../generated/8008.ts";

// The chapter owns every documented instruction and its native opcode aliases.
export const instructions8008 = instructionSet(Object.values(families).flat());

export { actions as state8008 } from "../generated/8008.ts";
export const views8008 = { cpu: { name: "8008", state: cpu8008StateDescription }, groups: { views } };
