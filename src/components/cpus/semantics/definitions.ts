import { chapterInstructionModules, chapterInstructionDefinitions } from "./generated/catalogue.ts";
import type { generateInstructions } from "./generate.ts";

export * from "./generated/catalogue.ts";

type GenerationParameters = Parameters<typeof generateInstructions>;
interface InstructionModule {
  /** Generated filename without its extension. */
  readonly name: string;
  readonly cpu: GenerationParameters[0];
  readonly definitions: GenerationParameters[1];
  readonly options?: GenerationParameters[2];
}

/** Discovered modules for generation and reproducibility checks. */
export const instructionModules: readonly InstructionModule[] = Object.freeze<readonly InstructionModule[]>([
  ...chapterInstructionModules,
]);

// Explanations follow chapter families independently of generated file partitions.
// Standalone source probes belong to generation options, not instruction coverage.
export const instructionDefinitions = Object.freeze(chapterInstructionDefinitions);
