import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { Ram } from "../../../../src/components/memory/ram.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { generateChapterInterface, generatePublicState } from "../../../../src/components/cpus/semantics/literate/interface.js";
import { generateChapterState } from "../../../../src/components/cpus/semantics/literate/state.js";
import { generateChapterExecution } from "../../../../src/components/cpus/semantics/literate/execution.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import type { Cpu8008, Cpu8008State } from "../../../../src/components/cpus/generated/8008-cpu.js";

const file = "src/components/cpus/specifications/8008.md", markdown = readFileSync(file, "utf8");
const compile = (text: string) => compileCpuChapter(text, { name: "8008" }, file);

/** Load every emitted layer, so edits to the formal interface must reach the real public object. */
async function generated(text: string, cpu: "8008" | "8080" = "8008"): Promise<Record<string, unknown>> {
  const chapter = compileCpuChapter(text, { name: cpu }, file), state = chapter.state!, api = chapter.interface!;
  const base = new URL("../../../../src/components/cpus/generated/", import.meta.url);
  const moduleUrl = (source: string, bindings: Readonly<Record<string, string>> = {}, relative = base): string => {
    const code = stripTypeScriptTypes(source).replace(/from "([^"]+)"/g, (_, path: string) =>
      `from ${JSON.stringify(bindings[path] ?? new URL(path.replace(/\.ts$/, ".js"), relative).href)}`);
    return `data:text/javascript,${encodeURIComponent(code)}`;
  };
  const schema = moduleUrl(generateChapterState(state) + generatePublicState(state, api), {}, new URL("../semantics/generated/state/", base));
  const opcodes = moduleUrl(generateInstructions(cpu, Object.fromEntries(Object.values(chapter.families).flat()), { bindOpcodes: true }));
  const actions = moduleUrl(generateInstructions(cpu, chapter.actions, { sources: { cpu: { name: cpu, state }, groups: { views: chapter.views } } }));
  const execution = moduleUrl(generateChapterExecution(cpu, cpu, chapter.execution!), { [`./${cpu}.ts`]: opcodes, [`./${cpu}-state.ts`]: actions });
  return import(moduleUrl(generateChapterInterface(cpu, state, api), {
    [`../semantics/generated/state/${cpu}.ts`]: schema, [`./${cpu}-state.ts`]: actions, [`./${cpu}-execution.ts`]: execution,
  }));
}

test("formal public names and snapshot mappings determine the emitted class and live detached views", async () => {
  const exports = await generated(markdown.replace("interface Cpu8008", "interface CpuSmall")
    .replace("snapshot pc = PC", "snapshot location = PC").replace("snapshot hl = HL", "snapshot pair = HL"));
  assert.equal(exports.Cpu8008, undefined);
  const CpuSmall = exports.CpuSmall as new (ram: Ram, state: Cpu8008State) => Omit<Cpu8008, "snapshot"> & {
    snapshot(): Cpu8008State & { location: number; pair: number };
  };
  const ram = new Ram(0x4000);
  const state: Cpu8008State = { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0xff, l: 0xfe,
    flags: { s: false, z: true, p: false, c: true }, addressStack: [0, 1, 2, 3, 4, 5, 6, 0x3fff], stackIndex: 7, halted: false };
  const cpu = new CpuSmall(ram, state);
  const snapshot = cpu.snapshot();
  assert.equal(snapshot.location, 0x3fff); assert.equal(snapshot.pair, 0xfffe);
  assert.equal("pc" in snapshot, false); assert.equal("hl" in snapshot, false);
  state.h = 0; state.flags.c = false; snapshot.flags.z = false;
  assert.equal(cpu.snapshot().pair, 0xfffe); assert.equal(cpu.snapshot().flags.c, true); assert.equal(cpu.snapshot().flags.z, true);
  ram.write(0x3fff, 0x06); ram.write(0, 0x42);
  cpu.step();
  assert.equal(snapshot.location, 0x3fff); assert.equal(cpu.snapshot().location, 1); assert.equal(cpu.snapshot().a, 0x42);
  cpu.reset(); assert.equal(cpu.snapshot().halted, true); assert.equal(cpu.snapshot().location, 0);
  cpu.interrupt(() => 0xc0); assert.equal(cpu.snapshot().halted, false);
});

test("public generation works with another processor name, class, schema, and snapshot shape", async () => {
  const text = markdown.replace('cpu "8008"', 'cpu "8080"').replace("interface Cpu8008", "interface CpuProbe")
    .replace("= addressStack", "= slots").replace("= stackIndex", "= selection").replace("= halted", "= idle")
    .replace("snapshot pc = PC", "snapshot current = PC").replace("snapshot hl = HL", "snapshot other = PC");
  const exports = await generated(text, "8080");
  const CpuProbe = exports.CpuProbe as new (ram: Ram, state: object) => { snapshot(): Record<string, unknown>; step(): { outcome: string } };
  const cpu = new CpuProbe(new Ram(0x4000), { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0,
    flags: { s: false, z: false, p: false, c: false }, slots: [0, 1, 2, 3, 4, 5, 6, 7], selection: 4, idle: true });
  assert.equal(cpu.snapshot().current, 4); assert.equal(cpu.snapshot().other, 4);
  assert.equal(cpu.step().outcome, "halted"); assert.equal("addressStack" in cpu.snapshot(), false);
});

const invalid: readonly [string, string, string, RegExp][] = [
  ["missing view", "snapshot pc = PC", "snapshot pc = absent", /Unknown state view absent/],
  ["stored register instead of view", "snapshot pc = PC", "snapshot pc = A", /Unknown state view A/],
  ["stored-field collision", "snapshot pc = PC", "snapshot a = PC", /Duplicate or reserved snapshot field a/],
  ["duplicate snapshot", "snapshot hl = HL", "snapshot pc = HL", /Duplicate or reserved snapshot field pc/],
  ["unknown field", "snapshot pc = PC", "property pc = PC", /Expected "snapshot"/],
  ["invalid class", "interface Cpu8008", "interface class", /Public class names/],
  ["colliding alias", "= addressStack", "= snapshot", /Public state alias Cpu8008Snapshot conflicts/],
];
for (const [name, before, after, expected] of invalid) test(`public interface rejects ${name} at its Markdown location`, () => {
  assert.throws(() => compile(markdown.replace(before, after)), error => error instanceof ChapterError &&
    error.file === file && error.line > 0 && expected.test(error.message));
});

test("public interfaces require owned state and execution, and cannot be repeated", () => {
  const declaration = '\n```cpu\ninterface CpuOther "probe" {\n}\n```\n';
  assert.throws(() => compile(markdown + declaration), /already declared/);
  assert.throws(() => compile(markdown.replace("## Register views", declaration + "## Register views")), /chapter-owned state and an earlier execution/);
  assert.throws(() => compileCpuChapter('```cpu\ncpu "8008"\ninterface CpuOther "probe" {\n}\n```',
    { name: "8008", state: compile(markdown).state! }), /chapter-owned state/);
});

test("descriptions cannot terminate generated comments or add executable code", async () => {
  const exports = await generated(markdown.replace("Instruction-level Intel 8008", "*/ throw new Error('injected'); /* Intel 8008"));
  assert.equal(typeof exports.Cpu8008, "function");
});
