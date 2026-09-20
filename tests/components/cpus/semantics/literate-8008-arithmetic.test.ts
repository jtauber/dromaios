import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { instructions8008 } from "../../../../src/components/cpus/semantics/definitions/8008.js";
import { opcodeEntries } from "../../../../src/components/cpus/generated/8008.js";
import type { Cpu8008StoredState } from "../../../../src/components/cpus/state/8008.js";

const file = "src/components/cpus/specifications/8008.md", markdown = readFileSync(file, "utf8");
const cpu = { name: "8008" };
const compile = (text = markdown) => compileCpuChapter(text, cpu, file);
function state(): Cpu8008StoredState {
  return { a: 0x10, b: 3, c: 3, d: 4, e: 5, h: 0xff, l: 0xff, flags: { s: true, z: true, p: true, c: true },
    addressStack: [0, 1, 2, 3, 4, 5, 6, 7], stackIndex: 3, halted: false };
}

test("the 8008 specification includes all 88 independent arithmetic/unary encodings", () => {
  const chapter = compile(), definitions = Object.fromEntries(Object.values(chapter.families).flat());
  assert.equal(Object.keys(definitions).length, 250);
  const names = ["A", "B", "C", "D", "E", "H", "L", "M"];
  let arithmetic = 0;
  for (const [name, base, immediate] of [
    ["AD", 0x80, 0x04], ["AC", 0x88, 0x0c], ["SU", 0x90, 0x14], ["SB", 0x98, 0x1c],
    ["ND", 0xa0, 0x24], ["XR", 0xa8, 0x2c], ["OR", 0xb0, 0x34], ["CP", 0xb8, 0x3c],
  ] as const) {
    const expected = names.map((register, code) => [base + code, `${name}${register}`]);
    expected.push([immediate, `${name}I byte`]);
    assert.deepEqual(chapter.families[name]!.map(([opcode, definition]) => [opcode, definition.name]), expected);
    arithmetic += expected.length;
  }
  for (const [name, expected] of [
    ["IN", [0x08, 0x10, 0x18, 0x20, 0x28, 0x30]], ["DC", [0x09, 0x11, 0x19, 0x21, 0x29, 0x31]],
    ["RLC", [0x02]], ["RRC", [0x0a]], ["RAL", [0x12]], ["RAR", [0x1a]],
  ] as const) {
    assert.deepEqual(chapter.families[name]!.map(([opcode]) => opcode), expected);
    arithmetic += expected.length;
  }
  assert.equal(arithmetic, 88);
  for (const [opcode, definition] of Object.entries(definitions)) assert.deepEqual(definition, instructions8008[Number(opcode)]);
  assert.deepEqual(opcodeEntries(state()).map(([opcode]) => opcode), Array.from({ length: 256 }, (_, code) => code)
    .filter(code => ![0x22, 0x2a, 0x32, 0x38, 0x39, 0x3a].includes(code)));
});

const invalid: readonly [string, string, string, RegExp][] = [
  ["duplicate register", "register D: 8", "register C: 8", /Duplicate declaration C/],
  ["duplicate flag", "  flag C\n", "  flag P\n", /Duplicate declaration P/],
  ["unknown flag read", "carry = flag C", "carry = flag A", /Unknown name A/],
  ["missing carry capture", "add(left, right, carry)", "add(left, right, missing)", /flag missing has not been captured/],
  ["byte used as carry", "add(left, right, carry)", "add(left, right, left)", /flag left has not been captured/],
  ["flag used as byte", "add(left, right, carry)", "add(carry, right)", /is a flag, not a number/],
  ["mismatched arithmetic widths", "subtract(left, right)", "subtract(left, extend(right, 16))", /equal widths/],
  ["numeric shift input", "shiftLeft(original, carry)", "shiftLeft(original, original)", /flag original has not been captured/],
  ["parity requires a byte", "evenParity(result)", "evenParity(extend(result, 16))", /parity requires a byte/],
  ["duplicate policy parameter", "result: 8, carry: flag", "result: 8, result: flag", /Duplicate parameter result/],
  ["wrong policy argument type", "ALU(result, carry(left, right))", "ALU(result, result)", /flag result has not been captured/],
  ["missing policy argument", "ALU(result, carry(left, right))", "ALU(result)", /Expected/],
  ["extra policy argument", "ALU(result, carry(left, right))", "ALU(result, 0, 1)", /Expected/],
  ["policy flag expression scope", "C = carry", "C = left", /flag left has not been captured/],
  ["unknown immediate source", "with s = immediateByte", "with s = missing", /Unknown name missing/],
  ["binding shadows a source", "with s = immediateByte", "with immediateByte = immediateByte", /must not shadow/],
  ["duplicate source binding", "with s = immediateByte", "with s = immediateByte, s = immediateByte", /must not shadow/],
  ["source binding shadows a selector", "for s in bytes.read named", "for s in bytes.read with s = immediateByte named", /must not shadow/],
  ["collision between encodings", 'encoding "00 000 100"', 'encoding "10 000 000"', /Duplicate opcode/],
  ["fixed instruction has no name placeholders", 'family RLC "00 000 010"', 'family RLC "00 000 010" named "RLC{r}"', /Unknown name placeholder/],
];
for (const [name, before, after, message] of invalid) test(`8008 arithmetic chapter rejects ${name} at the edited line`, () => {
  assert.ok(markdown.includes(before));
  const text = markdown.replace(before, after), expected = markdown.slice(0, markdown.indexOf(before)).split("\n").length;
  assert.throws(() => compile(text), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, file);
    assert.equal(error.line, expected); assert.match(error.message, message); return true;
  });
});

test("each encoding has its own source bindings and must contribute an opcode", () => {
  const unbound = markdown.replace('with s = immediateByte named "ADI byte"', 'named "ADI byte"');
  const line = unbound.split("\n").findIndex(text => text.trim() === "right = source s") + 1;
  assert.throws(() => compile(unbound), (error: unknown) => error instanceof ChapterError && error.line === line && /Unknown name s/.test(error.message));
  assert.throws(() => compile(markdown.replace('named "ADI byte"', 'named "ADI byte" except "00 000 100"')), /encoding must define at least one/);
  const empty = markdown.replace(/  encoding "10 000 sss"[^\n]*\n  encoding "00 000 100"[^\n]*\n/, "");
  assert.throws(() => compile(empty), /family needs at least one encoding/);
});

interface ProbeContext { fetchByte(): number; readByte(address: number): number }
async function probes(text: string, opcodes: readonly number[]) {
  const definitions = Object.fromEntries(Object.values(compile(text).families).flat());
  const source = generateInstructions("8008", Object.fromEntries(opcodes.map(code => [code, definitions[code]!])));
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: Readonly<Record<number, (state: Cpu8008StoredState, context: ProbeContext) => void>> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return compiled.instructions;
}

test("one formal arithmetic edit changes register, memory, and immediate execution with distinct register C and flag C", async () => {
  const execute = await probes(markdown.replace("result = add(left, right, carry)", "result = subtract(left, right, carry)"), [0x8a, 0x8f, 0x0c]);
  for (const opcode of [0x8a, 0x8f, 0x0c]) {
    const current = state(), events: string[] = [];
    execute[opcode]!(current, {
      fetchByte() { events.push("fetch"); return 3; },
      readByte(address) { assert.equal(address, 0x3fff); events.push("read"); return 3; },
    });
    assert.equal(current.a, 12); assert.equal(current.c, 3);
    assert.deepEqual(current.flags, { s: false, z: false, p: true, c: false });
    assert.deepEqual(events, opcode === 0x8a ? [] : opcode === 0x8f ? ["read"] : ["fetch"]);
  }
});

test("a formal parity-policy edit changes adjustment flags without touching preserved carry", async () => {
  const execute = await probes(markdown.replace("P = evenParity(result)", "P = zero(result)"), [0x08]);
  const current = state(); current.b = 2;
  const forbidden = () => { assert.fail("Register adjustment must not fetch or read memory"); };
  execute[0x08]!(current, { fetchByte: forbidden, readByte: forbidden });
  assert.equal(current.b, 3); assert.deepEqual(current.flags, { s: false, z: false, p: false, c: true });
});

test("policies may have no parameters, and flag parameters are checked even without updates", async () => {
  const text = markdown + '\nSet carry without reading state.\n\n```cpu\npolicy setC "set C" () {\n  C = 1\n}\nfamily setCarry "00 100 010" {\n  apply setC()\n}\n```\n';
  const execute = await probes(text, [0x22]), current = state(); current.flags.c = false;
  execute[0x22]!(current, { fetchByte: () => 0, readByte: () => 0 });
  assert.equal(current.flags.c, true);
  assert.doesNotThrow(() => compile(markdown + '\n```cpu\npolicy unused "unused" (input: flag) {\n}\n```'));
  assert.throws(() => compile(markdown + '\n```cpu\npolicy unused "unused" (Input: flag) {\n}\n```'), /invalid value name/);
});
