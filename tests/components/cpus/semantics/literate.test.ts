import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError, chapterBlocks } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { instructions6502, sources6502 } from "../../../../src/components/cpus/semantics/definitions/6502.js";
import { cpu6502StateDescription } from "../../../../src/components/cpus/state/6502.js";
import type { Cpu6502State } from "../../../../src/components/cpus/state/6502.js";

const file = "src/components/cpus/specifications/6502-load-store.md";
const markdown = readFileSync(file, "utf8"), cpu = { name: "6502", state: cpu6502StateDescription };
const compile = (text = markdown) => compileCpuChapter(text, cpu, file);

test("the chapter owns exactly the documented LDA/STA opcodes and the production address sources", () => {
  const chapter = compile();
  assert.deepEqual(chapter.families.LDA!.map(([opcode]) => opcode), [0xa1, 0xa5, 0xa9, 0xad, 0xb1, 0xb5, 0xb9, 0xbd]);
  assert.deepEqual(chapter.families.STA!.map(([opcode]) => opcode), [0x81, 0x85, 0x8d, 0x91, 0x95, 0x99, 0x9d]);
  for (const entries of Object.values(chapter.families)) for (const [opcode, definition] of entries) {
    assert.deepEqual(definition, instructions6502[opcode]);
    assert.ok(Object.isFrozen(instructions6502[opcode]));
  }
  const { immediateByte: _immediate, ...addresses } = chapter.sources;
  assert.deepEqual(addresses, sources6502.groups.addresses);
  assert.equal(chapter.modes.accumulator![2]!.address, undefined);
});

test("family prose is authored in Markdown and statements carry Markdown line positions", () => {
  const changed = markdown.replace("Finish the source reads before writing the destination,", "Capture the source before writing the destination,");
  assert.match(compile(changed).families.LDA![0]![1].explanation, /^Capture the source/);
  const blocks = chapterBlocks("# Example\n\nOne paragraph\ncontinued.\n\n~~~cpu\ncpu \"6502\"\n~~~~\n", "example.md");
  assert.deepEqual(blocks, [{ explanation: "One paragraph continued.", lines: [{ line: 7, text: 'cpu "6502"' }] }]);
  assert.deepEqual(compile(markdown.replace(/\n/g, "\r\n")), compile());
});

test("non-CPU fences stay inert, including nested-looking cpu fences and host-language text", () => {
  const inert = "````text\n```cpu\nprocess.exit()\n```\n````\n\n";
  assert.deepEqual(compile(inert + markdown), compile());
  assert.deepEqual(chapterBlocks("```typescript\nthrow new Error();\n```", file), []);
  assert.deepEqual(chapterBlocks('- Example:\n\n  ```cpu\n  cpu "6502"\n  ```', file), []);
});

const invalid: readonly [string, string, string, RegExp][] = [
  ["register schema", "register A: 8", "register A: 16", /does not match the CPU state schema/],
  ["undeclared register", "index = register X", "index = register SP", /Unknown name SP/],
  ["scope", "A <- result", "A <- missing", /has not been captured/],
  ["width", "A <- result", "A <- extend(result, 16)", /expected 8-bit value/],
  ["unknown operation", "return extend(offset, 16)", "return truncate(offset, 16)", /Unknown numeric operation/],
  ["literal overflow", "add(pointer, u8($01))", "add(pointer, u8($100))", /literal does not fit/],
  ["argument count", "apply NZ(result)", "apply NZ(result, result)", /Expected/],
  ["trailing input", "result = source b", "result = source b extra", /trailing input/],
  ["host code", "result = source b", "result = eval(1)", /Unknown numeric operation/],
  ["duplicate capture", "base = concat(high, low)", "offset = concat(high, low)", /already|duplicate/i],
  ["forward source", "memory zeroPageX", "memory later", /Unknown name later/],
  ["duplicate selector code", '001 "zero page"', '000 "zero page"', /consecutive binary/],
  ["selector cardinality", '"101 bbb 01"', '"101 bbbb 1"', /requires 16 values/],
  ["opcode collision", '"100 bbb 01"', '"101 bbb 01"', /Duplicate opcode/],
  ["invalid selection", "in accumulator.read", "in accumulator.unknown", /Select modes/],
  ["shadowed source", '"101 bbb 01" for b', '"101 bbb 01" for absolute', /must not shadow/],
  ["duplicate flag", "  Z = zero(result)", "  N = zero(result)", /Duplicate update/],
  ["duplicate declaration", "flag Z", "flag N", /Duplicate declaration/],
];
for (const [name, before, after, message] of invalid) test(`chapter diagnostics reject ${name} at a document location`, () => {
  assert.ok(markdown.includes(before), name);
  const text = markdown.replace(before, after);
  assert.throws(() => compile(text), (error: unknown) => {
    assert.ok(error instanceof ChapterError);
    assert.equal(error.file, file);
    assert.match(error.message, message);
    assert.ok(error.line > 1 && error.column >= 1);
    assert.ok(text.split("\n")[error.line - 1]!.trim().length > 0);
    return true;
  });
});

test("a semantic error points to the offending statement, including preceding prose and blank lines", () => {
  const text = markdown.replace("A <- result", "A <- missing");
  const expected = text.split("\n").findIndex(line => line.includes("A <- missing")) + 1;
  assert.throws(() => compile(text), (error: unknown) => error instanceof ChapterError && error.line === expected);
});

test("incomplete fences, sources, and empty chapters are rejected", () => {
  assert.throws(() => compile('```cpu\ncpu "6502"'), /Unclosed cpu fence/);
  assert.throws(() => compile("Only prose."), /Expected a cpu declaration/);
  assert.throws(() => compile('```cpu\ncpu "6502"\nsource empty "empty": 8 {\n}\n```'), /must end with return/);
  assert.throws(() => compile('```cpu\ncpu "6502"\nsource empty "empty": 8 {\n```'), /closing }/);
  assert.throws(() => compile(markdown.replace('cpu "6502"', 'cpu "8080"')), /Expected CPU 6502/);
});

test("editing a formal rule changes generated execution, while surrounding prose is not executed", async () => {
  // This deliberately incorrect experiment must affect the emitted body: the document is authoritative.
  const chapter = compile(markdown.replace("return byte", "return add(byte, u8($01))"));
  const definition = chapter.families.LDA!.find(([opcode]) => opcode === 0xa9)![1];
  const source = generateInstructions("6502", { probe: definition });
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: { probe(state: Cpu6502State, context: { fetchByte(): number }): void } } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const state: Cpu6502State = { a: 0x45, x: 0, y: 0, sp: 0xff, pc: 0x1000,
    flags: { n: true, z: false, v: true, d: true, i: true, c: true } };
  compiled.instructions.probe(state, { fetchByte: () => 0xff });
  assert.equal(state.a, 0);
  assert.deepEqual(state.flags, { n: false, z: true, v: true, d: true, i: true, c: true });
});
