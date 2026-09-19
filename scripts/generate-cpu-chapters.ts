import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cpu6502StateDescription } from "../src/components/cpus/state/6502.ts";
import { compileCpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";
import type { CpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";

/** Keep exported names precise, while exposing ordinary IR types to the remaining TS definitions. */
function chapterModule(chapter: CpuChapter): string {
  const types = { sources: "ValueSource", policies: "FlagPolicy", modes: "readonly ChapterMode[]", families: "readonly OpcodeEntry<InstructionDefinition>[]" };
  return [
    "// Generated from a literate CPU chapter. Do not edit.",
    'import type { ValueSource, FlagPolicy, InstructionDefinition } from "../model.ts";',
    'import type { OpcodeEntry } from "../../opcodes.ts";',
    'import type { ChapterMode } from "../literate/compile.ts";', "",
    'import { defineInstruction } from "../validate.ts";', "",
    ...Object.entries(types).map(([group, type]) => {
      const definitions = chapter[group as keyof CpuChapter];
      const fields = Object.keys(definitions).map(name => `  readonly ${JSON.stringify(name)}: ${type};`).join("\n");
      const data = group === "families" ? `{\n${Object.entries(chapter.families).map(([name, entries]) =>
        `  ${JSON.stringify(name)}: [\n${entries.map(([opcode, definition]) =>
          `    [${opcode}, defineInstruction(${JSON.stringify(definition, null, 2)})],`).join("\n")}\n  ],`).join("\n")}\n}`
        : JSON.stringify(definitions, null, 2);
      return `export const ${group}: {\n${fields}\n} = ${data};\n`;
    }),
  ].join("\n");
}

/** Bootstrap chapter data before loading the registry that consumes it; paths are independent of cwd. */
export function generateCpuChapters(): void {
  const root = new URL("../src/components/cpus/", import.meta.url);
  const source = new URL("specifications/6502-load-store.md", root);
  const chapter = compileCpuChapter(readFileSync(source, "utf8"), { name: "6502", state: cpu6502StateDescription }, fileURLToPath(source));
  const module = chapterModule(chapter);
  const output = new URL("semantics/generated/", root);
  // Compilation succeeds before existing output is removed.
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  writeFileSync(new URL("6502-load-store.ts", output), module);
}

if (import.meta.main) generateCpuChapters();
