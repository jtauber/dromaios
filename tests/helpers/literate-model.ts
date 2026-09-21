import { stripTypeScriptTypes } from "node:module";
import { compileCpuChapter } from "../../src/components/cpus/semantics/literate/compile.js";
import { generateInstructions } from "../../src/components/cpus/semantics/generate.js";
import { generateChapterState } from "../../src/components/cpus/semantics/literate/state.js";
import { generateChapterExecution } from "../../src/components/cpus/semantics/literate/execution.js";
import { generateChapterInterface, generatePublicState } from "../../src/components/cpus/semantics/literate/interface.js";

/** Resolve generated layers together without writing build output. */
function chapterLayers(text: string, name: string, file: string) {
  const chapter = compileCpuChapter(text, { name }, file), state = chapter.state!, api = chapter.interface;
  const base = new URL("../../src/components/cpus/generated/", import.meta.url);
  const url = (source: string, bindings: Readonly<Record<string, string>> = {}, relative = base) => {
    const code = stripTypeScriptTypes(source).replace(/from "([^"]+)"/g, (_, path: string) =>
      `from ${JSON.stringify(bindings[path] ?? new URL(path.replace(/\.ts$/, ".js"), relative).href)}`);
    return `data:text/javascript,${encodeURIComponent(code)}`;
  };
  const schema = url(generateChapterState(state) + (api ? generatePublicState(state, api) : ""), {}, new URL("../semantics/generated/state/", base));
  const opcodes = url(generateInstructions(name, Object.fromEntries(Object.values(chapter.families).flat()), { bindOpcodes: true, pages: chapter.pages }));
  const actions = url(generateInstructions(name, chapter.actions, { sources: { cpu: { name, state }, groups: { views: chapter.views } } }));
  const execution = url(generateChapterExecution(name, name, chapter.execution!), { [`./${name}.ts`]: opcodes, [`./${name}-state.ts`]: actions });
  return { chapter, state, api, url, schema, actions, execution };
}

/** Load a partial chapter's boundary before it owns its complete public interface. */
export async function generateChapterExecutionModule(text: string, name: string, file: string) {
  return import(chapterLayers(text, name, file).execution);
}

/** Load all generated layers: every mutation must change the public CPU, not just compiler data. */
export async function generateChapterModule(text: string, name: string, file: string) {
  const { chapter, state, api, url, schema, actions, execution } = chapterLayers(text, name, file);
  if (!api) throw new Error("The chapter must declare its public interface.");
  const exports = await import(url(generateChapterInterface(name, state, api, chapter.execution!), {
    [`../semantics/generated/state/${name}.ts`]: schema, [`./${name}-state.ts`]: actions, [`./${name}-execution.ts`]: execution,
  }));
  return exports;
}
