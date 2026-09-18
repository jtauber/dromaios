import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { instructions68000, quick68000, instructions6502, interrupts6502, sources6502, instructions6800, instructions8008, instructions8080, instructions8088, transfers8088, alu8088, unary8088, stack8088, addressing8088, strings8088, arithmetic8088, control8088, instructions6809, instructionsZ80 } from "../src/components/cpus/semantics/definitions.ts";
import { generateInstructions } from "../src/components/cpus/semantics/generate.ts";

/** Rebuild executable semantics from definitions and CPU-owned state schemas. */
export function generateCpuSemantics(directory: string): void {
  const modules: [string, string][] = ([
    ["68000", instructions68000], ["6502", instructions6502], ["6800", instructions6800], ["8008", instructions8008], ["8080", instructions8080], ["8088", instructions8088], ["6809", instructions6809], ["z80", instructionsZ80],
  ] as const).map(([cpu, definitions]) => [cpu, generateInstructions(cpu, definitions, { bindOpcodes: cpu === "6502" || cpu === "8088", sources: cpu === "6502" ? sources6502 : undefined })]);
  modules.push(["68000-quick", generateInstructions("68000", quick68000)], ["8088-control", generateInstructions("8088", control8088)], ["6502-interrupts", generateInstructions("6502", interrupts6502)], ["8088-transfers", generateInstructions("8088", transfers8088)], ["8088-alu", generateInstructions("8088", alu8088)], ["8088-unary", generateInstructions("8088", unary8088)], ["8088-stack", generateInstructions("8088", stack8088)], ["8088-addressing", generateInstructions("8088", addressing8088)], ["8088-strings", generateInstructions("8088", strings8088)], ["8088-arithmetic", generateInstructions("8088", arithmetic8088)]);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  for (const [cpu, source] of modules) writeFileSync(join(directory, `${cpu}.ts`), source);
}

if (import.meta.main) generateCpuSemantics(fileURLToPath(new URL("../src/components/cpus/generated/", import.meta.url)));
