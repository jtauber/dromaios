import { chapterInstructionModules, chapterInstructionDefinitions } from "./generated/catalogue.ts";
import type { InstructionModule } from "./literate/catalogue.ts";

export * from "./generated/catalogue.ts";

/** Discovered modules for generation and reproducibility checks. */
export const instructionModules: readonly InstructionModule[] = Object.freeze<readonly InstructionModule[]>([
  ...chapterInstructionModules,
]);

// Explanations follow chapter families independently of generated file partitions.
// Standalone source probes belong to generation options, not instruction coverage.
export const instructionDefinitions = Object.freeze(chapterInstructionDefinitions);
