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
import { defineState, unsigned, flag, group } from "../../../../src/components/cpus/state.js";

const file = "src/components/cpus/specifications/6502.md";
const markdown = readFileSync(file, "utf8"), cpu = { name: "6502" };
const compile = (text = markdown) => compileCpuChapter(text, cpu, file);
const compileExternal = (text: string) => compileCpuChapter(text, { ...cpu, state: cpu6502StateDescription }, file);

test("the chapter owns all 151 documented instruction forms and the production address sources", () => {
  const chapter = compile();
  assert.deepEqual(chapter.families.LDA!.map(([opcode]) => opcode), [0xa1, 0xa5, 0xa9, 0xad, 0xb1, 0xb5, 0xb9, 0xbd]);
  assert.deepEqual(chapter.families.STA!.map(([opcode]) => opcode), [0x81, 0x85, 0x8d, 0x91, 0x95, 0x99, 0x9d]);
  const expected = [
    0x01, 0x05, 0x09, 0x0d, 0x11, 0x15, 0x19, 0x1d,
    0x21, 0x24, 0x25, 0x29, 0x2c, 0x2d, 0x31, 0x35, 0x39, 0x3d,
    0x41, 0x45, 0x49, 0x4d, 0x51, 0x55, 0x59, 0x5d,
    0x81, 0x84, 0x85, 0x86, 0x8a, 0x8c, 0x8d, 0x8e,
    0x91, 0x94, 0x95, 0x96, 0x98, 0x99, 0x9a, 0x9d,
    0xa0, 0xa1, 0xa2, 0xa4, 0xa5, 0xa6, 0xa8, 0xa9, 0xaa, 0xac, 0xad, 0xae,
    0xb1, 0xb4, 0xb5, 0xb6, 0xb9, 0xba, 0xbc, 0xbd, 0xbe,
    0xc0, 0xc1, 0xc4, 0xc5, 0xc9, 0xcc, 0xcd, 0xd1, 0xd5, 0xd9, 0xdd, 0xe0, 0xe4, 0xec,
    // ADC/SBC, shifts/rotates, memory INC/DEC, and the four index adjustments.
    0x61, 0x65, 0x69, 0x6d, 0x71, 0x75, 0x79, 0x7d,
    0xe1, 0xe5, 0xe9, 0xed, 0xf1, 0xf5, 0xf9, 0xfd,
    0x06, 0x0a, 0x0e, 0x16, 0x1e, 0x26, 0x2a, 0x2e, 0x36, 0x3e,
    0x46, 0x4a, 0x4e, 0x56, 0x5e, 0x66, 0x6a, 0x6e, 0x76, 0x7e,
    0xc6, 0xce, 0xd6, 0xde, 0xe6, 0xee, 0xf6, 0xfe, 0x88, 0xca, 0xc8, 0xe8,
    // Control flow, stack/status, software entry/return, and NOP.
    0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38, 0x40, 0x48, 0x4c, 0x50, 0x58,
    0x60, 0x68, 0x6c, 0x70, 0x78, 0x90, 0xb0, 0xb8, 0xd0, 0xd8, 0xea, 0xf0, 0xf8,
  ].sort((a, b) => a - b);
  assert.equal(expected.length, 151);
  assert.deepEqual(Object.values(chapter.families).flat().map(([opcode]) => opcode).sort((a, b) => a - b), expected);
  for (const entries of Object.values(chapter.families)) for (const [opcode, definition] of entries) {
    assert.deepEqual(definition, instructions6502[opcode]);
    assert.ok(Object.isFrozen(instructions6502[opcode]));
  }
  for (const [name, source] of Object.entries(sources6502.groups.addresses)) assert.deepEqual(chapter.sources[name], source);
  assert.equal(Object.keys(sources6502.groups.addresses).length, 8);
  assert.equal(chapter.operands.accumulator![2]!.kind, "value");
});

test("the chapter owns the independently specified stored-state schema and its public field order", () => {
  const expected = defineState({
    a: unsigned(8), x: unsigned(8), y: unsigned(8), sp: unsigned(8), pc: unsigned(16),
    flags: group({ n: flag, v: flag, d: flag, i: flag, z: flag, c: flag }),
  });
  assert.deepEqual(compile().state, expected);
  assert.deepEqual(cpu6502StateDescription, expected);
  assert.deepEqual(Object.keys(cpu6502StateDescription), Object.keys(expected));
  assert.deepEqual(Object.keys(cpu6502StateDescription.flags.fields), Object.keys(expected.flags.fields));
  assert.throws(() => compileExternal(markdown), /state is already defined/);
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
  ["register width", "register A: 8", "register A: 16", /expected 16-bit value/],
  ["undeclared register", "index = register X", "index = register MISSING", /Unknown name MISSING/],
  ["scope", "A <- result", "A <- missing", /has not been captured/],
  ["width", "A <- result", "A <- extend(result, 16)", /expected 8-bit value/],
  ["unknown operation", "return extend(offset, 16)", "return widen(offset, 16)", /Unknown numeric operation/],
  ["literal overflow", "add(pointer, u8($01))", "add(pointer, u8($100))", /literal does not fit/],
  ["argument count", "apply NZ(result)", "apply NZ(result, result)", /Expected/],
  ["trailing input", "result = source b", "result = source b extra", /trailing input/],
  ["host code", "result = source b", "result = eval(1)", /Unknown numeric operation/],
  ["duplicate capture", "base = concat(high, low)", "offset = concat(high, low)", /already|duplicate/i],
  ["forward source", "memory zeroPageX", "memory later", /Unknown name later/],
  ["duplicate selector code", '001 "zero page"', '000 "zero page"', /consecutive binary/],
  ["selector cardinality", '"101 bbb 01"', '"101 bbbb 1"', /requires 16 values/],
  ["opcode collision", '"100 bbb 01"', '"101 bbb 01"', /Duplicate opcode/],
  ["invalid selection", "in accumulator.read", "in accumulator.unknown", /Select a catalogue/],
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

test("unknown declarations are reported before looking for a name or closing brace", () => {
  for (const declaration of ["flga", "flga N", 'soruce byte "byte": 8 {\n}', "flga N\nflag Z"]) {
    const text = `# State\n\nDeclarations precede their uses.\n\n\`\`\`cpu\ncpu "6502"\n${declaration}\n\`\`\``;
    assert.throws(() => compile(text), (error: unknown) => {
      assert.ok(error instanceof ChapterError); assert.equal(error.file, file);
      assert.equal(error.line, 7); assert.equal(error.column, 1);
      assert.match(error.message, /Unknown declaration/); return true;
    });
  }
});

test("policy scope and width errors point to the offending flag update", () => {
  for (const [update, message] of [
    ["Z = zero(missing)", /value missing has not been captured/],
    ["Z = zero(zeroPage)", /value zeroPage has not been captured/],
    ["Z = zero(highByte(result))", /high byte requires a word/],
  ] as const) {
    const text = markdown.replace("Z = zero(result)", update);
    const expected = text.split("\n").findIndex(line => line.trim() === update) + 1;
    assert.throws(() => compile(text), (error: unknown) => {
      assert.ok(error instanceof ChapterError); assert.equal(error.file, file);
      assert.equal(error.line, expected); assert.match(error.message, message); return true;
    });
  }
});

test("policy parameters are validated at the declaration, including empty policies", () => {
  for (const body of ["", "\n  Z = zero(Result)"]) {
    const text = `\`\`\`cpu\ncpu "6502"\nflag Z\npolicy NZ "N/Z" (Result: 8) {${body}\n}\n\`\`\``;
    assert.throws(() => compileExternal(text), (error: unknown) => {
      assert.ok(error instanceof ChapterError); assert.equal(error.file, file);
      assert.equal(error.line, 4); assert.match(error.message, /invalid value name "Result"/); return true;
    });
  }
});

test("incomplete fences, sources, and empty chapters are rejected", () => {
  assert.throws(() => compile('```cpu\ncpu "6502"'), /Unclosed cpu fence/);
  assert.throws(() => compile("Only prose."), /Expected a cpu declaration/);
  assert.throws(() => compileExternal('```cpu\ncpu "6502"\nsource empty "empty": 8 {\n}\n```'), /must end with return/);
  assert.throws(() => compileExternal('```cpu\ncpu "6502"\nsource empty "empty": 8 {\n```'), /closing }/);
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

test("index addressing, comparison carry, and BIT flags are controlled by chapter edits", async () => {
  const cases = [
    { family: "LDX", opcode: 0xb6, before: "for b in indexedY.read", after: "for b in indexedX.read",
      byte: 0xff, expected: [2, 1], result: (state: Cpu6502State) => state.x },
    { family: "CMP", opcode: 0xc9, before: "C = not(borrow(left, right))", after: "C = borrow(left, right)",
      byte: 0x45, expected: [true, false], result: (state: Cpu6502State) => state.flags.c },
    { family: "BIT", opcode: 0x24, before: "V = not(zero(and(operand, u8($40))))", after: "V = not(zero(and(operand, u8($80))))",
      byte: 0x40, expected: [true, false], result: (state: Cpu6502State) => state.flags.v },
  ];
  for (const entry of cases) for (const changed of [false, true]) {
    assert.ok(markdown.includes(entry.before));
    const chapter = compile(changed ? markdown.replace(entry.before, entry.after) : markdown);
    const definition = chapter.families[entry.family]!.find(([opcode]) => opcode === entry.opcode)![1];
    const source = generateInstructions("6502", { probe: definition });
    const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
    const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
    const compiled: { instructions: { probe(state: Cpu6502State, context: { fetchByte(): number; readByte(address: number): number }): void } } =
      await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
    const state: Cpu6502State = { a: 0x45, x: 2, y: 3, sp: 0xff, pc: 0x1000,
      flags: { n: true, v: true, d: true, i: true, z: false, c: false } };
    compiled.instructions.probe(state, { fetchByte: () => entry.byte, readByte: address => address });
    assert.equal(entry.result(state), entry.expected[Number(changed)], `${entry.family}, changed=${changed}`);
    assert.equal(state.flags.d, true);
    assert.equal(state.flags.i, true);
  }
});
