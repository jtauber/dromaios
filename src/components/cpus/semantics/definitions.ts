import { instructions68000, quick68000, moves68000, logic68000 } from "./definitions/68000.ts";
import { instructions6502, interrupts6502, sources6502 } from "./definitions/6502.ts";
import { instructions6800 } from "./definitions/6800.ts";
import { instructions8008 } from "./definitions/8008.ts";
import { instructions8088, transfers8088, alu8088, unary8088, stack8088, addressing8088, strings8088, arithmetic8088, control8088 } from "./definitions/8088.ts";
import { instructions8080 } from "./definitions/8080.ts";
import { instructions6809 } from "./definitions/6809.ts";
import { instructionsZ80 } from "./definitions/z80.ts";

export { instructions68000, quick68000, moves68000, logic68000, instructions6502, interrupts6502, sources6502, instructions6800, instructions8008, instructions8080, instructions8088, transfers8088, alu8088, unary8088, stack8088, addressing8088, strings8088, arithmetic8088, control8088, instructions6809, instructionsZ80 };

/** One inventory for executable generation and the explanatory listing. */
export const instructionDefinitions = Object.freeze([
  ...Object.values(instructions68000), ...Object.values(quick68000), ...Object.values(moves68000), ...Object.values(logic68000), ...Object.values(instructions6502), ...Object.values(interrupts6502), ...Object.values(instructions6800), ...Object.values(instructions8008), ...Object.values(instructions8080), ...Object.values(instructions8088), ...Object.values(transfers8088), ...Object.values(alu8088), ...Object.values(unary8088), ...Object.values(stack8088), ...Object.values(addressing8088), ...Object.values(strings8088), ...Object.values(arithmetic8088), ...Object.values(control8088), ...Object.values(instructions6809), ...Object.values(instructionsZ80),
]);
