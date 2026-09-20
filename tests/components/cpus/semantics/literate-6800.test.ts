import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { boolean, defineState, flag, group, unsigned } from "../../../../src/components/cpus/state.js";
import { cpu6800StateDescription } from "../../../../src/components/cpus/state/6800.js";
import type { Cpu6800State } from "../../../../src/components/cpus/state/6800.js";
import { chapter6800 } from "../../../../src/components/cpus/semantics/definitions/6800.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

const file = "src/components/cpus/specifications/6800.md", markdown = readFileSync(file, "utf8");
const chapter = compileCpuChapter(markdown, { name: "6800" }, file);
const state = (): Cpu6800State => ({ a: 0x55, b: 0xaa, x: 0xfff0, sp: 0xffff, pc: 0x200, waiting: false,
  flags: { h: true, i: false, n: true, z: true, v: true, c: true } });
interface Context { fetchByte(): number; readByte(address: number): number; writeByte(address: number, byte: number): void }
const unexpected = (): never => { throw new Error("Unexpected access"); };

async function bodies(text: string) {
  const compiled = compileCpuChapter(text, { name: "6800" }, file);
  const definitions = Object.fromEntries(Object.values(compiled.families).flat());
  const source = generateInstructions("6800", definitions);
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const module: { instructions: Record<number, (state: Cpu6800State, context: Context) => void> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return module.instructions;
}

test("the 6800 chapter owns the complete stored schema and exactly the migrated manufacturer encodings", () => {
  const expected = defineState({ a: unsigned(8), b: unsigned(8), x: unsigned(16), sp: unsigned(16), pc: unsigned(16),
    flags: group({ h: flag, i: flag, n: flag, z: flag, v: flag, c: flag }), waiting: boolean });
  assert.deepEqual(chapter.state, expected); assert.deepEqual(cpu6800StateDescription, expected);
  assert.deepEqual(Object.keys(cpu6800StateDescription), Object.keys(expected));
  // Literal documented opcodes, independent of chapter selectors and shared Motorola builders.
  const opcodes = [0x06, 0x07, 0x11, 0x16, 0x17,
    0x81, 0x84, 0x85, 0x86, 0x88, 0x8a, 0x8c, 0x8e,
    0x91, 0x94, 0x95, 0x96, 0x97, 0x98, 0x9a, 0x9c, 0x9e, 0x9f,
    0xa1, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xaa, 0xac, 0xae, 0xaf,
    0xb1, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xba, 0xbc, 0xbe, 0xbf,
    0xc1, 0xc4, 0xc5, 0xc6, 0xc8, 0xca, 0xce,
    0xd1, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xda, 0xde, 0xdf,
    0xe1, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xea, 0xee, 0xef,
    0xf1, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xfa, 0xfe, 0xff];
  assert.equal(opcodes.length, 77);
  assert.deepEqual(Object.keys(chapter6800).map(Number).sort((a, b) => a - b), opcodes);
  assert.deepEqual(Object.fromEntries(Object.values(chapter.families).flat()), chapter6800);
  assert.equal(chapter.execution, undefined, "execution and WAI remain owned by the core");
});

test("unsigned indexing and high-first words are chapter rules, with complete addressing before register reads", async () => {
  for (const signed of [false, true]) {
    const execute = await bodies(signed ? markdown.replace("add(index, extend(offset, 16))", "add(index, signExtend(offset, 16))") : markdown);
    const current = state(), reads: number[] = [];
    execute[0xae]!(current, { fetchByte: () => 0x80, writeByte: unexpected,
      readByte(address) { reads.push(address); current.x = 0x1234; return reads.length === 1 ? 0x80 : 0; } });
    assert.deepEqual(reads, signed ? [0xff70, 0xff71] : [0x70, 0x71]);
    assert.equal(current.sp, 0x8000); assert.equal(current.x, 0x1234);
    assert.deepEqual(current.flags, { ...state().flags, n: true, z: false, v: false });
  }
  for (const reversed of [false, true]) {
    const execute = await bodies(reversed ? markdown.replaceAll("return concat(high, low)", "return concat(low, high)") : markdown);
    const current = state(), bytes = [0x12, 0x34];
    execute[0xce]!(current, { fetchByte: () => bytes.shift()!, readByte: unexpected, writeByte: unexpected });
    assert.equal(current.x, reversed ? 0x3412 : 0x1234);
  }
});

test("word stores capture after indexing, wrap at FFFF, and preserve flags on either failed write", async () => {
  const execute = await bodies(markdown);
  for (const failAt of [-1, 0, 1]) {
    const current = state(), writes: number[][] = [], failure = new Error("write failed");
    current.x = 0xff80;
    const before = structuredClone(current.flags);
    const run = () => execute[0xef]!(current, { fetchByte: () => 0x7f, readByte: unexpected,
      writeByte(address, byte) {
        const index = writes.length; writes.push([address, byte]);
        assert.deepEqual(current.flags, before);
        if (index === failAt) throw failure;
        current.x = 0x1234; // The second write must still use the captured X.
      } });
    if (failAt < 0) run(); else assert.throws(run, error => error === failure);
    assert.deepEqual(writes, [[0xffff, 0xff], [0, 0x80]].slice(0, failAt === 0 ? 1 : 2));
    assert.equal(current.x, failAt === 0 ? 0xff80 : 0x1234);
    assert.deepEqual(current.flags, failAt < 0 ? { ...before, n: true, z: false, v: false } : before);
  }
});

test("original-6800 CPX ignores low-byte borrow for N/V and its policy can be edited independently", async () => {
  for (const wholeWord of [false, true]) {
    const execute = await bodies(wholeWord ? markdown.replace("negative(subtract(highByte(left), highByte(right)))", "negative(result)") : markdown);
    const current = state(), bytes = [0x12, 1]; current.x = 0x1200;
    execute[0x8c]!(current, { fetchByte: () => bytes.shift()!, readByte: unexpected, writeByte: unexpected });
    assert.deepEqual(current.flags, { ...state().flags, n: wholeWord, z: false, v: false });
    assert.equal(current.x, 0x1200);
  }
});

test("condition-code transfers obey the chapter's fixed bits, restore every flag, and preserve other state", async () => {
  const execute = await bodies(markdown);
  for (let byte = 0; byte < 256; byte++) {
    const current = state(); current.a = byte;
    const before = structuredClone(current), flags = current.flags;
    const context = { fetchByte: unexpected, readByte: unexpected, writeByte: unexpected };
    execute[0x06]!(current, context);
    assert.notEqual(current.flags, flags);
    assert.deepEqual(current, { ...before, flags: { h: !!(byte & 32), i: !!(byte & 16), n: !!(byte & 8),
      z: !!(byte & 4), v: !!(byte & 2), c: !!(byte & 1) } });
    execute[0x07]!(current, context);
    assert.equal(current.a, byte | 0xc0);
  }
});

test("6800 declaration errors retain their Markdown locations", () => {
  for (const [before, after, message] of [
    ["register B: 8", "register B: 8 = a", /Duplicate stored field/],
    ["apply NZV16(result)", "apply NZV8(result)", /8-bit|u8|width/],
    ["replace CCFLAGS(status)", "replace NZV8(status)", /Unknown name NZV8/],
  ] as const) {
    assert.ok(markdown.includes(before));
    const line = markdown.slice(0, markdown.indexOf(before)).split("\n").length;
    assert.throws(() => compileCpuChapter(markdown.replace(before, after), { name: "6800" }, file), (error: unknown) => {
      assert.ok(error instanceof ChapterError); assert.equal(error.file, file); assert.equal(error.line, line);
      assert.match(error.message, message); return true;
    });
  }
});
