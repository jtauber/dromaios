import { views, actions, families, pages } from "../generated/6809.ts";
import { instructionSet } from "../builders.ts";

export const chapter6809 = instructionSet(Object.values(families).flat(), 16);
export { chapter6809 as instructions6809, actions as actions6809, views as views6809, pages as pages6809 };
