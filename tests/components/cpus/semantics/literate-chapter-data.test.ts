import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { defineState, flag, group, unsigned } from "../../../../src/components/cpus/state.js";
import { literal, perform, readSource, updateFlags, value, writeRegister, zero } from "../../../../src/components/cpus/semantics/model.js";
import type { FlagPolicy, InstructionDefinition, ValueSource } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import type { CpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { generateChapterData } from "../../../../src/components/cpus/semantics/literate/chapter-data.js";

const cpu = { name: "probe", state: defineState({ a: unsigned(8), flags: group({ z: flag }) }) };
const register = { kind: "register", cpu: "probe", field: "a", width: 8 } as const;
const policy: FlagPolicy = { name: "zero", parameters: { result: 8 }, unlisted: "preserve",
  updates: [{ flag: { kind: "flag", cpu: "probe", field: "z" }, value: zero(value("result")) }] };
const source: ValueSource = { name: 'quoted "name"\nwith \\ and ${text}', width: 8, steps: [], result: literal(8, 1) };
const other: ValueSource = { ...source, result: literal(8, 2) };
const action = defineInstruction({ cpu, name: "store", explanation: "Store a captured byte.",
  inputs: { source: 8 }, steps: [writeRegister(register, value("source"))] });
const nested: ValueSource = { name: "nested", width: 8, inputs: { source: 8, policy: 8, action: 8, cpu: 8, state: 8 },
  steps: [readSource("left", source), readSource("right", other)], result: value("left") };
const definition = defineInstruction({ cpu, name: "copy", explanation: "Preserve scopes and named arguments.", steps: [
  readSource("byte", nested, { source: literal(8, 3), policy: literal(8, 4), action: literal(8, 5), cpu: literal(8, 6), state: literal(8, 7) }),
  updateFlags(policy, { result: value("byte") }), perform(action, { source: value("byte") }),
] });
const chapter: CpuChapter = { cpu: "probe", state: cpu.state, pages: {},
  sources: { source, other, nested }, views: { ALIAS: structuredClone(source) }, policies: { policy }, actions: { action },
  operands: { register: [{ kind: "view", name: "A", read: source, write: action }] }, conditions: {},
  families: { copy: [[0, definition], [1, structuredClone(definition)]] },
};

async function load(chapter: CpuChapter) {
  const source = generateChapterData(chapter);
  const code = stripTypeScriptTypes(source).replace('"../validate.ts"', JSON.stringify(
    new URL("../../../../src/components/cpus/semantics/validate.js", import.meta.url).href));
  const data: Omit<CpuChapter, "cpu" | "state" | "pages"> = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  return { data, source };
}

test("chapter data preserves nested semantics, aliases, quoted text, and argument names while sharing named blocks", async () => {
  const before = structuredClone(chapter), { data, source } = await load(chapter);
  for (const key of ["sources", "views", "policies", "actions", "operands", "conditions", "families"] as const) {
    assert.deepEqual(data[key], chapter[key], key);
    assert.deepEqual(Object.keys(data[key]), Object.keys(chapter[key]), `${key} declaration order`);
  }
  assert.deepEqual(chapter, before);
  assert.equal(generateChapterData(chapter), source);
  assert.equal(data.sources.source, data.views.ALIAS);
  assert.notEqual(data.sources.source, data.sources.other, "a shared name does not imply shared behavior");
  assert.equal(data.families.copy![0]![1], data.families.copy![1]![1]);
  const operand = data.operands.register![0]!;
  assert.ok(operand.kind === "view");
  assert.equal(operand.read, data.sources.source);
  assert.equal(operand.write, data.actions.action);
  assert.equal(Object.isFrozen(data.families.copy![0]![1].steps), true);
  assert.equal(source.match(/: StateFields =/g)?.length, 1);
  assert.equal(source.match(/: CpuDeclaration =/g)?.length, 1);
  assert.equal(source.match(/: ValueSource =/g)?.length, 3);
  assert.equal(source.match(/: FlagPolicy =/g)?.length, 1);
});

test("chapter data preserves distinct boundary capabilities and record keys without treating them as host syntax", async () => {
  const word = defineInstruction({ ...definition, cpu: { ...cpu, wordBoundary: true } });
  const fields = Object.fromEntries([["__proto__", source], ["constructor", other], ["quoted\"field", nested]]);
  const variant = { ...chapter, sources: fields, families: { byte: [[0, definition]], word: [[1, word]] } } satisfies CpuChapter;
  const { data } = await load(variant);
  assert.deepEqual(data.sources, fields);
  assert.equal(Object.getPrototypeOf(data.sources), Object.prototype);
  assert.equal(Object.hasOwn(data.sources, "__proto__"), true);
  assert.deepEqual(data.families.byte![0]![1].cpu, cpu);
  assert.deepEqual(data.families.word![0]![1].cpu, word.cpu);
});

test("serialized instruction bodies still pass through independent validation", async () => {
  const invalid: InstructionDefinition = { ...definition, steps: [writeRegister(register, value("missing"))] };
  await assert.rejects(() => load({ ...chapter, families: { invalid: [[0, invalid]] } }), /not been captured/);
});
