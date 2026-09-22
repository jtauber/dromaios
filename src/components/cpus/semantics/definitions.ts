import { instructions68000, quick68000, moves68000, wordMoves68000, logic68000, arithmetic68000, bits68000, wordArithmetic68000, decimal68000, control68000, transfers68000, system68000 } from "./definitions/68000.ts";
import { chapterInstructionModules } from "./generated/catalogue.ts";
import type { generateInstructions } from "./generate.ts";

export * from "./generated/catalogue.ts";
export { instructions68000, quick68000, moves68000, wordMoves68000, logic68000, arithmetic68000, bits68000, wordArithmetic68000, decimal68000, control68000, transfers68000, system68000 };

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
]);

// Standalone source probes belong to generation options, not executable-instruction coverage.
export const instructionDefinitions = Object.freeze(instructionModules.flatMap(({ definitions }) => Object.values(definitions)));
