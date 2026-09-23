import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { checkByteExecution } from "../../../../src/components/cpus/semantics/literate/execution.js";
import { checkSegmentedEffects } from "../../../../src/components/cpus/semantics/literate/segmented-execution.js";
import { usesMemory } from "../../../../src/components/cpus/semantics/literate/statements.js";

const text = `A conditional view reads exactly its selected storage.

\`\`\`cpu
cpu "probe"
state {
  register A: 8
  register B: 8
  register RESULT: 8
  flag S
}
view ACTIVE "selected byte" : 8 {
  selected = flag S
  contents = choose selected : 8 {
    then {
      original = register A
      return original
    }
    else {
      original = register B
      return original
    }
  }
  return contents
}
family copy "00000000" {
  contents = source ACTIVE
  RESULT <- contents
}
\`\`\``;
const compile = (source = text) => compileCpuChapter(source, {}, "choose.md");

test("conditional views read only the selected branch, keep local captures, and retain failed effects", async () => {
  const definition = compile().families.copy![0]![1];
  const source = stripTypeScriptTypes(generateInstructions("probe", { copy: definition }));
  const { instructions }: { instructions: { copy(state: { a: number; b: number; result: number; flags: { s: boolean } }): void } } =
    await import(`data:text/javascript,${encodeURIComponent(source)}`);
  for (const selected of [false, true]) for (const fail of [false, true]) {
    const events: string[] = [], failure = Error("selected read failed");
    const state = { a: 17, b: 29, result: 0, flags: { s: selected } };
    const observed = new Proxy(state, { get(target, key, receiver) {
      if (key === "a" || key === "b") {
        events.push(key); assert.equal(key, selected ? "a" : "b");
        state.flags.s = !state.flags.s; // The choice remains captured.
        if (fail) throw failure;
      }
      return Reflect.get(target, key, receiver);
    } });
    if (fail) assert.throws(() => instructions.copy(observed), error => error === failure);
    else instructions.copy(observed);
    assert.deepEqual(events, [selected ? "a" : "b"]);
    assert.equal(state.result, fail ? 0 : selected ? 17 : 29);
  }
  const description = describeInstruction(definition);
  assert.match(description, /choose selected/); assert.match(description, /then \{/); assert.match(description, /else \{/);
  assert.doesNotMatch(description, /unsupported/);
});

const invalid: readonly [string, string, string, RegExp][] = [
  ["numeric condition", "choose selected", "choose u8(1)", /flag|Boolean/],
  ["mismatched branch width", "return original", "return u16(1)", /result width/],
  ["unselected branch width", "original = register B", "original = u16(0)", /result width/],
  ["branch scope leak", "return contents", "return original", /not been captured/],
  ["capture before assignment", "original = register A", "original = contents", /not been captured/],
  ["missing result", "return original", "A <- u8(1)", /end with return/],
  ["missing alternative", "else {", "then {", /Expected "else"/],
  ["duplicate outer capture", "contents = choose", "selected = choose", /duplicate capture/],
  ["state write in a view", "original = register B", "B <- u8(0)\n      original = register B", /only read stored state/],
  ["memory hidden in a view", "original = register B", "original = memory(u16(0))", /without using memory/],
];
for (const [name, before, after, error] of invalid) test(`conditional values reject ${name}`, () => {
  assert.throws(() => compile(text.replace(before, after)), error);
});

test("conditional effects expose memory needs and recheck both branches at execution boundaries", () => {
  const source = text.replace('view ACTIVE "selected byte"', 'source ACTIVE "selected byte"')
    .replace("original = register B", "original = memory(u16(0))");
  const definition = compile(source).families.copy![0]![1];
  assert.equal(usesMemory(definition.steps), true);
  assert.doesNotThrow(() => checkByteExecution(definition.steps));
  assert.throws(() => checkSegmentedEffects(definition.steps, "", true), /read-memory/);
  const native = compile(source.replace('cpu "probe"', 'cpu "68000" boundary word').replace("original = memory(u16(0))", "address = resolve(16, u3(2), u3(0))\n      original = u8(0)")).families.copy![0]![1];
  assert.throws(() => checkByteExecution(native.steps), /resolve-address/);
  assert.throws(() => checkSegmentedEffects(native.steps, ""), /resolve-address/);
  const hidden = source.replace("family copy", 'view HIDDEN "transitive view" : 8 {\n  byte = source ACTIVE\n  return byte\n}\nfamily copy');
  assert.throws(() => compile(hidden), /without using memory/);
});
