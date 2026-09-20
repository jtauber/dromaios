import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { array, boolean, defineState, flag, group, namedChoices, readState, unsigned } from "../../../../src/components/cpus/state.js";
import type { StateFields } from "../../../../src/components/cpus/state.js";
import { cpu8008StateDescription } from "../../../../src/components/cpus/semantics/generated/state/8008.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateChapterState } from "../../../../src/components/cpus/semantics/literate/state.js";

const chapter = (body: string) => `# A small CPU\n\nStored fields.\n\n\`\`\`cpu\ncpu "probe"\n${body}\n\`\`\`\n`;
const compile = (body: string, state?: StateFields) => compileCpuChapter(chapter(body), { name: "probe", state }, "probe.md");

test("the 8008 chapter generates the complete independently specified stored-state contract", () => {
  const expected = defineState({
    a: unsigned(8), b: unsigned(8), c: unsigned(8), d: unsigned(8), e: unsigned(8), h: unsigned(8), l: unsigned(8),
    flags: group({ s: flag, z: flag, p: flag, c: flag }),
    addressStack: array(8, unsigned(14)), stackIndex: unsigned(3), halted: boolean,
  });
  const markdown = readFileSync("src/components/cpus/specifications/8008.md", "utf8");
  assert.deepEqual(compileCpuChapter(markdown, { name: "8008" }).state, expected);
  assert.deepEqual(cpu8008StateDescription, expected);
  assert.deepEqual(Object.keys(cpu8008StateDescription), Object.keys(expected));
  assert.equal(Object.hasOwn(cpu8008StateDescription, "pc"), false);
  assert.equal(Object.hasOwn(cpu8008StateDescription, "hl"), false);
});

async function generatedState(state: StateFields): Promise<StateFields> {
  const path = new URL("../../../../src/components/cpus/state.js", import.meta.url).href;
  const source = stripTypeScriptTypes(generateChapterState(state)).replace('"../../../state.ts"', JSON.stringify(path));
  const module: { state: StateFields } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  return module.state;
}

test("chapter-owned storage works for an arbitrary CPU and formal edits change generated validation", async () => {
  const text = "state {\n  register C: 8 = data\n  flag C\n  array SLOTS: 14[8]\n  latch STOPPED = stopped\n}";
  const initial = { data: 0x81, flags: { c: true }, slots: Array(8).fill(0x3fff), stopped: false };
  const schema = await generatedState(compile(text).state!);
  assert.deepEqual(schema, { data: unsigned(8), flags: group({ c: flag }), slots: array(8, unsigned(14)), stopped: boolean });
  const copied = readState(schema, initial);
  assert.deepEqual(copied, initial);
  assert.notEqual(copied.flags, initial.flags); assert.notEqual(copied.slots, initial.slots);
  assert.ok(Object.isFrozen(schema)); assert.ok(Object.isFrozen(schema.slots));
  assert.ok(Object.isFrozen(schema.flags));
  if (schema.flags?.kind === "group") assert.ok(Object.isFrozen(schema.flags.fields));
  assert.throws(() => readState(schema, { ...initial, data: 0x100 }), /data/);
  assert.throws(() => readState(schema, { ...initial, slots: Array(7).fill(0) }), /exactly 8/);
  assert.throws(() => readState(schema, { ...initial, slots: Array(8).fill(0x4000) }), /slots\[0\]/);
  assert.throws(() => readState(schema, { ...initial, flags: { c: 1 } }), /flags.c/);
  assert.throws(() => readState(schema, { ...initial, stopped: 0 }), /stopped/);

  const widened = await generatedState(compile(text.replace("C: 8", "C: 16")).state!);
  assert.doesNotThrow(() => readState(widened, { ...initial, data: 0x1234 }));
  const resized = await generatedState(compile(text.replace("14[8]", "14[4]")).state!);
  assert.throws(() => readState(resized, initial), /exactly 4/);
  assert.doesNotThrow(() => readState(resized, { ...initial, slots: Array(4).fill(0) }));
});

test("stored field mappings feed instruction references without an external schema", () => {
  const text = "state {\n  register A: 8 = accumulator\n  flag C = carry\n}\n" +
    "family load \"00 000 000\" {\n  A <- u8($FF)\n}";
  const instruction = compile(text).families.load![0]![1];
  assert.deepEqual(instruction.cpu.state, { accumulator: unsigned(8), flags: group({ carry: flag }) });
  assert.deepEqual(instruction.steps, [{ kind: "write-register", register: { kind: "register", cpu: "probe", field: "accumulator", width: 8 }, value: { kind: "literal", width: 8, value: 0xff } }]);
});

test("named choices generate immutable storage and validate exact public values", async () => {
  const text = 'state {\n  choice WAIT: "none", "sync", "cwai" = waitMode\n}';
  const schema = await generatedState(compile(text).state!);
  assert.deepEqual(schema, { waitMode: namedChoices("none", "sync", "cwai") });
  assert.ok(Object.isFrozen(schema.waitMode));
  if (schema.waitMode?.kind === "named-choice") assert.ok(Object.isFrozen(schema.waitMode.values));
  for (const waitMode of ["none", "sync", "cwai"]) assert.deepEqual(readState(schema, { waitMode }), { waitMode });
  for (const waitMode of ["SYNC", "halted", true, 0]) assert.throws(() => readState(schema, { waitMode }), /waitMode/);
  assert.throws(() => readState(schema, {}), /waitMode/);
  const changed = await generatedState(compile(text.replace('"cwai"', '"paused"')).state!);
  assert.throws(() => readState(changed, { waitMode: "cwai" }), /waitMode/);
  assert.doesNotThrow(() => readState(changed, { waitMode: "paused" }));
  assert.deepEqual(compile('state {\n choice MODE: "running"\n}').state, { mode: namedChoices("running") });
});

const invalid: readonly [string, string, RegExp][] = [
  ["empty state", "state {\n}", /at least one stored field/],
  ["missing state", "", /Expected a state block/],
  ["declaration before state", "register A: 8", /Define state before/],
  ["second state block", "state {\n register A: 8\n}\nstate {\n flag Z\n}", /already defined/],
  ["stored field outside state", "state {\n register A: 8\n}\nflag Z", /inside the state block/],
  ["duplicate register", "state {\n register A: 8\n register A: 8\n}", /Duplicate declaration A/],
  ["duplicate flag", "state {\n flag C\n flag C\n}", /Duplicate declaration C/],
  ["duplicate storage", "state {\n register A: 8\n register B: 8 = a\n}", /Duplicate stored field a/],
  ["duplicate flag storage", "state {\n flag C\n flag CARRY = c\n}", /Duplicate stored flag c/],
  ["flag group collision", "state {\n register FLAGS: 8\n flag C\n}", /conflicts with the flag group/],
  ["field after flag group", "state {\n flag C\n latch FLAGS\n}", /Duplicate stored field flags/],
  ["latch/register collision", "state {\n register A: 8\n latch STOPPED = a\n}", /Duplicate stored field a/],
  ["lowercase name", "state {\n register a: 8\n}", /must be uppercase/],
  ["unsupported width", "state {\n register A: 7\n}", /Expected width/],
  ["empty array", "state {\n array ADDRESS: 14[0]\n}", /positive safe integers/],
  ["unsafe array length", "state {\n array ADDRESS: 14[9007199254740992]\n}", /positive safe integers/],
  ["non-state declaration", "state {\n source BYTE\n}", /contain only/],
  ["trailing tokens", "state {\n flag C extra\n}", /trailing input/],
  ["empty choice list", 'state {\n choice WAIT:\n}', /quoted/],
  ["duplicate choice value", 'state {\n choice WAIT: "none", "none"\n}', /distinct/],
  ["empty choice value", 'state {\n choice WAIT: ""\n}', /nonempty/],
  ["choice trailing comma", 'state {\n choice WAIT: "none",\n}', /quoted/],
  ["choice storage collision", 'state {\n latch WAIT\n choice MODE: "none" = wait\n}', /Duplicate stored field wait/],
];
for (const [name, text, message] of invalid) test(`state authoring rejects ${name} with a Markdown diagnostic`, () => {
  assert.throws(() => compile(text), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, "probe.md");
    assert.match(error.message, message); return true;
  });
});

test("storage collisions report the second declaration's source location", () => {
  const text = chapter("state {\n  register A: 8\n  latch STOPPED = a\n}");
  const line = text.split("\n").findIndex(line => line.includes("latch STOPPED")) + 1;
  assert.throws(() => compileCpuChapter(text, { name: "probe" }, "probe.md"), (error: unknown) =>
    error instanceof ChapterError && error.line === line);
});

test("partial chapters still check declarations against an external schema and cannot redefine it", () => {
  const state = defineState({ a: unsigned(8), flags: group({ c: flag }), slots: array(8, unsigned(14)), stopped: boolean,
    waitMode: namedChoices("none", "sync", "cwai") });
  assert.equal(compile("register A: 8\nflag C\narray SLOTS: 14[8]\nlatch STOPPED", state).state, undefined);
  assert.throws(() => compile("register A: 16", state), /Register A.*schema/);
  assert.throws(() => compile("flag Z", state), /Unknown CPU flag Z/);
  assert.throws(() => compile("array SLOTS: 14[7]", state), /Array SLOTS.*schema/);
  assert.throws(() => compile("latch STOPPED = a", state), /Latch STOPPED.*schema/);
  assert.throws(() => compile("state {\n register A: 8\n}", state), /already defined/);
  assert.equal(compile('choice WAIT: "none", "sync", "cwai" = waitMode', state).state, undefined);
  for (const values of ['"none"', '"none", "sync", "stop"', '"cwai", "sync", "none"']) {
    assert.throws(() => compile(`choice WAIT: ${values} = waitMode`, state), /Choice WAIT.*schema/);
  }
  assert.throws(() => compile('choice WAIT: "none" = stopped', state), /Choice WAIT.*schema/);
});
