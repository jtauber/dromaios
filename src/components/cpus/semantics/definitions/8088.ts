import { instructionSet } from "../builders.ts";
import { families } from "../generated/8088.ts";

// Native prefix handling supplies captured numeric inputs until execution migrates.
const entries = Object.values(families).flat();
export const instructions8088 = instructionSet(entries.filter(([, definition]) => !definition.inputs));
export const operandInstructions8088 = instructionSet(entries.filter(([, definition]) =>
  definition.inputs && !Object.hasOwn(definition.inputs, "repeatMode")));
export const strings8088 = instructionSet(entries.filter(([, definition]) =>
  definition.inputs && Object.hasOwn(definition.inputs, "repeatMode")));
