import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { compileCpuChapter } from "../../src/components/cpus/semantics/literate/compile.js";
import { generateChapterExecution } from "../../src/components/cpus/semantics/literate/execution.js";
import { generateChapterInterface, generatePublicState } from "../../src/components/cpus/semantics/literate/interface.js";
import { generateChapterState } from "../../src/components/cpus/semantics/literate/state.js";
import { generateChapterReset } from "../../src/components/cpus/semantics/literate/reset.js";
import { wordExecutionSources } from "../../src/components/cpus/semantics/literate/word-execution.js";
import { generateWordEvents } from "../../src/components/cpus/semantics/literate/word-events.js";
import { generateInstructions } from "../../src/components/cpus/semantics/generate.js";
import { instructionModules } from "../../src/components/cpus/semantics/definitions.js";
import type { Cpu68000 } from "../../src/components/cpus/generated/68000-cpu.js";

const base = new URL("../../src/components/cpus/generated/", import.meta.url);
function moduleUrl(source: string, bindings: Readonly<Record<string, string>> = {}, relative = base): string {
  const code = stripTypeScriptTypes(source).replace(/from "([^"]+)"/g, (_, path: string) =>
    `from ${JSON.stringify(bindings[path] ?? new URL(path.replace(/\.ts$/, ".js"), relative).href)}`);
  return `data:text/javascript,${encodeURIComponent(code)}`;
}
const markdown = readFileSync("src/components/cpus/specifications/68000.md", "utf8");
export async function edited68000(replacements: readonly (readonly [string, string])[]): Promise<typeof Cpu68000> {
  let text = markdown;
  for (const [before, after] of replacements) { assert.ok(text.includes(before), before); text = text.replace(before, after); }
  const chapter = compileCpuChapter(text), modules = instructionModules.filter(entry => entry.cpu === "68000" && entry.name !== "68000-state");
  const policy = chapter.execution!;
  if (policy.mode !== "word") throw new Error("Expected word contract");
  const actions = moduleUrl(generateInstructions(chapter.cpu, chapter.actions, {
    sources: { cpu: { name: chapter.cpu, state: chapter.state!, wordBoundary: true }, groups: { views: chapter.views, sources: Object.fromEntries(wordExecutionSources(policy).map(name => [name, chapter.sources[name]!])) } },
  }));
  const execution = moduleUrl(generateChapterExecution("68000", "68000", chapter.execution!, modules), { "./68000-state.ts": actions });
  assert.equal(chapter.execution?.mode, "word");
  const events = moduleUrl(generateWordEvents("68000", policy.events!, policy.terminal), { "./68000-state.ts": actions, "./68000-execution.ts": execution });
  const reset = moduleUrl(generateChapterReset("68000", chapter.reset!), { "./68000-state.ts": actions });
  const schema = moduleUrl(generateChapterState(chapter.state!) + generatePublicState(chapter.state!, chapter.interface!), {}, new URL("../semantics/generated/state/", base));
  return (await import(moduleUrl(generateChapterInterface("68000", chapter.state!, chapter.interface!, policy, chapter.reset), {
    "./68000-execution.ts": execution, "./68000-events.ts": events, "./68000-reset.ts": reset, "./68000-state.ts": actions,
    "../semantics/generated/state/68000.ts": schema,
  })))[chapter.interface!.name];
}
