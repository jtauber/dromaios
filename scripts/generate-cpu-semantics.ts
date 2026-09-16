import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { instructions6502, sources6502, instructions8080, instructions6809 } from "../src/components/cpus/semantics/definitions.ts";
import { generateInstructions } from "../src/components/cpus/semantics/generate.ts";

/** Rebuild executable semantics from definitions and CPU-owned state schemas. */
export function generateCpuSemantics(directory: string): void {
  const modules = ([
    ["6502", instructions6502], ["8080", instructions8080], ["6809", instructions6809],
  ] as const).map(([cpu, definitions]) => [cpu, generateInstructions(cpu, definitions, { bindOpcodes: cpu === "6502", sources: cpu === "6502" ? sources6502 : undefined })] as const);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  for (const [cpu, source] of modules) writeFileSync(join(directory, `${cpu}.ts`), source);
}

if (import.meta.main) generateCpuSemantics(fileURLToPath(new URL("../src/components/cpus/generated/", import.meta.url)));
