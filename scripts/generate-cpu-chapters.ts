import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateChapterState } from "../src/components/cpus/semantics/literate/state.ts";
import { generatePublicState } from "../src/components/cpus/semantics/literate/interface.ts";
import { compileCpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";
import { wordExecutionSources } from "../src/components/cpus/semantics/literate/word-execution.ts";
import { opcodePageLayouts } from "../src/components/cpus/semantics/opcode-pages.ts";
import type { InstructionDefinition } from "../src/components/cpus/semantics/model.ts";
import type { CpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";

/** Keep exported names precise, while exposing ordinary IR types to the remaining TS definitions. */
function chapterModule(chapter: CpuChapter, name: string, cpu: string): string {
  const types = { sources: "ValueSource", views: "ValueSource", actions: "InstructionDefinition", policies: "FlagPolicy", operands: "readonly ChapterOperand[]", conditions: "readonly ChapterCondition[]", families: "readonly OpcodeEntry<InstructionDefinition>[]" };
  // Opcode aliases retain one validated definition; serialize shared bodies once.
  const definitions = new Map<string, { name: string; definition: InstructionDefinition }>();
  for (const entries of Object.values(chapter.families)) for (const [, definition] of entries) {
    const text = JSON.stringify(definition);
    if (!definitions.has(text)) definitions.set(text, { name: `instruction${definitions.size}`, definition });
  }
  const opcodeModule = `  { name: ${JSON.stringify(name)}, cpu: ${JSON.stringify(cpu)} as const, definitions: instructions, options: { ...options, bindOpcodes: true${Object.keys(chapter.pages).length ? ", pages" : ""} } },`;
  const word = chapter.execution?.mode === "word" ? chapter.execution : undefined;
  const readers = word ? `, sources: { ${wordExecutionSources(word).map(name => `${JSON.stringify(name)}: sources[${JSON.stringify(name)}]`).join(", ")} }` : "";
  const sourceCpu = `{ name: ${JSON.stringify(cpu)} as const, state${word ? ", wordBoundary: true as const" : ""} }`;
  const stateModule = `  { name: ${JSON.stringify(`${name}-state`)}, cpu: ${JSON.stringify(cpu)} as const, definitions: actions, options: { ...options, sources: { cpu: ${sourceCpu}, groups: { views${readers} } } } },`;
  return [
    "// Generated from a literate CPU chapter. Do not edit.",
    'import type { ValueSource, FlagPolicy, InstructionDefinition } from "../model.ts";',
    'import type { OpcodeEntry } from "../../opcodes.ts";',
    'import type { ChapterOperand, ChapterCondition } from "../literate/compile.ts";', "",
    'import { defineInstruction } from "../validate.ts";', "",
    ...[...definitions.values()].map(({ definition, name }) => `const ${name} = defineInstruction(${JSON.stringify(definition, null, 2)});\n`),
    ...Object.entries(types).map(([group, type]) => {
      const members = chapter[group as keyof typeof types];
      const fields = Object.keys(members).map(name => `  readonly ${JSON.stringify(name)}: ${type};`).join("\n");
      const data = group === "families" ? `{\n${Object.entries(chapter.families).map(([name, entries]) =>
        `  ${JSON.stringify(name)}: [\n${entries.map(([opcode, definition]) =>
          `    [${opcode}, ${definitions.get(JSON.stringify(definition))!.name}],`).join("\n")}\n  ],`).join("\n")}\n}`
        : JSON.stringify(members, null, 2);
      return `export const ${group}: {\n${fields}\n} = ${data};\n`;
    }),
    ...(Object.keys(chapter.pages).length ? [`export const pages = ${JSON.stringify(chapter.pages)} as const;`, ""] : []),
    ...(chapter.execution && chapter.state ? [
      ...(chapter.execution.mode === "word" ? ['import { wordInstructionGroups } from "../literate/word-execution.ts";'] : []),
      'import { instructionSet, instructionAliases } from "../builders.ts";',
      `import { state } from "./state/${name}.ts";`,
      `const entries = Object.values(families).flat();`,
      `export const instructions = instructionSet(entries${chapter.execution.mode === "segmented" || chapter.execution.mode === "word" ? ".filter(([, definition]) => !definition.inputs)" : ""}${opcodePageLayouts(chapter.pages).some(page => page.on) ? ", 24" : Object.keys(chapter.pages).length || chapter.execution.mode === "word" ? ", 16" : ""});`,
      ...(chapter.execution.mode === "segmented" ? [
        'export const operandInstructions = instructionSet(entries.filter(([, definition]) => definition.inputs && !Object.hasOwn(definition.inputs, "repeatMode")));',
        'export const strings = instructionSet(entries.filter(([, definition]) => definition.inputs && Object.hasOwn(definition.inputs, "repeatMode")));',
      ] : []),
      `const options = { ${chapter.execution.mode === "word" ? "opcodeBits: 16 as const, " : ""}state: { name: "StoredState", module: "../semantics/generated/state/${name}.ts" }, origin: "specifications/${name}.md" };`,
      'export const instructionModules = [',
      ...(chapter.execution.mode === "word" ? [stateModule, `  ...wordInstructionGroups(${JSON.stringify(name)}, entries).map(({ name, definitions, ...bindings }) => ({ name, cpu: ${JSON.stringify(cpu)} as const, definitions, options: { ...options, ...bindings } })),`] : chapter.execution.mode === "segmented" ? [stateModule, opcodeModule] : [opcodeModule, stateModule]),
      ...(chapter.execution.mode === "segmented" ? [
        `  { name: "${name}-operands", cpu: ${JSON.stringify(cpu)} as const, definitions: operandInstructions, options },`,
        `  { name: "${name}-strings", cpu: ${JSON.stringify(cpu)} as const, definitions: strings, options },`,
      ] : []),
      '];',
      chapter.execution.mode === "word"
        ? 'export const instructionDefinitions = [...Object.values(actions), ...Object.values(instructions), ...Object.values(instructionAliases(entries.filter(([, definition]) => Object.keys(definition.inputs ?? {}).length)).definitions)];'
        : 'export const instructionDefinitions = instructionModules.flatMap(({ definitions }) => Object.values(definitions));', '',
    ] : []),
  ].join("\n");
}

/** Bootstrap chapter data before loading the registry that consumes it; paths are independent of cwd. */
export function generateCpuChapters() {
  const root = new URL("../src/components/cpus/", import.meta.url);
  const chapters = readdirSync(new URL("specifications/", root)).filter(file => file.endsWith(".md")).sort().map(file => {
    const name = file.slice(0, -3);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || ["catalogue", "interfaces", "state"].includes(name)) {
      throw new Error(`Invalid or reserved chapter filename: ${file}`);
    }
    const source = new URL(`specifications/${name}.md`, root);
    const chapter = compileCpuChapter(readFileSync(source, "utf8"), {}, fileURLToPath(source));
    const cpu = chapter.cpu;
    return { name, cpu, chapter, module: chapterModule(chapter, name, cpu), state: chapter.state &&
      generateChapterState(chapter.state) + (chapter.interface ? generatePublicState(chapter.state, chapter.interface) : "") };
  });
  // Keep word models first, then flat/decoded byte models, then segmented models.
  const complete = chapters.filter(({ chapter }) => chapter.execution && chapter.state)
    .sort((left, right) => ["word", "byte", "segmented"].indexOf(left.chapter.execution!.mode) - ["word", "byte", "segmented"].indexOf(right.chapter.execution!.mode));
  const registered = new Set<string>();
  for (const { name, cpu } of complete) {
    if (registered.has(cpu)) throw new Error(`${name}.md: Duplicate complete CPU chapter for ${cpu}.`);
    registered.add(cpu);
  }
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
      const pcBits = pc ? chapter.views[pc.view]!.width : storedPc?.kind === "unsigned" ? storedPc.bits : undefined;
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
  for (const { name, module, state } of chapters) {
    writeFileSync(new URL(`${name}.ts`, output), module);
    if (state !== undefined) {
      mkdirSync(new URL("state/", output), { recursive: true });
      writeFileSync(new URL(`state/${name}.ts`, output), state);
    }
  }
  writeFileSync(new URL("catalogue.ts", output), catalogue);
  writeFileSync(new URL("interfaces.ts", output), interfaces);
  // The next stage needs model bindings only; release instruction graphs and rendered text
  // before it imports the generated registry's own representation of those instructions.
  return chapters.map(({ name, cpu, chapter }) => ({
    name, cpu, state: chapter.state, execution: chapter.execution, reset: chapter.reset, interface: chapter.interface,
  }));
}

if (import.meta.main) generateCpuChapters();
