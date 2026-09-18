import { instructions6502, sources6502 } from "./definitions/6502.ts";
import { instructions6800 } from "./definitions/6800.ts";
import { instructions8008 } from "./definitions/8008.ts";
import { instructions8088, transfers8088, alu8088, unary8088, stack8088 } from "./definitions/8088.ts";
import { instructions8080 } from "./definitions/8080.ts";
import { instructions6809 } from "./definitions/6809.ts";
import { instructionsZ80 } from "./definitions/z80.ts";

export { instructions6502, sources6502, instructions6800, instructions8008, instructions8080, instructions8088, transfers8088, alu8088, unary8088, stack8088, instructions6809, instructionsZ80 };

/** One inventory for executable generation and the explanatory listing. */
export const instructionDefinitions = Object.freeze([
  ...Object.values(instructions6502), ...Object.values(instructions6800), ...Object.values(instructions8008), ...Object.values(instructions8080), ...Object.values(instructions8088), ...Object.values(transfers8088), ...Object.values(alu8088), ...Object.values(unary8088), ...Object.values(stack8088), ...Object.values(instructions6809), ...Object.values(instructionsZ80),
]);
