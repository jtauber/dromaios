import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileCpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";
import { chapterCatalogue } from "../src/components/cpus/semantics/literate/catalogue.ts";
import { wordExecutionSources } from "../src/components/cpus/semantics/literate/word-execution.ts";

/** Read and validate the chapters and bind their catalogues without generating or writing files. */
export function compileCpuChapters() {
  const root = new URL("../src/components/cpus/", import.meta.url);
  const chapters = readdirSync(new URL("specifications/", root)).filter(file => file.endsWith(".md")).sort().map(file => {
    const name = file.slice(0, -3);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || ["catalogue", "interfaces", "state"].includes(name)) {
      throw new Error(`Invalid or reserved chapter filename: ${file}`);
    }
    const source = new URL(`specifications/${name}.md`, root);
    const chapter = compileCpuChapter(readFileSync(source, "utf8"), {}, fileURLToPath(source));
    const cpu = chapter.cpu;
    return { name, cpu, chapter };
  });
  // Keep word models first, then flat/decoded byte models, then segmented models.
  const complete = chapters.filter(({ chapter }) => chapter.execution && chapter.state)
    .sort((left, right) => ["word", "byte", "segmented"].indexOf(left.chapter.execution!.mode) - ["word", "byte", "segmented"].indexOf(right.chapter.execution!.mode));
  const registered = new Set<string>();
  for (const { name, cpu } of complete) {
    if (registered.has(cpu)) throw new Error(`${name}.md: Duplicate complete CPU chapter for ${cpu}.`);
    registered.add(cpu);
  }
  const bindings = complete.map(({ name, chapter }) => chapterCatalogue(name, {
    ...chapter, state: chapter.state!, mode: chapter.execution!.mode,
    ...(chapter.execution?.mode === "word" ? { readers: wordExecutionSources(chapter.execution) } : {}),
  }));
  return {
    chapters, complete,
    instructionModules: bindings.flatMap(binding => binding.instructionModules),
    instructionDefinitions: bindings.flatMap(binding => binding.instructionDefinitions),
  };
}
