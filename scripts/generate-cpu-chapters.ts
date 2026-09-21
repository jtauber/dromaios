import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cpu68000StateDescription } from "../src/components/cpus/state/68000.ts";
import { generateChapterState } from "../src/components/cpus/semantics/literate/state.ts";
import { generatePublicState } from "../src/components/cpus/semantics/literate/interface.ts";
import { compileCpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";
import { opcodePageLayouts } from "../src/components/cpus/semantics/opcode-pages.ts";
import type { CpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";
import type { StateFields } from "../src/components/cpus/state.ts";

/** Keep exported names precise, while exposing ordinary IR types to the remaining TS definitions. */
function chapterModule(chapter: CpuChapter, name: string, cpu: string): string {
  const types = { sources: "ValueSource", views: "ValueSource", actions: "InstructionDefinition", policies: "FlagPolicy", operands: "readonly ChapterOperand[]", conditions: "readonly ChapterCondition[]", families: "readonly OpcodeEntry<InstructionDefinition>[]" };
  return [
    "// Generated from a literate CPU chapter. Do not edit.",
    'import type { ValueSource, FlagPolicy, InstructionDefinition } from "../model.ts";',
    'import type { OpcodeEntry } from "../../opcodes.ts";',
    'import type { ChapterOperand, ChapterCondition } from "../literate/compile.ts";', "",
    'import { defineInstruction } from "../validate.ts";', "",
    ...Object.entries(types).map(([group, type]) => {
      const definitions = chapter[group as keyof typeof types];
      const fields = Object.keys(definitions).map(name => `  readonly ${JSON.stringify(name)}: ${type};`).join("\n");
      const data = group === "families" ? `{\n${Object.entries(chapter.families).map(([name, entries]) =>
        `  ${JSON.stringify(name)}: [\n${entries.map(([opcode, definition]) =>
          `    [${opcode}, defineInstruction(${JSON.stringify(definition, null, 2)})],`).join("\n")}\n  ],`).join("\n")}\n}`
        : JSON.stringify(definitions, null, 2);
      return `export const ${group}: {\n${fields}\n} = ${data};\n`;
    }),
    ...(Object.keys(chapter.pages).length ? [`export const pages = ${JSON.stringify(chapter.pages)} as const;`, ""] : []),
    ...(chapter.execution && chapter.state ? [
      'import { instructionSet } from "../builders.ts";',
      `import { state } from "./state/${name}.ts";`,
      `export const instructions = instructionSet(Object.values(families).flat()${opcodePageLayouts(chapter.pages).some(page => page.on) ? ", 24" : Object.keys(chapter.pages).length ? ", 16" : ""});`,
      `const options = { state: { name: "StoredState", module: "../semantics/generated/state/${name}.ts" }, origin: "specifications/${name}.md" };`,
      'export const instructionModules = [',
      `  { name: ${JSON.stringify(name)}, cpu: ${JSON.stringify(cpu)} as const, definitions: instructions, options: { ...options, bindOpcodes: true${Object.keys(chapter.pages).length ? ", pages" : ""} } },`,
      `  { name: ${JSON.stringify(`${name}-state`)}, cpu: ${JSON.stringify(cpu)} as const, definitions: actions, options: { ...options, sources: { cpu: { name: ${JSON.stringify(cpu)} as const, state }, groups: { views } } } },`,
      '];', '',
    ] : []),
  ].join("\n");
}

/** Bootstrap chapter data before loading the registry that consumes it; paths are independent of cwd. */
export function generateCpuChapters() {
  const root = new URL("../src/components/cpus/", import.meta.url);
  // Only chapters without owned state need external schemas.
  const externalStates = new Map<string, StateFields>([
    ["68000-word-transfers", cpu68000StateDescription],
  ]);
  const chapters = readdirSync(new URL("specifications/", root)).filter(file => file.endsWith(".md")).sort().map(file => {
    const name = file.slice(0, -3);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || ["catalogue", "interfaces", "state"].includes(name)) {
      throw new Error(`Invalid or reserved chapter filename: ${file}`);
    }
    const source = new URL(`specifications/${name}.md`, root);
    const chapter = compileCpuChapter(readFileSync(source, "utf8"), { state: externalStates.get(name) }, fileURLToPath(source));
    const cpu = chapter.cpu;
    return { name, cpu, chapter, module: chapterModule(chapter, name, cpu), state: chapter.state &&
      generateChapterState(chapter.state) + (chapter.interface ? generatePublicState(chapter.state, chapter.interface) : "") };
  });
  const complete = chapters.filter(({ chapter }) => chapter.execution && chapter.state);
  const registered = new Set<string>();
  for (const { name, cpu } of complete) {
    if (registered.has(cpu)) throw new Error(`${name}.md: Duplicate complete CPU chapter for ${cpu}.`);
    registered.add(cpu);
  }
  const catalogue = ["// Generated chapter instruction catalogue. Do not edit.",
    ...complete.map(({ name }, index) => `import { instructionModules as modules${index} } from "./${name}.ts";`),
    ...complete.map(({ name, cpu }) => `export { instructions as instructions${cpu[0]!.toUpperCase() + cpu.slice(1)} } from "./${name}.ts";`),
    `export const chapterInstructionModules = [${complete.map((_, index) => `...modules${index}`).join(", ")}];`, ""].join("\n");
  const publicChapters = chapters.filter(({ chapter }) => chapter.interface);
  const interfaces = ["// Generated public CPU models. Do not edit.",
    ...publicChapters.map(({ name }, index) => `import { state as state${index} } from "./state/${name}.ts";`),
    "export const chapterInterfaces = {",
    ...publicChapters.map(({ name, cpu, chapter }, index) => {
      const pc = chapter.interface!.snapshots.find(({ field }) => field === "pc");
      const storedPc = chapter.state?.pc;
      const pcBits = pc ? chapter.views[pc.view]!.width : storedPc?.kind === "unsigned" ? storedPc.bits : undefined;
      const maximumPc = pcBits === undefined ? undefined : 2 ** pcBits - 1;
      return `  ${JSON.stringify(cpu)}: { name: ${JSON.stringify(chapter.interface!.name)}, module: "generated/${name}-cpu", state: state${index}, ramSize: ${2 ** chapter.execution!.memoryBits}, maximumPc: ${maximumPc} },`;
    }), "} as const;", "export interface ChapterStates {",
    ...publicChapters.map(({ name, cpu, chapter }) =>
      `  ${JSON.stringify(cpu)}: import("./state/${name}.ts").${chapter.interface!.name}State;`),
    "}", ""].join("\n");
  const output = new URL("semantics/generated/", root);
  // Every chapter compiles before any existing output is removed.
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const { name, module, state } of chapters) {
    writeFileSync(new URL(`${name}.ts`, output), module);
    if (state !== undefined) {
      mkdirSync(new URL("state/", output), { recursive: true });
      writeFileSync(new URL(`state/${name}.ts`, output), state);
    }
  }
  writeFileSync(new URL("catalogue.ts", output), catalogue);
  writeFileSync(new URL("interfaces.ts", output), interfaces);
  return chapters;
}

if (import.meta.main) generateCpuChapters();
