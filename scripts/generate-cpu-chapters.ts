import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateChapterState } from "../src/components/cpus/semantics/literate/state.ts";
import { generatePublicState } from "../src/components/cpus/semantics/literate/interface.ts";
import { compileCpuChapters } from "./compile-cpu-chapters.ts";
import { generateChapterData } from "../src/components/cpus/semantics/literate/chapter-data.ts";
import { wordExecutionSources } from "../src/components/cpus/semantics/literate/word-execution.ts";
import type { CpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";
import { ChapterError } from "../src/components/cpus/semantics/literate/document.ts";

/** Bind validated chapter data to the shared instruction catalogue. */
function chapterModule(chapter: CpuChapter, name: string, cpu: string): string {
  const mode = chapter.execution?.mode;
  const readers = chapter.execution?.mode === "word" ? `, readers: ${JSON.stringify(wordExecutionSources(chapter.execution))}` : "";
  return [
    "// Generated from a literate CPU chapter. Do not edit.",
    generateChapterData(chapter),
    ...(Object.keys(chapter.pages).length ? [`export const pages = ${JSON.stringify(chapter.pages)} as const;`, ""] : []),
    ...(chapter.execution && chapter.state ? [
      'import { chapterCatalogue } from "../literate/catalogue.ts";',
      `import { state } from "./state/${name}.ts";`,
      `export const { instructions, ${mode === "segmented" ? "operandInstructions, strings, " : ""}instructionModules, instructionDefinitions } = chapterCatalogue(${JSON.stringify(name)}, {`,
      `  cpu: ${JSON.stringify(cpu)}, mode: ${JSON.stringify(mode)}, state, sources, views, actions, families, pages: ${Object.keys(chapter.pages).length ? "pages" : "{}"}${readers},`,
      '});', '',
    ] : []),
  ].join("\n");
}

/** Generate chapter artifacts and pass compiled catalogues directly to their consumers. */
export function generateCpuChapters() {
  const root = new URL("../src/components/cpus/", import.meta.url);
  const { chapters, complete, instructionModules, instructionDefinitions } = compileCpuChapters();
  const modules = chapters.map(({ name, cpu, chapter }) => ({ name, module: chapterModule(chapter, name, cpu),
    state: chapter.state && generateChapterState(chapter.state) + (chapter.interface ? generatePublicState(chapter.state, chapter.interface) : ""),
  }));
  const catalogue = ["// Generated chapter instruction catalogue. Do not edit.",
    ...complete.map(({ name }, index) => `import { instructionModules as modules${index}, instructionDefinitions as definitions${index} } from "./${name}.ts";`),
    ...complete.map(({ name, cpu, chapter }) => {
      const suffix = cpu[0]!.toUpperCase() + cpu.slice(1);
      return `export { instructions as instructions${suffix}${chapter.execution!.mode === "segmented" ? `, operandInstructions as operandInstructions${suffix}, strings as strings${suffix}` : ""} } from "./${name}.ts";`;
    }),
    `export const chapterInstructionDefinitions = [${complete.map((_, index) => `...definitions${index}`).join(", ")}];`,
    `export const chapterInstructionModules = [${complete.map((_, index) => `...modules${index}`).join(", ")}];`, ""].join("\n");
  const publicChapters = chapters.filter(({ chapter }) => chapter.interface);
  const interfaces = ["// Generated public CPU models. Do not edit.",
    ...publicChapters.map(({ name }, index) => `import { state as state${index} } from "./state/${name}.ts";`),
    "export const chapterInterfaces = {",
    ...publicChapters.map(({ name, cpu, chapter }, index) => {
      const execution = chapter.execution!;
      const pc = chapter.interface!.snapshots.find(({ field }) => field === "pc");
      const storedPc = chapter.state?.pc;
      const pcType = pc ? chapter.views[pc.view]!.type : storedPc?.kind === "unsigned" ? storedPc.bits : undefined;
      if (pcType === "flag") throw new Error(`${name}: the public PC must be numeric.`);
      const pcBits = pcType;
      const maximumPc = execution.mode === "segmented" ? 2 ** execution.memoryBits - 1
        : pcBits === undefined ? undefined : 2 ** pcBits - 1;
      return `  ${JSON.stringify(cpu)}: { name: ${JSON.stringify(chapter.interface!.name)}, module: "generated/${name}-cpu", state: state${index}, ramSize: ${2 ** execution.memoryBits}, maximumPc: ${maximumPc} },`;
    }), "} as const;", "export interface ChapterStates {",
    ...publicChapters.map(({ name, cpu, chapter }) =>
      `  ${JSON.stringify(cpu)}: import("./state/${name}.ts").${chapter.interface!.name}State;`),
    "}", ""].join("\n");
  const output = new URL("semantics/generated/", root);
  // Every chapter compiles before any existing output is removed.
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const { name, module, state } of modules) {
    writeFileSync(new URL(`${name}.ts`, output), module);
    if (state !== undefined) {
      mkdirSync(new URL("state/", output), { recursive: true });
      writeFileSync(new URL(`state/${name}.ts`, output), state);
    }
  }
  writeFileSync(new URL("catalogue.ts", output), catalogue);
  writeFileSync(new URL("interfaces.ts", output), interfaces);
  // Keep one validated instruction graph; rendered text need not survive this stage.
  return {
    models: chapters.map(({ name, cpu, chapter }) => ({
      name, cpu, state: chapter.state, execution: chapter.execution, reset: chapter.reset, interface: chapter.interface,
    })),
    instructionModules, instructionDefinitions,
  };
}

if (import.meta.main) {
  try { generateCpuChapters(); } catch (error) {
    if (!(error instanceof ChapterError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}
