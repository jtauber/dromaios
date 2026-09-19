import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCpuChapters } from "./generate-cpu-chapters.ts";
import { generateInstructions } from "../src/components/cpus/semantics/generate.ts";

/** Rebuild executable semantics from definitions and CPU-owned state schemas. */
async function generateCpuSemantics(directory: string): Promise<void> {
  generateCpuChapters();
  const { instructionModules } = await import("../src/components/cpus/semantics/definitions.ts");
  const modules = instructionModules.map(({ name, cpu, definitions, options }) =>
    [name, generateInstructions(cpu, definitions, options)] as const);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  for (const [name, source] of modules) writeFileSync(join(directory, `${name}.ts`), source);
}

if (import.meta.main) await generateCpuSemantics(fileURLToPath(new URL("../src/components/cpus/generated/", import.meta.url)));
