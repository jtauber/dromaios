import { instructionSet } from "../builders.ts";
import { families, actions } from "../generated/6800.ts";

export const chapter6800 = instructionSet(Object.values(families).flat());
export const instructions6800 = { ...chapter6800, enterInterrupt: actions.enterInterrupt };
