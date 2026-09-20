import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCpuChapters } from "./generate-cpu-chapters.ts";
import { generateInstructions } from "../src/components/cpus/semantics/generate.ts";
import { generateChapterExecution } from "../src/components/cpus/semantics/literate/execution.ts";
import { generateChapterInterface } from "../src/components/cpus/semantics/literate/interface.ts";

/** Rebuild executable semantics from definitions and CPU-owned state schemas. */
async function generateCpuSemantics(directory: string): Promise<void> {
  const chapters = generateCpuChapters();
  const { instructionModules } = await import("../src/components/cpus/semantics/definitions.ts");
  const modules = instructionModules.map(({ name, cpu, definitions, options }) =>
    [name, generateInstructions(cpu, definitions, options)] as const);
  for (const { name, cpu, chapter } of chapters) {
    if (chapter.execution) modules.push([`${name}-execution`, generateChapterExecution(cpu, name, chapter.execution)]);
    if (chapter.interface) modules.push([`${name}-cpu`, generateChapterInterface(name, chapter.state!, chapter.interface, chapter.execution!)]);
  }
  const names = new Set<string>();
  for (const [name] of modules) {
    if (names.has(name)) throw new Error(`Duplicate generated CPU module ${name}.`);
    names.add(name);
  }
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  for (const [name, source] of modules) writeFileSync(join(directory, `${name}.ts`), source);
}

if (import.meta.main) await generateCpuSemantics(fileURLToPath(new URL("../src/components/cpus/generated/", import.meta.url)));
