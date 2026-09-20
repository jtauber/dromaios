import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { instructions as actions, sourceReaders } from "../../../../src/components/cpus/generated/8008-state.js";
import type { Cpu8008StoredState } from "../../../../src/components/cpus/semantics/generated/state/8008.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";

const file = "src/components/cpus/specifications/8008.md", markdown = readFileSync(file, "utf8");
const compile = (text = markdown) => compileCpuChapter(text, { name: "8008" }, file);
const state = (): Cpu8008StoredState => ({ a: 1, b: 2, c: 3, d: 4, e: 5, h: 0xe6, l: 0x77,
  flags: { s: true, z: false, p: true, c: false }, addressStack: [0, 1, 2, 3, 4, 5, 6, 0x3fff], stackIndex: 7, halted: false });

test("8008 views bind without reading state and inspect only their named fields in declared order", () => {
  const events: string[] = [], stored = state();
  const observed = new Proxy(stored, {
    get(target, key, receiver) { events.push(String(key)); return Reflect.get(target, key, receiver); },
    set() { assert.fail("Views cannot write state"); },
  });
  const { PC, HL } = sourceReaders(observed).views;
  assert.deepEqual(events, []);
  assert.equal(PC(), 0x3fff); assert.deepEqual(events, ["stackIndex", "addressStack"]);
  events.length = 0;
  assert.equal(HL(), 0xe677); assert.deepEqual(events, ["h", "l"]);
  stored.stackIndex = 2; stored.addressStack[2] = 0x2345;
  assert.equal(PC(), 0x2345);
  stored.h = 0xff; stored.l = 0xff;
  assert.equal(HL(), 0xffff);
});

test("8008 generated PC writes cover every word and selector, wrapping only the selected slot", () => {
  for (let slot = 0; slot < 8; slot++) {
    const stored = state(), before = structuredClone(stored);
    stored.stackIndex = slot;
    const views = sourceReaders(stored).views;
    for (let address = 0; address <= 0xffff; address++) {
      actions.setPC(stored, address);
      assert.equal(views.PC(), address % 0x4000);
    }
    for (let other = 0; other < 8; other++) if (other !== slot) assert.equal(stored.addressStack[other], before.addressStack[other]);
    assert.deepEqual({ ...stored, stackIndex: before.stackIndex, addressStack: before.addressStack }, before);
  }
});

test("8008 generated HL views preserve all sixteen bits and leave storage unchanged", () => {
  const stored = state(), views = sourceReaders(stored).views;
  for (let word = 0; word <= 0xffff; word++) {
    stored.h = Math.floor(word / 256); stored.l = word % 256;
    assert.equal(views.HL(), word);
    assert.equal(stored.h, Math.floor(word / 256)); assert.equal(stored.l, word % 256);
  }
});

test("8008 reset writes each declared field in order without reading flags or array elements", () => {
  const stored = state(), events: string[] = [], slots = stored.addressStack;
  for (let index = 0; index < 8; index++) Object.defineProperty(slots, index, {
    get() { assert.fail("Reset cannot read old address slots"); },
    set(value: number) { events.push(`slot ${index} = ${value}`); },
  });
  const observed = new Proxy(stored, {
    get(target, key, receiver) {
      assert.equal(key, "addressStack"); events.push("read addressStack");
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value: unknown, receiver) {
      events.push(`${String(key)} = ${String(value)}`); return Reflect.set(target, key, value, receiver);
    },
  });
  actions.reset(observed);
  assert.deepEqual(events, ["a = 0", "b = 0", "c = 0", "d = 0", "e = 0", "h = 0", "l = 0", "read addressStack",
    ...Array.from({ length: 8 }, (_, index) => `slot ${index} = 0`), "stackIndex = 0", "halted = true"]);
});

test("8008 reset retains every flag combination for every selector and either stopped state", () => {
  for (let bits = 0; bits < 16; bits++) for (let slot = 0; slot < 8; slot++) for (const halted of [false, true]) {
    const stored = state(); stored.stackIndex = slot; stored.halted = halted;
    stored.flags = { s: Boolean(bits & 8), z: Boolean(bits & 4), p: Boolean(bits & 2), c: Boolean(bits & 1) };
    const flags = stored.flags, slots = stored.addressStack;
    actions.reset(stored);
    assert.deepEqual(stored, { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, flags,
      addressStack: Array(8).fill(0), stackIndex: 0, halted: true });
    assert.equal(stored.flags, flags); assert.equal(stored.addressStack, slots);
    actions.reset(stored); assert.deepEqual(sourceReaders(stored).views.PC(), 0);
  }
});

async function generated(text: string) {
  const chapter = compile(text);
  const source = generateInstructions("8008", chapter.actions, { sources: { cpu: { name: "8008", state: chapter.state! }, groups: { views: chapter.views } } });
  assert.doesNotMatch(source, /ByteInstructionContext|fetchByte|readByte|writeByte/);
  const result: { instructions: typeof actions; sourceReaders: typeof sourceReaders } =
    await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);
  return result;
}

test("formal edits change PC selection, HL order, PC writes, and reset without changes to the compiler", async () => {
  const edits = markdown.replace("address = array ADDRESS[slot]", "address = array ADDRESS[u3(0)]")
    .replace("return concat(high, low)", "return concat(low, high)")
    .replace("target = truncate(address, 14)", "target = u14($1234)")
    .replace("ADDRESS[] <- u14($0000)", "ADDRESS[] <- u14($1234)")
    .replace("  STOPPED <- 1", "  STOPPED <- 0");
  const modified = await generated(edits), stored = state();
  assert.equal(modified.sourceReaders(stored).views.PC(), 0);
  assert.equal(modified.sourceReaders(stored).views.HL(), 0x77e6);
  modified.instructions.setPC(stored, 0); assert.equal(stored.addressStack[7], 0x1234);
  modified.instructions.reset(stored); assert.deepEqual(stored.addressStack, Array(8).fill(0x1234));
  assert.equal(stored.halted, false);
});

const invalid: readonly [string, string, string, RegExp][] = [
  ["wrong result width", 'counter": 14', 'counter": 16', /source result width/],
  ["missing return", "return address", "address = u14(0)", /end with return/],
  ["lowercase view", "view PC", "view pc", /View names must be uppercase/],
  ["stored name collision", "view PC", "view A", /Duplicate declaration A/],
  ["view write", "  return address", "  SELECTOR <- u3(0)\n  return address", /Views may only read/],
  ["nested view write", "  return address", "  when 0 {\n    ADDRESS[] <- u14(0)\n  }\n  return address", /Views may only read/],
  ["view memory read", "  return address", "  byte = memory(u16(0))\n  return address", /cannot fetch/],
  ["action fetch", "  A <- u8($00)", "  byte = fetch\n  A <- byte", /cannot fetch/],
  ["action port", "  A <- u8($00)", "  byte = port(u16(0))\n  A <- byte", /cannot fetch/],
  ["action memory write", "  A <- u8($00)", "  memory(u16(0)) <- u8(0)", /cannot fetch/],
  ["duplicate input", "(address: 16)", "(address: 16, address: 8)", /Duplicate parameter/],
  ["uppercase input", "(address: 16)", "(ADDRESS: 16)", /invalid value name/],
  ["input shadowing", "target = truncate(address, 14)", "address = truncate(address, 14)", /duplicate capture address/],
  ["input escape", "  A <- u8($00)", "  A <- lowByte(address)", /has not been captured/],
  ["wrong fill width", "ADDRESS[] <- u14($0000)", "ADDRESS[] <- u16($0000)", /expected 14-bit/],
  ["non-array fill", "ADDRESS[] <- u14($0000)", "A[] <- u8($00)", /Unknown array A/],
];
for (const [name, before, after, message] of invalid) test(`8008 state operations reject ${name} at a Markdown location`, () => {
  assert.ok(markdown.includes(before));
  assert.throws(() => compile(markdown.replace(before, after)), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, file); assert.ok(error.line > 1);
    assert.match(error.message, message); return true;
  });
});

test("state effect restrictions follow reusable sources and report the invoking statement", () => {
  const source = 'source sideEffect "side effect": 14 {\n  A <- u8(0)\n  return u14(0)\n}\n';
  const text = markdown.replace('view PC "', source + 'view PC "').replace("address = array ADDRESS[slot]", "address = source sideEffect");
  const line = text.split("\n").findIndex(line => line.includes("address = source")) + 1;
  assert.throws(() => compile(text), (error: unknown) => error instanceof ChapterError && error.line === line && /Views may only read/.test(error.message));
  const external = text.replace("A <- u8(0)", "byte = fetch");
  assert.throws(() => compile(external), /cannot fetch/);
});

test("reset explanations expose every address slot and do not earn opcode coverage", () => {
  const chapter = compile();
  assert.deepEqual(Object.keys(chapter.actions), ["setPC", "reset", "resume"]);
  assert.deepEqual(Object.keys(chapter.views), ["PC", "HL"]);
  assert.equal(Object.values(chapter.families).flat().length, 250);
  assert.match(describeInstruction(chapter.actions.reset!), /fill all 8 ADDRESSSTACK elements:u14/);
});

test("views and actions work with different stored names, widths, and array lengths", async () => {
  const text = `\`\`\`cpu
cpu "6502"
state {
  register WORD: 16 = word
  array BANK: 8[3] = bank
  latch IDLE = idle
}
view LOW "low byte": 8 {
  original = register WORD
  return lowByte(original)
}
action initialize "initialize state" (byte: 8) {
  BANK[] <- byte
  WORD <- extend(byte, 16)
  IDLE <- 1
}
\`\`\``;
  const chapter = compileCpuChapter(text, { name: "6502" });
  const source = generateInstructions("6502", chapter.actions,
    { sources: { cpu: { name: "6502", state: chapter.state! }, groups: { views: chapter.views } } });
  type State = { word: number; bank: number[]; idle: boolean };
  const generated: { instructions: { initialize(state: State, byte: number): void }; sourceReaders(state: State): { views: { LOW(): number } } } =
    await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);
  const stored = { word: 0xabcd, bank: [1, 2, 3], idle: false };
  assert.equal(generated.sourceReaders(stored).views.LOW(), 0xcd);
  generated.instructions.initialize(stored, 0x42);
  assert.deepEqual(stored, { word: 0x42, bank: [0x42, 0x42, 0x42], idle: true });
});

test("state actions reject external effects hidden in sources or constant-false branches", () => {
  const source = 'source external "external": 8 {\n  byte = fetch\n  return byte\n}\n';
  const text = markdown.replace('action reset "', source + 'action reset "')
    .replace("  A <- u8($00)", "  when 0 {\n    byte = source external\n    A <- byte\n  }");
  const line = text.split("\n").findIndex(line => line.includes("byte = source external")) + 1;
  assert.throws(() => compile(text), (error: unknown) => error instanceof ChapterError && error.line === line && /cannot fetch/.test(error.message));
});
