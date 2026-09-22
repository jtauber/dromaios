import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { instructions as actions, sourceReaders } from "../../../../src/components/cpus/generated/8080-state.js";
import { instructions as instructions8080 } from "../../../../src/components/cpus/semantics/generated/8080.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import type { Cpu8080State } from "../../../../src/components/cpus/semantics/generated/state/8080.js";

const file = "src/components/cpus/specifications/8080.md", markdown = readFileSync(file, "utf8");
const state = (): Cpu8080State => ({ a: 0x81, b: 0x12, c: 0x34, d: 0x56, e: 0x78, h: 0xab, l: 0xcd,
  pc: 0xffff, sp: 0, flags: { s: true, z: false, ac: true, p: false, cy: true },
  interruptEnabled: true, interruptDeferred: true, halted: true });

test("the 8080 chapter owns all 244 documented encodings in the production catalogue", () => {
  const chapter = compileCpuChapter(markdown, { name: "8080" }, file);
  const definitions = Object.fromEntries(Object.values(chapter.families).flat());
  const undocumented = [0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38, 0xcb, 0xd9, 0xdd, 0xed, 0xfd];
  const expected = Array.from({ length: 256 }, (_, i) => i).filter(opcode => !undocumented.includes(opcode));
  assert.equal(expected.length, 244);
  assert.deepEqual(Object.keys(definitions).map(Number).sort((a, b) => a - b), expected);
  assert.deepEqual(instructions8080, definitions, "Every production definition comes directly from the chapter");
});

test("8080 chapter views read live high/low bytes once and counter writes touch only PC", () => {
  const stored = state(), events: string[] = [];
  const observed = new Proxy(stored, {
    get(target, key, receiver) { events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver); },
    set(target, key, contents) { events.push(`write ${String(key)}`); return Reflect.set(target, key, contents); },
  });
  const views = sourceReaders(observed).views;
  assert.deepEqual(events, []);
  for (const [name, high, low, word] of [["BC", "b", "c", 0x1234], ["DE", "d", "e", 0x5678], ["HL", "h", "l", 0xabcd]] as const) {
    events.length = 0; assert.equal(views[name](), word); assert.deepEqual(events, [`read ${high}`, `read ${low}`]);
  }
  stored.h = stored.l = 0xff; assert.equal(views.HL(), 0xffff);
  for (const address of [0, 0x7fff, 0x8000, 0xffff]) {
    events.length = 0; actions.setPC(observed, address);
    assert.equal(views.NEXT(), address); assert.deepEqual(events, ["write pc", "read pc"]);
  }
});

test("8080 reset and acceptance actions preserve data without reading old state", () => {
  for (const [action, writes] of [[actions.reset, ["pc", "interruptEnabled", "interruptDeferred", "halted"]],
    [actions.accept, ["interruptEnabled", "interruptDeferred", "halted"]]] as const) {
    const stored = state(), before = structuredClone(stored), events: string[] = [];
    action(new Proxy(stored, {
      get() { assert.fail("These actions do not read old state"); },
      set(target, key, contents) { events.push(String(key)); return Reflect.set(target, key, contents); },
    }));
    assert.deepEqual(events, writes);
    assert.deepEqual(stored, { ...before, ...(action === actions.reset ? { pc: 0 } : {}),
      interruptEnabled: false, interruptDeferred: false, halted: false });
  }
});

for (const [before, after, message] of [
  ["halfCarry(left, right)", "halfCarry(left, u16(1))", /equal widths/],
  ["halfBorrow(left, right)", "halfBorrow(u3(0), u3(1))", /arithmetic/],
  ["halfCarry(left, right, carry)", "halfCarry(left, right, left)", /flag/],
] as const) test(`8080 auxiliary carry expressions reject ${after}`, () => {
  assert.throws(() => compileCpuChapter(markdown.replace(before, after), { name: "8080" }, file),
    error => error instanceof ChapterError && error.file === file && error.line > 0 && message.test(error.message));
});

for (const [before, after, message] of [
  ["pair B C", "pair SP C", /two byte registers/],
  ["pair B C", "pair B UNKNOWN", /Unknown name UNKNOWN/],
  ["operand p <- add(original, u16(1))", "operand p <- u8(1)", /16-bit|word/],
  ["replace PSW(lowByte(result))", "replace CARRY(1)", /every stored flag/],
  ["select(sign, u8($80), u8(0))", "select(accumulator, u8($80), u8(0))", /flag accumulator/],
  ["select(sign, u8($80), u8(0))", "select(sign, u16($80), u8(0))", /equal widths|same width/],
  ["or(not(borrow(original, u8($9a))), carry)", "or(original, carry)", /flag original/],
] as const) test(`8080 word/status syntax rejects ${after}`, () => {
  assert.ok(markdown.includes(before));
  const line = markdown.slice(0, markdown.indexOf(before)).split("\n").length;
  assert.throws(() => compileCpuChapter(markdown.replace(before, after), { name: "8080" }, file), error => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, file);
    assert.equal(error.line, line); assert.match(error.message, message); return true;
  });
});

async function probes(text: string, opcodes: readonly number[]) {
  const chapter = compileCpuChapter(text, { name: "8080" }, file);
  const definitions = Object.fromEntries(Object.values(chapter.families).flat());
  const source = generateInstructions("8080", Object.fromEntries(opcodes.map(opcode => [opcode, definitions[opcode]!])));
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const generated: { instructions: Record<number, (state: Cpu8080State, context: { fetchByte(): number }) => void> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return generated.instructions;
}

test("editing a pair declaration changes both reads and writes without changing stored state", async () => {
  const execute = await probes(markdown.replace("pair B C", "pair C B"), [0x01, 0x03]);
  const stored = state(), events: string[] = [];
  const observed = new Proxy(stored, {
    get(target, key, receiver) { events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver); },
    set(target, key, contents) { events.push(`write ${String(key)}`); return Reflect.set(target, key, contents); },
  });
  const bytes = [0xff, 0x7f];
  execute[0x01]!(observed, { fetchByte: () => bytes.shift()! });
  assert.deepEqual([stored.b, stored.c], [0xff, 0x7f]);
  assert.deepEqual(events, ["write c", "write b"]);
  events.length = 0;
  execute[0x03]!(observed, { fetchByte: () => assert.fail("INX does not fetch operands") });
  assert.deepEqual([stored.b, stored.c], [0, 0x80]);
  assert.deepEqual(events, ["read c", "read b", "write c", "write b"]);
});

test("decimal predicates, conditional values, and flag replacement come from the chapter", async () => {
  const execute = await probes(markdown.replace("u8($60), u8(0)", "u8($20), u8(0)"), [0x27]);
  const stored = state(); stored.a = 0x9b; stored.flags.ac = stored.flags.cy = false;
  const originalFlags = stored.flags, before = { ...originalFlags };
  execute[0x27]!(stored, { fetchByte: () => assert.fail("DAA has no operands") });
  assert.equal(stored.a, 0xc1);
  assert.deepEqual(stored.flags, { s: true, z: false, p: false, ac: true, cy: true });
  assert.notEqual(stored.flags, originalFlags); assert.deepEqual(originalFlags, before);
});
