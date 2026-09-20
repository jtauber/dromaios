import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { instructions as actions, sourceReaders } from "../../../../src/components/cpus/generated/8080-state.js";
import { instructions8080 } from "../../../../src/components/cpus/semantics/definitions.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import type { Cpu8080State } from "../../../../src/components/cpus/state/8080.js";

const file = "src/components/cpus/specifications/8080.md", markdown = readFileSync(file, "utf8");
const state = (): Cpu8080State => ({ a: 0x81, b: 0x12, c: 0x34, d: 0x56, e: 0x78, h: 0xab, l: 0xcd,
  pc: 0xffff, sp: 0, flags: { s: true, z: false, ac: true, p: false, cy: true },
  interruptEnabled: true, interruptDeferred: true, halted: true });

test("the 8080 chapter owns exactly 167 documented encodings in the production catalogue", () => {
  const chapter = compileCpuChapter(markdown, { name: "8080" }, file);
  const definitions = Object.fromEntries(Object.values(chapter.families).flat());
  const expected = [
    ...Array.from({ length: 64 }, (_, i) => 0x40 + i).filter(opcode => opcode !== 0x76),
    ...Array.from({ length: 64 }, (_, i) => 0x80 + i),
    ...Array.from({ length: 8 }, (_, i) => [0x04 + 8 * i, 0x05 + 8 * i, 0x06 + 8 * i, 0xc6 + 8 * i]).flat(),
    0x07, 0x0f, 0x17, 0x1f, 0xd3, 0xdb, 0xf3, 0xfb,
  ].sort((a, b) => a - b);
  assert.equal(expected.length, 167);
  assert.deepEqual(Object.keys(definitions).map(Number).sort((a, b) => a - b), expected);
  for (const opcode of expected) assert.deepEqual(instructions8080[opcode], definitions[opcode], `Chapter form ${opcode.toString(16)} must reach production unchanged`);
  const undocumented = [0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38, 0xcb, 0xd9, 0xdd, 0xed, 0xfd];
  assert.deepEqual(Object.keys(instructions8080).map(Number).sort((a, b) => a - b),
    Array.from({ length: 256 }, (_, i) => i).filter(opcode => !undocumented.includes(opcode)));
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
