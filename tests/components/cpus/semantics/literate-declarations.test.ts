import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

const document = (body: string) => `Declarations keep their own types, scopes, and effects.

\`\`\`cpu
cpu "probe"
state {
  register A: 8
  flag C
  flag Z
  flag P
}
${body}
\`\`\``;
const compile = (body: string) => compileCpuChapter(document(body), {}, "declarations.md");

test("reusable declarations preserve mixed argument order, empty signatures, and shared view identity", async () => {
  const chapter = compile(`view ACC "accumulator" (): 8 {
  byte = register A
  return byte
}
source selectByte "select a byte" (word: 16, pick: flag, byte: 8): 8 {
  return select(pick, lowByte(word), byte)
}
policy FLAGS "carry and zero" (pick: flag, byte: 8) {
  C = pick
  Z = zero(byte)
}
policy unchanged "preserve every flag" () {
}
action store "store a selection" (word: 16, pick: flag, byte: 8) {
  result = source selectByte(word, pick, byte)
  A <- result
  apply FLAGS(pick, result)
  apply unchanged()
}
family load (word: 16, pick: flag, byte: 8) "00000000" {
  perform store(word, pick, byte)
}`);
  assert.equal(chapter.views.ACC, chapter.sources.ACC);
  assert.equal(Object.isFrozen(chapter.views.ACC), true);
  const signature = { word: 16, pick: "flag", byte: 8 };
  assert.deepEqual(chapter.sources.selectByte!.inputs, signature);
  assert.deepEqual(chapter.actions.store!.inputs, signature);
  assert.deepEqual(chapter.policies.FLAGS!.parameters, { pick: "flag", byte: 8 });
  const source = stripTypeScriptTypes(generateInstructions("probe", { load: chapter.families.load![0]![1] }))
    .replace('"../alu.ts"', JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  type State = { a: number; flags: { c: boolean; z: boolean; p: boolean } };
  const { instructions }: { instructions: { load(state: State, word: number, pick: boolean, byte: number): void } } =
    await import(`data:text/javascript,${encodeURIComponent(source)}`);
  for (const pick of [false, true]) for (const byte of [0, 0xff]) {
    const state: State = { a: 99, flags: { c: !pick, z: false, p: true } };
    instructions.load(state, 0x1234, pick, byte);
    const expected = pick ? 0x34 : byte;
    assert.deepEqual(state, { a: expected, flags: { c: pick, z: expected === 0, p: true } });
  }
});

const failures: readonly [body: string, declaration: string, line: string, column: number | "end", message: RegExp][] = [
  ['source read "wrong width": 16 {\n  return u8(0)\n}', "source read", "  return u8(0)", 1, /source result width/],
  ['view ACC "writes state": 8 {\n  A <- u8(1)\n  return u8(0)\n}', "view ACC", "  A <- u8(1)", 1, /Views may only read stored state/],
  ['action store "hidden memory" {\n  when 0 {\n    memory(u16(0)) <- u8(1)\n  }\n}', "action store", "    memory(u16(0)) <- u8(1)", 1, /without using memory/],
  ['policy flags "unknown flag" () {\n  UNKNOWN = 0\n}', "policy flags", "  UNKNOWN = 0", 3, /Unknown name UNKNOWN/],
  ['source read<bits: 8, 16> "wrong width": bits {\n  return u8(0)\n}', "source read<16>", "  return u8(0)", 1, /source result width.*with bits = 16/],
  ['policy parity<bits: 8, 16> "byte parity" (result: bits) {\n  P = evenParity(result)\n}', "policy parity<16>", "  P = evenParity(result)", 1, /parity requires a byte.*with bits = 16/],
  ['view ACC "inputs" (byte: 8): 8 {\n  return byte\n}', "view ACC", 'view ACC "inputs" (byte: 8): 8 {', 28, /Views cannot require inputs/],
  ['policy flags "needs parentheses" {\n}', "policy flags", 'policy flags "needs parentheses" {', 34, /Expected "\("/],
  ['action store<bits: 8> "no action variants" {\n}', "action store", 'action store<bits: 8> "no action variants" {', 14, /Only sources and policies/],
  ['source read<bits: 8, 8> "duplicate widths": bits {\n  return u<bits>(0)\n}', "source read", 'source read<bits: 8, 8> "duplicate widths": bits {', 23, /Duplicate width 8/],
  ['source read "missing return": 8 {\n}', "source read", 'source read "missing return": 8 {', "end", /must end with return/],
];

for (const [body, declaration, line, column, message] of failures) test(`${declaration} diagnoses ${line.trim()} at its original Markdown position`, () => {
  assert.throws(() => compile(body), error => {
    assert.ok(error instanceof ChapterError);
    assert.equal(error.file, "declarations.md");
    assert.equal(error.line, document(body).split("\n").indexOf(line) + 1);
    assert.equal(error.column, column === "end" ? line.length + 1 : column);
    assert.deepEqual(error.context, [`${declaration} at declarations.md:11`]);
    assert.match(error.detail, message);
    assert.ok(error.cause instanceof ChapterError);
    assert.equal(error.cause.message, `declarations.md:${error.line}:${error.column}: ${error.detail}`);
    return true;
  });
});

test("shared parameter parsing rejects duplicates for sources, actions, and policies at the second parameter", () => {
  for (const [kind, suffix, body] of [["source", ": 8", "  return byte\n"], ["action", "", ""], ["policy", "", ""]]) {
    const header = `${kind} duplicate "duplicate" (byte: 8, byte: flag)${suffix} {`;
    assert.throws(() => compile(`${header}\n${body}}`), error => {
      assert.ok(error instanceof ChapterError);
      assert.equal(error.line, 11); assert.equal(error.column, header.indexOf("flag") + 1);
      assert.equal(error.detail, "Duplicate parameter byte.");
      assert.deepEqual(error.context, [`${kind} duplicate at declarations.md:11`]);
      return true;
    });
  }
});

test("declaration diagnostics do not leak into later declarations or compilations", () => {
  assert.throws(() => compile(failures[4]![0]), /source read<16>/);
  const valid = 'source read<bits: 8, 16> "identity" (input: bits): bits {\n  return input\n}';
  assert.deepEqual(Object.keys(compile(valid).sources), ["read<8>", "read<16>"]);
  assert.throws(() => compile(`${valid}\naction later "closed scope" {\n  A <- input\n}`), error => {
    assert.ok(error instanceof ChapterError);
    assert.deepEqual(error.context, ["action later at declarations.md:14"]);
    assert.match(error.detail, /input has not been captured/);
    assert.doesNotMatch(error.message, /with bits|read<16>/);
    return true;
  });
});
