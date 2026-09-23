import { chapterInterfaces } from "./semantics/generated/interfaces.ts";
import type { ChapterStates } from "./semantics/generated/interfaces.ts";

/** Small schemas and entry points only: importing this catalogue never loads CPU execution. */
export const cpuModels = chapterInterfaces;
export type CpuModel = keyof typeof cpuModels;
export type CpuStates = ChapterStates;
