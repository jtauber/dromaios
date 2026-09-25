import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import type { CpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

const document = (body: string) => `Aliases retain their operand bindings and ordered effects.

\`\`\`cpu
cpu "probe"
state {
  register A: 8
  register B: 8
  register W: 16
  flag Z
}
${body}
\`\`\``;
const compile = (body: string) => compileCpuChapter(document(body), {}, "families.md");
type State = { a: number; b: number; w: number; flags: { z: boolean } };
const initial = (): State => ({ a: 0x12, b: 0x34, w: 0x5678, flags: { z: false } });

async function executable(chapter: CpuChapter) {
  const definitions = Object.fromEntries(Object.values(chapter.families).flat());
  const source = generateInstructions("probe", definitions);
  const code = stripTypeScriptTypes(source).replace('"../alu.ts"',
    JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  const module: { instructions: Readonly<Record<number, (state: State, ...inputs: number[]) => void>> } =
    await import(`data:text/javascript,${encodeURIComponent(code)}`);
  return module.instructions;
}

const copies = `operands bytes {
  0 "same label" = register A
  1 "same label" = register B
}
family copy "0s0d x000" for s in bytes.read, d in bytes named "copy {s}, {d}" {
  byte = source s
  operand d <- byte
}`;

test("opcode aliases share frozen bodies without merging different source or destination bindings", async () => {
  const chapter = compile(copies), entries = chapter.families.copy!;
  const definitions = Object.fromEntries(entries), instructions = await executable(chapter);
  assert.deepEqual(entries.map(([opcode]) => opcode), [0, 8, 16, 24, 64, 72, 80, 88]);
  assert.equal(new Set(entries.map(([, definition]) => definition)).size, 4);
  for (const [opcode, definition] of entries) {
    assert.equal(definition, definitions[opcode ^ 8]);
    assert.equal(Object.isFrozen(definition), true);
    assert.equal(Object.isFrozen(definition.steps), true);
    const state = initial(), expected = initial();
    expected[opcode & 16 ? "b" : "a"] = opcode & 64 ? state.b : state.a;
    instructions[opcode]!(state);
    assert.deepEqual(state, expected);
  }
});

test("word aliases preserve runtime inputs and exclude the first and last encodings", async () => {
  const chapter = compile(`family fill (byte: 8) "1010 xxxx xxxx xxxx" except "1010 0000 0000 0000", "1010 1111 1111 1111" {
  A <- byte
}`);
  const entries = chapter.families.fill!;
  assert.equal(entries.length, 4094);
  assert.equal(entries[0]![0], 0xa001);
  assert.equal(entries.at(-1)![0], 0xaffe);
  assert.equal(new Set(entries.map(([, definition]) => definition)).size, 1);
  assert.deepEqual(entries[0]![1].inputs, { byte: 8 });
  const instructions = await executable({ ...chapter, families: { fill: [entries[0]!, entries.at(-1)!] } });
  for (const opcode of [0xa001, 0xaffe]) for (const byte of [0, 0xff]) {
    const state = initial(); instructions[opcode]!(state, byte);
    assert.deepEqual(state, { ...initial(), a: byte });
  }
});

const bindings = `source left "left value": 8 {
  return u8(1)
}
source right "right value": 8 {
  return u8(2)
}
family load {
  encoding "0000 00xx" with b = left named "left"
  encoding "0000 01xx" with b = right named "right"
  byte = source b
  A <- byte
}
family other "0000 10xx" {
  B <- u8(3)
}`;

test("body sharing stays within its encoding declaration and compilation", async () => {
  for (const changed of [false, true]) {
    const chapter = compile(changed ? bindings.replace("u8(1)", "u8(9)") : bindings);
    const instructions = await executable(chapter);
    assert.deepEqual(chapter.families.load!.map(([, definition]) => definition.name),
      ["left", "left", "left", "left", "right", "right", "right", "right"]);
    const left = changed ? 9 : 1;
    for (let opcode = 0; opcode < 12; opcode++) {
      const state = initial(), expected = initial();
      if (opcode < 8) expected.a = opcode < 4 ? left : 2;
      else expected.b = 3;
      instructions[opcode]!(state);
      assert.deepEqual(state, expected);
    }
  }
});

test("condition bindings with the same label retain opposite tests across aliases", async () => {
  const chapter = compile(`conditions tests {
  0 "same label" = flag Z = 0
  1 "same label" = flag Z = 1
}
family conditional "0000 00cx" for c in tests {
  when test c {
    A <- u8(1)
  }
}`);
  const instructions = await executable(chapter);
  for (let opcode = 0; opcode < 4; opcode++) for (const z of [false, true]) {
    const state = { ...initial(), flags: { z } };
    instructions[opcode]!(state);
    assert.equal(state.a, z === Boolean(opcode & 2) ? 1 : 0x12);
  }
});

test("excluded, unsupported, and non-memory address selections remain absent", () => {
  const text = `source pointer "address": 16 {
  return u16($1234)
}
operands choices {
  00 "A" = register A
  01 "B" = register B
  10 "memory" = memory pointer
  11 "absent" = unsupported
}
family load "0000 rrxx" for r in choices.read except "0000 00xx" {
  captured = source r
  A <- lowByte(captured)
}`;
  assert.deepEqual(compile(text).families.load!.map(([opcode]) => opcode), [4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(compile(text.replace("choices.read", "choices.address")).families.load!.map(([opcode]) => opcode), [8, 9, 10, 11]);
});

test("reuse preserves collision checks, excluded bodies, and later binding diagnostics", () => {
  const cases: readonly [string, string, RegExp][] = [
    [`family first "0000 0011" {\n}\nfamily aliases "0000 00xx" {\n}`, "family aliases", /Duplicate opcode \$3/],
    [`family first "0000 00xx" {\n}\nfamily overlap "0000 001x" {\n  A <- missing\n}`, "family overlap", /Duplicate opcode \$2/],
    [`family absent "0000 00xx" except "0000 00xx" {\n  A <- missing\n}`, "family absent", /at least one instruction/],
    [copies.replace('1 "same label" = register B', '1 "same label" = register W'), "operand d <- byte", /expected 16-bit value/],
  ];
  for (const [body, line, message] of cases) {
    const expectedLine = document(body).split("\n").findIndex(text => text.includes(line)) + 1;
    assert.throws(() => compile(body), (error: unknown) => {
      assert.ok(error instanceof ChapterError);
      assert.equal(error.file, "families.md"); assert.equal(error.line, expectedLine);
      assert.match(error.message, message); return true;
    });
  }
});

test("encoding and body errors retain exact Markdown positions, including deferred page checks", () => {
  const cases: readonly [string, string, "end" | number, RegExp][] = [
    [`family copy {
  encoding "0000 00xx"
  encoding "0000 001x"
}`, '  encoding "0000 001x"', "end", /Duplicate opcode \$2/],
    [`family copy "0000 00xx" except "0000 1000" {
}`, 'family copy "0000 00xx" except "0000 1000" {', "end", /outside this family/],
    [`family copy {
  encoding "0000 0000"
  encoding "0000 0001" with byte = missing
}`, '  encoding "0000 0001" with byte = missing', 36, /Unknown name missing/],
    [`family copy {
  encoding "0000 0000"
  encoding "0000 0001"
  A <- missing
}`, "  A <- missing", 1, /missing has not been captured/],
    [`family word "0000 0000 0000 0000" {
}
page later = $20`, 'family word "0000 0000 0000 0000" {', "end", /Word opcode patterns/],
    [`family byte "0010 0000" {
}
page later = $20`, "page later = $20", "end", /collides with an instruction opcode/],
  ];
  for (const [body, line, column, message] of cases) {
    const expectedLine = document(body).split("\n").indexOf(line) + 1;
    assert.throws(() => compile(body), (error: unknown) => {
      assert.ok(error instanceof ChapterError);
      assert.equal(error.file, "families.md");
      assert.equal(error.line, expectedLine);
      assert.equal(error.column, column === "end" ? line.length + 1 : column);
      assert.match(error.message, message);
      return true;
    });
  }
});

function diagnostic(body: string): ChapterError {
  try { compile(body); } catch (error) {
    assert.ok(error instanceof ChapterError);
    return error;
  }
  return assert.fail("Expected a chapter diagnostic.");
}

test("family diagnostics identify the failing operand codes even when labels match", () => {
  const body = copies.replace('1 "same label" = register B', '1 "same label" = register W');
  const error = diagnostic(body);
  assert.equal(error.file, "families.md");
  assert.equal(error.line, document(body).split("\n").indexOf("  operand d <- byte") + 1);
  assert.equal(error.column, 1);
  assert.deepEqual(error.context, ["family copy", 'encoding "0s0d x000" at families.md:15',
    'opcode $10 with s=0 ("same label"), d=1 ("same label")']);
  assert.match(error.detail, /expected 16-bit value/);
  assert.equal(error.message, `families.md:${error.line}:1: ${error.detail}\n  ${error.context.join("\n  ")}`);
  let cause = error;
  while (cause.cause instanceof ChapterError) {
    const original = cause.cause;
    assert.deepEqual([original.file, original.line, original.column, original.detail],
      [error.file, error.line, error.column, error.detail]);
    cause = original;
  }
  assert.deepEqual(cause.context, []);
  assert.equal(cause.message, `families.md:${error.line}:1: ${error.detail}`);
});

test("family diagnostics keep the current encoding and page after earlier bindings succeed", () => {
  const body = `page first = $20
page nested = $30 on first {
  offset:8 = read
  opcode = read
}
family load {
  encoding "0000 00xx" with r = register A
  encoding "0000 00xx" on nested with r = register W
  operand r <- u8(1)
}`;
  const error = diagnostic(body);
  assert.equal(error.line, 19);
  assert.equal(error.column, 1);
  assert.deepEqual(error.context, ["family load", 'encoding "0000 00xx" at families.md:18',
    "opcode $203000 on nested"]);
  assert.match(error.detail, /expected 16-bit value/);
  // Failed compilations must not leave a family or opcode attached to the next error.
  const next = diagnostic('family other "1111 1111" {\n  A <- missing\n}');
  assert.deepEqual(next.context, ["family other", 'encoding "1111 1111" at families.md:11', "opcode $FF"]);
  assert.match(next.detail, /missing has not been captured/);
});

test("word diagnostics report separated selector bits and the first included alias", () => {
  const error = diagnostic(`operands words {
  00 "A" = register A
  01 "absent" = unsupported
  10 "word" = register W
  11 "word" = register W
}
family copy "0000 rxxx 0000 rxxx" for r in words except "0000 1000 0000 0000" {
  operand r <- u8(1)
}`);
  assert.deepEqual(error.context, ["family copy", 'encoding "0000 rxxx 0000 rxxx" at families.md:17',
    'opcode $0801 with r=10 ("word")']);
  assert.match(error.detail, /expected 16-bit value/);
});

test("family header diagnostics supply only the context known before expansion", () => {
  const cases: readonly [string, readonly string[], RegExp][] = [
    ['family empty {\n}', ["family empty"], /at least one encoding/],
    ['family invalid "00" {\n}', ["family invalid", 'encoding "00" at families.md:11'], /eight bits or sixteen bits/],
    ['family unknown "0000 0000" with byte = missing {\n}',
      ["family unknown", 'encoding "0000 0000" at families.md:11'], /Unknown name missing/],
    ['family excluded "0000 0000" except "0000 0001" {\n}',
      ["family excluded", 'encoding "0000 0000" at families.md:11'], /outside this family/],
    ['family absent "0000 0000" except "0000 0000" {\n  A <- missing\n}',
      ["family absent", 'encoding "0000 0000" at families.md:11'], /at least one instruction/],
  ];
  for (const [body, context, detail] of cases) {
    const error = diagnostic(body);
    assert.deepEqual(error.context, context);
    assert.match(error.detail, detail);
  }
});

test("collision diagnostics include the colliding alias and name-template errors retain their encoding location", () => {
  const error = diagnostic(`family first "0000 0011" {
}
family aliases "0000 00xx" {
}`);
  assert.deepEqual(error.context, ["family aliases", 'encoding "0000 00xx" at families.md:13', "opcode $03"]);
  assert.match(error.detail, /Duplicate opcode \$3/);
  const invalid = diagnostic(copies.replace('named "copy {s}, {d}"', 'named "copy {missing}"'));
  assert.equal(invalid.line, 15);
  assert.deepEqual(invalid.context, ["family copy", 'encoding "0s0d x000" at families.md:15',
    'opcode $00 with s=0 ("same label"), d=0 ("same label")']);
  assert.match(invalid.detail, /Unknown name placeholder/);
});
