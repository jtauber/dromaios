import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { generateChapterState } from "../../../../src/components/cpus/semantics/literate/state.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { readState } from "../../../../src/components/cpus/state.js";

const text = `Named groups preserve nested storage and checked references.

\`\`\`cpu
cpu "probe"
state {
  register VECTOR: 8
  group ENTRY = frame {
    choice KIND: "none", "fault" = mode
    register VECTOR: 8
    latch VALID
    array SLOTS: 8[8]
    flag C
  }
}
policy marked "mark group" () {
  ENTRY.C = 1
}
action enter "record entry" {
  old = register ENTRY.VECTOR
  wasFault = choice ENTRY.KIND = "fault"
  valid = latch ENTRY.VALID
  saved = array ENTRY.SLOTS[u3(0)]
  ENTRY.SLOTS[] <- old
  ENTRY.SLOTS[u3(1)] <- saved
  ENTRY.KIND <- "fault"
  ENTRY.VALID <- not(valid)
  ENTRY.VECTOR <- u8($80)
  apply marked()
}
\`\`\``;
const compile = (source = text) => compileCpuChapter(source, {}, "groups.md");

test("named groups generate nested schemas and executable references for every stored field kind", async () => {
  const chapter = compile(), statePath = new URL("../../../../src/components/cpus/state.js", import.meta.url).href;
  const source = stripTypeScriptTypes(generateChapterState(chapter.state!)).replace('"../../../state.ts"', JSON.stringify(statePath));
  const generated = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  assert.deepEqual(generated.state, chapter.state);
  const original = { vector: 7, frame: { mode: "none", vector: 42, valid: false, slots: Array(8).fill(11), flags: { c: false } } };
  const state = readState(generated.state, original);
  assert.notEqual(state.frame, original.frame);
  const body = stripTypeScriptTypes(generateInstructions("probe", chapter.actions));
  const { instructions } = await import(`data:text/javascript,${encodeURIComponent(body)}`);
  instructions.enter(state);
  assert.deepEqual(state, { vector: 7, frame: { mode: "fault", vector: 128, valid: true, slots: [42, 11, 42, 42, 42, 42, 42, 42], flags: { c: true } } });
  assert.equal(original.frame.vector, 42);
  assert.throws(() => readState(generated.state, { ...original, frame: { ...original.frame, vector: 256 } }), /frame.vector/);
  assert.throws(() => readState(generated.state, { ...original, frame: { ...original.frame, mode: "trap" } }), /frame.mode/);
  const description = describeInstruction(chapter.actions.enter!);
  assert.match(description, /FRAME.VECTOR/); assert.match(description, /FRAME.mode/); assert.match(description, /FRAME.SLOTS/);
});

for (const [before, after, error] of [
  ["group ENTRY", "group entry", /uppercase/],
  ["group ENTRY", "bank ENTRY", /only registers and flags/],
  ["register VECTOR: 8\n    latch", "register VECTOR: 8 = mode\n    latch", /Duplicate stored field/],
  ["register ENTRY.VECTOR", "register ENTRY.MISSING", /Unknown name/],
  ['ENTRY.KIND <- "fault"', 'ENTRY.KIND <- "trap"', /declared control choice/],
] as const) test(`named group rejects ${after}`, () => {
  assert.throws(() => compile(text.replace(before, after)), error);
});
