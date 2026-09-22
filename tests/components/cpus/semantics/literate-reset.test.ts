import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateChapterReset } from "../../../../src/components/cpus/semantics/literate/reset.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { checkStateEffects } from "../../../../src/components/cpus/semantics/literate/statements.js";
import type { Cpu68000 } from "../../../../src/components/cpus/68000.js";
import { initialState } from "../../../helpers/68000-state.js";

const base = new URL("../../../../src/components/cpus/generated/", import.meta.url);
function moduleUrl(source: string, bindings: Readonly<Record<string, string>> = {}, relative = base): string {
  const code = stripTypeScriptTypes(source).replace(/from "([^"]+)"/g, (_, path: string) =>
    `from ${JSON.stringify(bindings[path] ?? new URL(path.replace(/\.ts$/, ".js"), relative).href)}`);
  return `data:text/javascript,${encodeURIComponent(code)}`;
}
function resetModule(markdown: string) {
  const chapter = compileCpuChapter(markdown, {}, "reset.md");
  const actions = moduleUrl(generateInstructions(chapter.cpu, chapter.actions));
  return moduleUrl(generateChapterReset(chapter.cpu, chapter.reset!), { [`./${chapter.cpu}-state.ts`]: actions });
}
const toy = (body: string) => `\`\`\`cpu
cpu "probe"
state {
  register A: 8
  latch FAILED
}
${body}
\`\`\``;
const declarations = `action readVector "read vector" using memory {
  first = memory(u16(12))
  A <- first
  second = memory(u16(13))
  A <- second
}
action finish "record reset failure" (failed: 8) {
  FAILED <- not(zero(failed))
}
reset {
  attempt action readVector
  complete action finish with failure
}`;

test("reset bindings work with unrelated state, preserve partial effects, and infer memory only when needed", async () => {
  type State = { a: number; failed: boolean };
  type Memory = { readByte(address: number): number };
  const module: { reset(state: State, memory: Memory, classify: (error: unknown) => string | undefined): string | void } =
    await import(resetModule(toy(declarations)));
  for (const failAt of [-1, 0, 1]) {
    const state = { a: 1, failed: true }, reads: number[] = [], signal = Symbol();
    const result = module.reset(state, { readByte(address) {
      reads.push(address); if (reads.length - 1 === failAt) throw signal; return address;
    } }, error => error === signal ? "fault" : undefined);
    assert.equal(result, failAt < 0 ? undefined : "fault");
    assert.deepEqual(state, { a: failAt < 0 ? 13 : failAt === 0 ? 1 : 12, failed: failAt >= 0 });
    assert.deepEqual(reads, failAt === 0 ? [12] : [12, 13]);
  }
  const stateOnly = declarations.replace(/using memory \{[\s\S]*?\n}/, '{\n  A <- u8(42)\n}');
  const pure: { reset(state: State, classify: (error: unknown) => undefined): void } = await import(resetModule(toy(stateOnly)));
  const state = { a: 1, failed: true }; pure.reset(state, () => undefined);
  assert.deepEqual(state, { a: 42, failed: false });
});

test("reset declarations reject missing, duplicate, mismatched, or hidden effects with source locations", () => {
  const invalid = [
    declarations.replace("attempt action readVector", "attempt action missing"),
    declarations.replace("  attempt action readVector\n", ""),
    declarations.replace("  complete action finish with failure\n", ""),
    declarations.replace("attempt action readVector", "attempt action readVector\n  attempt action readVector"),
    declarations.replace("complete action finish", "unknown action finish"),
    declarations.replace("(failed: 8)", "(failed: 16)"),
    declarations.replace('"read vector"', '"read vector" (address: 16)'),
    declarations.replace('"record reset failure" (failed: 8)', '"record reset failure" (failed: 8) using memory')
      .replace("FAILED <- not(zero(failed))", "perform readVector()"),
    declarations.replace("first = memory(u16(12))", "first = fetch"),
    declarations.replace("first = memory(u16(12))", "first = port(u16(12))"),
    declarations.replace("first = memory(u16(12))", "first = match u8(0) : 8 {\n    case \"00000000\" {\n      return u8(0)\n    }\n    otherwise unsupported\n  }"),
    declarations + "\nreset {\n  attempt action readVector\n  complete action finish with failure\n}",
  ];
  for (const text of invalid) assert.throws(() => compileCpuChapter(toy(text), {}, "reset.md"),
    error => error instanceof ChapterError && error.file === "reset.md" && error.line > 0 && error.column > 0, text);
  const byte = readFileSync("src/components/cpus/specifications/6502.md", "utf8");
  assert.throws(() => compileCpuChapter(byte + '\n```cpu\naction finish "finish" (failed: 8) {\n}\nreset {\n  attempt action reset\n  complete action finish with failure\n}\n```'), /duplicate an execution/);
});

const file = "src/components/cpus/specifications/68000.md", markdown = readFileSync(file, "utf8");
async function edited(replacements: readonly (readonly [string, string])[]): Promise<typeof Cpu68000> {
  let text = markdown;
  for (const [before, after] of replacements) { assert.ok(text.includes(before), before); text = text.replace(before, after); }
  const core = readFileSync("src/components/cpus/68000.ts", "utf8");
  return (await import(moduleUrl(core, { "./generated/68000-reset.ts": resetModule(text) }, new URL("../", base)))).Cpu68000;
}

test("chapter edits change the public 68000 reset vectors, completion effects, and alignment policy", async () => {
  const Cpu = await edited([
    ["stack = source readProgramLong(u32(0))", "stack = source readProgramLong(u32($10))"],
    ["start = source readProgramLong(u32(4))", "start = source readProgramLong(u32($14))"],
    ["fault alignment fetch(start) if lowBit(start)", "fault alignment fetch(start) if 0"],
    ["INTERRUPTMASK <- u3(7)", "INTERRUPTMASK <- u3(3)"],
  ]);
  const reads: number[] = [], bytes = [0x89, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0xba, 0x99];
  const cpu = new Cpu({ size: 0x1000000, read(address) { reads.push(address); return bytes[address - 16]!; }, write() { assert.fail(); } }, initialState());
  const record = cpu.reset();
  assert.deepEqual(reads, [16, 17, 18, 19, 20, 21, 22, 23]);
  assert.equal(record.after.ssp, 0x89abcdef); assert.equal(record.after.pc, 0xfedcba99);
  assert.equal(record.after.interruptMask, 3); assert.equal(record.after.faulted, false);
  assert.equal(Object.hasOwn(record, "fault"), false);
});

test("chapter edits change vector commit order and completion after a bus fault", async () => {
  const Cpu = await edited([
    ["SSP <- stack\n  start = source readProgramLong(u32(4))", "start = source readProgramLong(u32(4))\n  SSP <- stack"],
    ["FAULTED <- not(zero(failed))", "FAULTED <- 0"],
  ]);
  const cpu = new Cpu({ size: 0x1000000, read: address => address === 5 ? "bus-error" : 0, write() { assert.fail(); } }, initialState());
  const before = cpu.snapshot(), record = cpu.reset();
  assert.equal(record.after.ssp, before.ssp); assert.equal(record.after.pc, before.pc);
  assert.equal(record.after.faulted, false);
  assert.deepEqual(record.fault, { source: "bus-error", operation: "read", address: 5 });
});

test("program memory and alignment effects stay explicit and cannot escape into views or composed sources", () => {
  const chapter = compileCpuChapter(markdown);
  assert.throws(() => checkStateEffects(chapter.actions.loadResetVectors!.steps, "data-memory", false), /program-space memory/);
  assert.throws(() => checkStateEffects(chapter.actions.loadResetVectors!.steps, "memory", false), /using alignment/);
  assert.throws(() => checkStateEffects(chapter.actions.loadResetVectors!.steps, "alignment", false), /using memory/);
  for (const text of [
    markdown.replace('using memory, alignment {', 'using memory {'),
    markdown + '\n```cpu\naction hidden "hidden" using memory, alignment {\n  perform loadResetVectors()\n}\n```',
    markdown + '\n```cpu\nview HIDDEN "hidden" : 32 {\n  value = source readProgramLong(u32(0))\n  return value\n}\n```',
  ]) assert.throws(() => compileCpuChapter(text), ChapterError);
});
