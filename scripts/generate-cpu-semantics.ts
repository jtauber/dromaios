import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { instructionModules } from "../src/components/cpus/semantics/definitions.ts";
import { generateInstructions } from "../src/components/cpus/semantics/generate.ts";

/** Rebuild executable semantics from definitions and CPU-owned state schemas. */
export function generateCpuSemantics(directory: string): void {
  const modules = instructionModules.map(({ name, cpu, definitions, options }) =>
    [name, generateInstructions(cpu, definitions, options)] as const);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  for (const [name, source] of modules) writeFileSync(join(directory, `${name}.ts`), source);
}

if (import.meta.main) generateCpuSemantics(fileURLToPath(new URL("../src/components/cpus/generated/", import.meta.url)));
