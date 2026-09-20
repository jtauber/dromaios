import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { instructions8008 } from "../../../../src/components/cpus/semantics/generated/catalogue.js";
import { opcodeEntries } from "../../../../src/components/cpus/generated/8008.js";
import type { Cpu8008StoredState } from "../../../../src/components/cpus/semantics/generated/state/8008.js";

const file = "src/components/cpus/specifications/8008.md";
const markdown = readFileSync(file, "utf8"), cpu = { name: "8008" };
const compile = (text = markdown) => compileCpuChapter(text, cpu, file);
function state(): Cpu8008StoredState {
  return { a: 0x80, b: 2, c: 3, d: 4, e: 5, h: 0xff, l: 0xff, flags: { s: true, z: false, p: true, c: true },
    addressStack: [0, 1, 2, 3, 4, 5, 6, 7], stackIndex: 3, halted: false };
}

test("the 8008 chapter and generated runtime bindings cover exactly 71 independently enumerated transfer slots", () => {
  const chapter = compile(), definitions = Object.fromEntries([...chapter.families.transfer!, ...chapter.families.immediate!]);
  const expected = [...[0x06, 0x0e, 0x16, 0x1e, 0x26, 0x2e, 0x36, 0x3e], ...Array.from({ length: 63 }, (_, index) => 0xc0 + index)];
  assert.deepEqual(Object.keys(definitions).map(Number), expected);
  assert.deepEqual(opcodeEntries(state()).map(([opcode]) => opcode).filter(opcode => expected.includes(opcode)), expected);
  const production = new Map(Object.entries(instructions8008));
  for (const opcode of expected) assert.deepEqual(definitions[opcode], production.get(String(opcode)));
  assert.equal(definitions[0xc1]!.name, "LAB");
  assert.equal(definitions[0xc8]!.name, "LBA");
  assert.equal(definitions[0xf8]!.name, "LMA");
  assert.equal(definitions[0x3e]!.name, "LMI n");
  assert.equal(definitions[0xff], undefined);
});

test("8008 bindings capture their own instance without reading state during binding", () => {
  const first = state(), second = state(); second.b = 0x42;
  let reads = 0;
  const observed = new Proxy(first, { get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver); } });
  const one = new Map(opcodeEntries(observed)), two = new Map(opcodeEntries(second));
  assert.equal(reads, 0);
  const forbidden = () => { throw new Error("Register transfer must not access memory or ports."); };
  const context = { fetchByte: forbidden, readByte: forbidden, writeByte: forbidden, readPort: forbidden, writePort: forbidden };
  one.get(0xc1)!(context); two.get(0xc1)!(context);
  assert.equal(first.a, 2); assert.equal(second.a, 0x42); assert.equal(reads, 1);
});

const invalid: readonly [string, string, string, RegExp][] = [
  ["duplicate selectors", "s in bytes", "d in bytes", /Duplicate selector/],
  ["missing selectors", "for d in bytes, s in bytes", "for d in bytes", /Selector s.*requires/],
  ["unknown selector catalogue", "s in bytes", "s in missing", /Unknown name missing/],
  ["extra selector", "s in bytes", "s in bytes, q in bytes", /Selector q.*absent/],
  ["unknown source operand", "result = operand s", "result = operand q", /Unknown name q/],
  ["unknown destination operand", "operand d <- result", "operand q <- result", /Unknown name q/],
  ["unknown name placeholder", 'named "L{d}{s}"', 'named "L{q}{s}"', /Unknown name placeholder/],
  ["unbalanced name template", 'named "L{d}{s}"', 'named "L{d}{s"', /Unknown name placeholder/],
  ["implicit multi-selector name", ' named "L{d}{s}"', "", /multi-selector family needs/],
  ["unrelated exclusion", 'except "11 111 111"', 'except "00 000 000"', /outside this family/],
  ["duplicate exclusion", 'except "11 111 111"', 'except "11 111 111", "11 111 111"', /Duplicate exclusion/],
  ["exclusion with a selector", 'except "11 111 111"', 'except "11 xxx ddd"', /Selector d.*requires/],
  ["empty family", 'except "11 111 111"', 'except "11 xxx xxx"', /at least one instruction/],
  ["memory address width", "return and(concat(high, low), u16($3FFF))", "return and(high, u8($3F))", /source result width does not match/],
  ["mismatched mask width", "u16($3FFF)", "u8($FF)", /equal widths|same width|expected 16-bit/],
];
for (const [name, before, after, message] of invalid) test(`8008 chapter rejects ${name} with a document diagnostic`, () => {
  assert.ok(markdown.includes(before));
  assert.throws(() => compile(markdown.replace(before, after)), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, file);
    assert.match(error.message, message); assert.ok(error.line > 1); return true;
  });
});

test("value-only destinations are rejected and a register has no address view", () => {
  const text = markdown.replace("operands bytes {", 'source immediateByte "immediate": 8 {\n  byte = fetch\n  return byte\n}\noperands bytes {')
    .replace('000 "A" = register A', '000 "A" = value immediateByte');
  assert.throws(() => compile(text), /value-only operand cannot be written/);
  const addressOnly = markdown.replace("for d in bytes, s in bytes", "for d in bytes.address, s in bytes")
    .replace("operand d <- result", "memory(d) <- result");
  // An address selector is a source: it still needs an explicit capture before use as a value.
  assert.throws(() => compile(addressOnly), /value d has not been captured/);
});

test("compiler-created address captures neither collide with authored names nor become visible to expressions", () => {
  const shadow = markdown.replace("  operand d <- result", "  destinationAddress0 = u8($12)\n  operand d <- destinationAddress0");
  assert.doesNotThrow(() => compile(shadow));
  const leaked = markdown.replace(/(\d{3} "[A-Z]" = )register [A-Z]/g, "$1memory throughHL")
    .replace("  operand d <- result", "  operand d <- result\n  leaked = destinationAddress0");
  assert.throws(() => compile(leaked), /value destinationAddress0 has not been captured/);
});

test("a formal address-mask edit changes generated execution while preserving the stored H byte", async () => {
  const definitions = Object.fromEntries(Object.values(compile(markdown.replace("u16($3FFF)", "u16($1FFF)")).families).flat());
  const source = generateInstructions("8008", { probe: definitions[0xc7]! });
  const javascript = stripTypeScriptTypes(source);
  const compiled: { instructions: { probe(state: Cpu8008StoredState, context: { readByte(address: number): number }): void } } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const registers = state(), addresses: number[] = [];
  compiled.instructions.probe(registers, { readByte(address) { addresses.push(address); return 0x42; } });
  assert.deepEqual(addresses, [0x1fff]); assert.equal(registers.a, 0x42); assert.equal(registers.h, 0xff);
});
