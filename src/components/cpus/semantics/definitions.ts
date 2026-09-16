import { instructions6502, sources6502 } from "./definitions/6502.ts";
import { instructions8080 } from "./definitions/8080.ts";
import { instructions6809 } from "./definitions/6809.ts";

export { instructions6502, sources6502, instructions8080, instructions6809 };

/** One inventory for executable generation and the explanatory listing. */
export const instructionDefinitions = Object.freeze([
  ...Object.values(instructions6502), ...Object.values(instructions8080), ...Object.values(instructions6809),
]);
