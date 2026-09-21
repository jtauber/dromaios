import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { choices, defineState, flag, group, readState, unsigned } from "../../../../src/components/cpus/state.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { generateChapterState } from "../../../../src/components/cpus/semantics/literate/state.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { readFlag } from "../../../../src/components/cpus/semantics/model.js";

const storage = `state {
  register A: 8
  flag C
  bank OTHER = shadow {
    register A: 8 = accumulator
    flag C = carry
  }
  choice MODE: 0, 1, 2 = mode
}`;
const compile = (body: string) => compileCpuChapter(`Bank and numeric-choice probe.\n\n\`\`\`cpu\ncpu "probe"\n${body}\n\`\`\``, {}, "banks.md");
const state = () => ({ a: 0x12, flags: { c: false }, shadow: { accumulator: 0x34, flags: { carry: true } }, mode: 0 });
type State = ReturnType<typeof state>;
async function instructions<S = State>(body: string): Promise<Record<string, (state: S) => void>> {
  const chapter = compile(body), source = generateInstructions("probe", chapter.actions);
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  return (await import(`data:text/javascript,${encodeURIComponent(javascript)}`)).instructions;
}

test("banked state and numeric choices generate independent, validated storage", async () => {
  const chapter = compile(storage);
  const expected = defineState({ a: unsigned(8), flags: group({ c: flag }),
    shadow: group({ accumulator: unsigned(8), flags: group({ carry: flag }) }), mode: choices(0, 1, 2) });
  assert.deepEqual(chapter.state, expected);
  const source = stripTypeScriptTypes(generateChapterState(chapter.state!)).replace('"../../../state.ts"',
    JSON.stringify(new URL("../../../../src/components/cpus/state.js", import.meta.url).href));
  const generated = (await import(`data:text/javascript,${encodeURIComponent(source)}`)).state;
  assert.deepEqual(generated, expected);
  const original = state(), copy = readState(expected, original);
  assert.deepEqual(copy, original); assert.notEqual(copy.shadow, original.shadow);
  assert.notEqual(copy.shadow.flags, original.shadow.flags); assert.notEqual(copy.flags, original.flags);
  copy.shadow.accumulator = 0xff; copy.shadow.flags.carry = false;
  assert.equal(original.shadow.accumulator, 0x34); assert.equal(original.shadow.flags.carry, true);
  for (const mode of [0, 1, 2]) assert.doesNotThrow(() => readState(expected, { ...original, mode }));
  for (const mode of [-1, 3, 0.5, "0", false]) assert.throws(() => readState(expected, { ...original, mode }), /mode/);
  assert.throws(() => readState(expected, { ...original, shadow: { ...original.shadow, accumulator: 256 } }), /shadow.accumulator/);
  assert.throws(() => readState(expected, { ...original, shadow: { ...original.shadow, flags: { carry: 1 } } }), /shadow.flags.carry/);
});

const actions = `
policy SWAP "swap captured carries" (main: flag, other: flag) {
  C = other
  OTHER.C = main
}
policy OTHERFLAGS "replace the other carry" (carry: flag) {
  OTHER.C = carry
}
action exchange "read and update both banks" {
  main = register A
  other = register OTHER.A
  mainCarry = flag C
  otherCarry = flag OTHER.C
  apply SWAP(mainCarry, otherCarry)
  A <- other
  OTHER.A <- main
}
action replaceOther "replace only the other flags" {
  carry = flag C
  replace OTHERFLAGS(carry)
}
action choose "numeric choices are values, not strings" {
  MODE <- 2
  selected = choice MODE = 2
  when selected {
    A <- u8($80)
  }
}`;

test("qualified registers and flags preserve independent banks, captured updates, and replacement ownership", async () => {
  const generated = await instructions(storage + actions), current = state(), main = current.flags, other = current.shadow.flags;
  generated.exchange!(current);
  assert.deepEqual(current, { a: 0x34, flags: { c: true }, shadow: { accumulator: 0x12, flags: { carry: false } }, mode: 0 });
  assert.equal(current.flags, main); assert.equal(current.shadow.flags, other);
  generated.replaceOther!(current);
  assert.equal(current.flags, main); assert.notEqual(current.shadow.flags, other);
  assert.deepEqual(current.shadow.flags, { carry: true }); assert.deepEqual(other, { carry: false });
  generated.choose!(current); assert.equal(current.mode, 2); assert.equal(current.a, 0x80);
  const description = describeInstruction(compile(storage + actions).actions.exchange!);
  assert.match(description, /SHADOW.ACCUMULATOR/); assert.match(description, /SHADOW.CARRY/);
});

const invalid: readonly [string, string, RegExp][] = [
  ["lowercase bank", storage.replace("bank OTHER", "bank other"), /Bank names must be uppercase/],
  ["missing bank flags", storage.replace("    flag C = carry\n", ""), /own flags/],
  ["nested bank", storage.replace("    register A: 8 = accumulator", "    bank INNER {\n      flag C\n    }"), /contain only/],
  ["bank latch", storage.replace("    register A: 8 = accumulator", "    latch WAIT"), /Banks contain only/],
  ["bank control choice", storage.replace("    register A: 8 = accumulator", "    choice MODE: 0, 1"), /Banks contain only/],
  ["duplicate bank field", storage.replace("  choice MODE: 0, 1, 2 = mode", "  register SHADOW: 8"), /Duplicate stored field shadow/],
  ["duplicate bank member", storage.replace("    flag C = carry", "    register B: 8 = accumulator\n    flag C = carry"), /Duplicate stored field accumulator/],
  ["mixed choice kinds", storage.replace("0, 1, 2", '0, "one"'), /cannot mix/],
  ["duplicate numeric choice", storage.replace("0, 1, 2", "0, 1, 1"), /distinct/],
  ["unsafe numeric choice", storage.replace("0, 1, 2", "9007199254740992"), /integer from 0/],
  ["unknown bank reference", storage + '\naction read "read" {\n value = register MISSING.A\n}', /Unknown name MISSING.A/],
  ["unknown bank flag", storage + '\npolicy bad "bad" () {\n OTHER.Z = 1\n}', /Unknown name OTHER.Z/],
  ["duplicate qualified flag", storage + '\npolicy bad "bad" () {\n OTHER.C = 1\n OTHER.C = 0\n}', /Duplicate update/],
  ["mixed replacement", storage + '\npolicy bad "bad" () {\n C = 0\n OTHER.C = 1\n}\naction badAction "bad" {\n replace bad()\n}', /single bank/],
  ["string written to numeric choice", storage + '\naction bad "bad" {\n MODE <- "2"\n}', /choice/],
  ["unknown numeric choice", storage + '\naction bad "bad" {\n MODE <- 3\n}', /choice/],
  ["string test of numeric choice", storage + '\naction bad "bad" {\n value = choice MODE = "2"\n}', /choice/],
];
for (const [name, text, message] of invalid) test(`bank/choice authoring rejects ${name} at a Markdown location`, () => {
  assert.throws(() => compile(text), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, "banks.md"); assert.match(error.message, message); return true;
  });
});

test("the IR rejects a flag from an undeclared bank rather than treating it as a main flag", () => {
  assert.throws(() => defineInstruction({ cpu: { name: "probe", state: compile(storage).state! }, name: "invalid", explanation: "",
    steps: [readFlag("carry", { kind: "flag", cpu: "probe", bank: "missing", field: "c" })] }), /unknown register bank/);
});

const exchangeStorage = storage.replace("  flag C\n", "  flag C = carry\n");
const exchangeAction = '\naction swapFlags "exchange whole objects" {\n  exchange FLAGS, OTHER.FLAGS\n}';

test("flag-group exchange preserves object identity and ordered reads/writes, including partial failure", async () => {
  type Flags = { carry: boolean };
  type Banks = { flags: Flags; shadow: { flags: Flags } };
  const generated = await instructions<Banks>(exchangeStorage + exchangeAction);
  for (const failAt of [-1, 0, 1, 2, 3]) {
    const events: string[] = [], failure = new Error("flag-group access");
    const main = new Proxy({ carry: false }, { get() { assert.fail("No individual flag reads"); } });
    const other = new Proxy({ carry: true }, { get() { assert.fail("No individual flag reads"); } });
    const state: Banks = { flags: main, shadow: { flags: other } };
    const access = (name: string) => { events.push(name); if (events.length - 1 === failAt) throw failure; };
    const shadow = new Proxy(state.shadow, {
      get(target, key, receiver) { access("read other"); return Reflect.get(target, key, receiver); },
      set(target, key, value) { access("write other"); return Reflect.set(target, key, value); },
    });
    const observed = new Proxy(state, {
      get(target, key, receiver) { if (key === "shadow") return shadow; access("read main"); return Reflect.get(target, key, receiver); },
      set(target, key, value) { access("write main"); return Reflect.set(target, key, value); },
    });
    const run = () => generated.swapFlags!(observed);
    if (failAt < 0) run(); else assert.throws(run, error => error === failure);
    assert.deepEqual(events, ["read other", "read main", "write main", "write other"].slice(0, failAt < 0 ? 4 : failAt + 1));
    assert.equal(state.flags, failAt < 0 || failAt === 3 ? other : main);
    assert.equal(state.shadow.flags, failAt < 0 ? main : other);
  }
  assert.match(describeInstruction(compile(exchangeStorage + exchangeAction).actions.swapFlags!), /exchange/i);
});

test("flag-group exchange requires matching layouts and cannot mutate a read-only view", () => {
  assert.throws(() => compile(storage + exchangeAction), /matching|same|identical/i);
  assert.throws(() => compile(exchangeStorage + exchangeAction.replace("OTHER.FLAGS", "MISSING.FLAGS")), /Unknown name MISSING.FLAGS/);
  assert.throws(() => compile(exchangeStorage + exchangeAction.replace("FLAGS,", "A,")), /Unknown name A/);
  assert.throws(() => compile(exchangeStorage + '\nview BAD "not a view": 8 {\n exchange FLAGS, OTHER.FLAGS\n return u8(0)\n}'), /read|view/i);
});

test("exchange remains a valid capture name beside the flag-group statement", async () => {
  const generated = await instructions(exchangeStorage + '\naction capture "a value called exchange" {\n exchange = u8($42)\n A <- exchange\n}');
  const current = state(); generated.capture!(current); assert.equal(current.a, 0x42);
});
