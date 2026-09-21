import { cpuZ80StateDescription } from "../state/z80.ts";
import { instructions68000, quick68000, moves68000, wordMoves68000, logic68000, arithmetic68000, bits68000, wordArithmetic68000, decimal68000, control68000, transfers68000, system68000 } from "./definitions/68000.ts";
import { chapterInstructionModules } from "./generated/catalogue.ts";
import { instructions8088, transfers8088, alu8088, unary8088, stack8088, addressing8088, strings8088, arithmetic8088, control8088 } from "./definitions/8088.ts";
import { instructionsZ80, chapterZ80, actionsZ80, viewsZ80 } from "./definitions/z80.ts";
import type { generateInstructions } from "./generate.ts";

export * from "./generated/catalogue.ts";
export { instructions68000, quick68000, moves68000, wordMoves68000, logic68000, arithmetic68000, bits68000, wordArithmetic68000, decimal68000, control68000, transfers68000, system68000, instructions8088, transfers8088, alu8088, unary8088, stack8088, addressing8088, strings8088, arithmetic8088, control8088, instructionsZ80, chapterZ80 };

type GenerationParameters = Parameters<typeof generateInstructions>;
interface InstructionModule {
  /** Generated filename without its extension. */
  readonly name: string;
  readonly cpu: GenerationParameters[0];
  readonly definitions: GenerationParameters[1];
  readonly options?: GenerationParameters[2];
}

/** One catalogue for generation, explanations, and reproducibility checks, in explanation order. */
export const instructionModules: readonly InstructionModule[] = Object.freeze<readonly InstructionModule[]>([
  { name: "68000", cpu: "68000", definitions: instructions68000 },
  { name: "68000-quick", cpu: "68000", definitions: quick68000 },
  { name: "68000-moves", cpu: "68000", definitions: moves68000 },
  { name: "68000-word-moves", cpu: "68000", definitions: wordMoves68000 },
  { name: "68000-logic", cpu: "68000", definitions: logic68000 },
  { name: "68000-arithmetic", cpu: "68000", definitions: arithmetic68000 },
  { name: "68000-bits", cpu: "68000", definitions: bits68000 },
  { name: "68000-word-arithmetic", cpu: "68000", definitions: wordArithmetic68000 },
  { name: "68000-decimal", cpu: "68000", definitions: decimal68000 },
  { name: "68000-control", cpu: "68000", definitions: control68000 },
  { name: "68000-transfers", cpu: "68000", definitions: transfers68000 },
  { name: "68000-system", cpu: "68000", definitions: system68000 },
  ...chapterInstructionModules,
  { name: "8088", cpu: "8088", definitions: instructions8088, options: { bindOpcodes: true } },
  { name: "8088-transfers", cpu: "8088", definitions: transfers8088 },
  { name: "8088-alu", cpu: "8088", definitions: alu8088 },
  { name: "8088-unary", cpu: "8088", definitions: unary8088 },
  { name: "8088-stack", cpu: "8088", definitions: stack8088 },
  { name: "8088-addressing", cpu: "8088", definitions: addressing8088 },
  { name: "8088-strings", cpu: "8088", definitions: strings8088 },
  { name: "8088-arithmetic", cpu: "8088", definitions: arithmetic8088 },
  { name: "8088-control", cpu: "8088", definitions: control8088 },
  { name: "z80", cpu: "z80", definitions: instructionsZ80 },
  { name: "z80-chapter", cpu: "z80", definitions: chapterZ80, options: { bindOpcodes: true, origin: "specifications/z80.md" } },
  { name: "z80-state", cpu: "z80", definitions: actionsZ80, options: { origin: "specifications/z80.md",
    sources: { cpu: { name: "z80", state: cpuZ80StateDescription }, groups: { views: viewsZ80 } } } },
]);

// Standalone source probes belong to generation options, not executable-instruction coverage.
export const instructionDefinitions = Object.freeze(instructionModules.flatMap(({ definitions }) => Object.values(definitions)));
