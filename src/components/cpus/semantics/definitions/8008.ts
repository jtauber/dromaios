import { instructionSet } from "../builders.ts";
import { families } from "../generated/8008.ts";

// The chapter owns every documented instruction and its native opcode aliases.
export const instructions8008 = instructionSet(Object.values(families).flat());
