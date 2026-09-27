import { instructionAliases, instructionSet } from "../builders.ts";
import type { generateInstructions } from "../generate.ts";
import { opcodePageLayouts } from "../opcode-pages.ts";
import type { StateFields } from "../../state.ts";
import type { CpuChapter } from "./compile.ts";
import type { ChapterExecution } from "./execution.ts";
import { wordInstructionGroups } from "./word-execution.ts";

type GenerationParameters = Parameters<typeof generateInstructions>;
export interface InstructionModule {
  /** Generated filename without its extension. */
  readonly name: string;
  readonly cpu: GenerationParameters[0];
  readonly definitions: GenerationParameters[1];
  readonly options?: GenerationParameters[2];
}

type CatalogueChapter = Pick<CpuChapter, "cpu" | "sources" | "views" | "actions" | "families" | "pages"> & {
  readonly state: StateFields;
  readonly mode: ChapterExecution["mode"];
  /** Standalone source readers selected by the word execution contract. */
  readonly readers?: readonly string[];
};

/** Use the same instruction partitions for compiled chapters and their serialized catalogues. */
export function chapterCatalogue(name: string, { cpu, state, mode, sources, views, actions, families, pages, readers = [] }: CatalogueChapter) {
  const entries = Object.values(families).flat();
  const instructions = instructionSet(mode === "byte" ? entries : entries.filter(([, definition]) => !definition.inputs),
    opcodePageLayouts(pages).some(page => page.on) ? 24 : Object.keys(pages).length || mode === "word" ? 16 : 8);
  const operandInstructions = instructionSet(mode === "segmented" ? entries.filter(([, definition]) =>
    definition.inputs && !Object.hasOwn(definition.inputs, "repeatMode")) : []);
  const strings = instructionSet(mode === "segmented" ? entries.filter(([, definition]) =>
    definition.inputs && Object.hasOwn(definition.inputs, "repeatMode")) : []);
  const options = { ...(mode === "word" ? { opcodeBits: 16 as const } : {}),
    state: { name: "StoredState", module: `../semantics/generated/state/${name}.ts` }, origin: `specifications/${name}.md` };
  const opcodeModule: InstructionModule = { name, cpu, definitions: instructions,
    options: { ...options, bindOpcodes: true, ...(Object.keys(pages).length ? { pages } : {}) } };
  const stateModule: InstructionModule = { name: `${name}-state`, cpu, definitions: actions, options: { ...options,
    sources: { cpu: { name: cpu, state, ...(mode === "word" ? { wordBoundary: true } : {}) },
      groups: { views, ...(mode === "word" ? { sources: Object.fromEntries(readers.map(name => [name, sources[name]!])) } : {}) } },
  } };
  const instructionModules: readonly InstructionModule[] = mode === "word"
    ? [stateModule, ...wordInstructionGroups(name, entries).map(({ name, definitions, ...bindings }) =>
      ({ name, cpu, definitions, options: { ...options, ...bindings } }))]
    : mode === "segmented" ? [stateModule, opcodeModule,
      { name: `${name}-operands`, cpu, definitions: operandInstructions, options },
      { name: `${name}-strings`, cpu, definitions: strings, options },
    ] : [opcodeModule, stateModule];
  // Explanations follow family order, independently of word-body output partitions.
  const instructionDefinitions = mode === "word"
    ? [...Object.values(actions), ...Object.values(instructions),
      ...Object.values(instructionAliases(entries.filter(([, definition]) => Object.keys(definition.inputs ?? {}).length)).definitions)]
    : instructionModules.flatMap(({ definitions }) => Object.values(definitions));
  return { instructions, operandInstructions, strings, instructionModules, instructionDefinitions };
}
