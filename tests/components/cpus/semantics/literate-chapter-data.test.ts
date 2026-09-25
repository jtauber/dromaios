import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { defineState, flag, group, unsigned } from "../../../../src/components/cpus/state.js";
import { literal, perform, readSource, updateFlags, value, writeRegister, zero } from "../../../../src/components/cpus/semantics/model.js";
import type { FlagPolicy, InstructionDefinition, ValueSource } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction, ownData } from "../../../../src/components/cpus/semantics/validate.js";
import type { CpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { generateChapterData } from "../../../../src/components/cpus/semantics/literate/chapter-data.js";

const cpu = { name: "probe", state: defineState({ a: unsigned(8), flags: group({ z: flag }) }) };
const register = { kind: "register", cpu: "probe", field: "a", width: 8 } as const;
const policy: FlagPolicy = { name: "zero", parameters: { result: 8 }, unlisted: "preserve",
  updates: [{ flag: { kind: "flag", cpu: "probe", field: "z" }, value: zero(value("result")) }] };
const source: ValueSource = { name: 'quoted "name"\nwith \\ and ${text}', type: 8, steps: [], result: literal(8, 1) };
const other: ValueSource = { ...source, result: literal(8, 2) };
const action = defineInstruction({ cpu, name: "store", explanation: "Store a captured byte.",
  inputs: { source: 8 }, steps: [writeRegister(register, value("source"))] });
const nested: ValueSource = { name: "nested", type: 8, inputs: { source: 8, policy: 8, action: 8, cpu: 8, state: 8 },
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
  assert.equal(source.match(/ownData<StateFields>/g)?.length, 1);
  assert.equal(source.match(/ownData<CpuDeclaration>/g)?.length, 1);
  assert.equal(source.match(/ownData<ValueSource>/g)?.length, 3);
  assert.equal(source.match(/ownData<FlagPolicy>/g)?.length, 1);
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
  assert.notEqual(data.families.byte![0]![1].cpu, data.families.word![0]![1].cpu);
  assert.equal(data.families.byte![0]![1].cpu.state, data.families.word![0]![1].cpu.state);
});

test("loaded definitions retain shared immutable sources, policies, CPU declarations, and composed actions", async () => {
  const second = defineInstruction({ ...definition, name: "second" });
  const { data } = await load({ ...chapter, families: { first: [[0, definition]], second: [[1, second]] } });
  const first = data.families.first![0]![1], next = data.families.second![0]![1];
  assert.notEqual(first, next);
  assert.equal(first.cpu, next.cpu);
  assert.equal(first.cpu, data.actions.action!.cpu);
  const [read, update, perform] = first.steps, otherAction = next.steps[2];
  assert.ok(read?.kind === "read-source" && update?.kind === "update-flags" && perform?.kind === "perform" && otherAction?.kind === "perform");
  assert.equal(read.source, data.sources.nested);
  assert.equal(update.policy, data.policies.policy);
  assert.equal(perform.action, otherAction.action);
  const [left, right] = read.source.steps;
  assert.ok(left?.kind === "read-source" && right?.kind === "read-source");
  assert.equal(left.source, data.sources.source);
  assert.equal(right.source, data.sources.other);
  for (const owned of [first.cpu, first.cpu.state, read.source, read.source.steps, read.source.result,
    update.policy, update.policy.updates, perform.action, perform.action.steps]) {
    assert.ok(Object.isFrozen(owned));
    assert.throws(() => Object.assign(owned, { changed: true }), TypeError);
  }
  for (const owned of [first.cpu, first.cpu.state, read.source, update.policy, perform.action]) {
    assert.equal(ownData(owned), owned, "generated constants remain recognized at later ownership boundaries");
  }
});

test("chapter data sharing ignores object identity but preserves field order", async () => {
  // JSON round-tripping duplicates every reference, including repeated dependencies.
  const copied: CpuChapter = JSON.parse(JSON.stringify(chapter));
  assert.equal(generateChapterData(copied), generateChapterData(chapter));
  const { name, type, steps, result } = source;
  const reordered: ValueSource = { type, name, steps, result };
  const { data } = await load({ ...chapter, views: { ALIAS: reordered } });
  assert.deepEqual(data.sources.source, data.views.ALIAS);
  assert.notEqual(data.sources.source, data.views.ALIAS);
  assert.deepEqual(Object.keys(data.views.ALIAS!), ["type", "name", "steps", "result"]);
});

test("chapter data sharing is local to each generation", async () => {
  const changing = { ...source };
  const variant = { ...chapter, sources: { source: changing } };
  const before = generateChapterData(variant);
  changing.result = literal(8, 9);
  const { data, source: after } = await load(variant);
  assert.notEqual(after, before);
  assert.deepEqual(data.sources.source!.result, literal(8, 9));
  assert.deepEqual(data.views.ALIAS!.result, literal(8, 1));
});

test("serialized instruction bodies still pass through independent validation", async () => {
  const invalid: InstructionDefinition = { ...definition, steps: [writeRegister(register, value("missing"))] };
  await assert.rejects(() => load({ ...chapter, families: { invalid: [[0, invalid]] } }), /not been captured/);
});

test("a shared action cannot bypass standalone instruction validation by reusing its serialized reference", async () => {
  // Actions execute in the caller's CPU; the same object's own CPU must be checked as an instruction.
  const shared = ownData({ ...action, cpu: { ...cpu, name: "other" } });
  const invoking: ValueSource = { name: "invoke action", type: 8,
    steps: [{ kind: "perform", action: shared, arguments: { source: literal(8, 1) } }], result: literal(8, 0) };
  defineInstruction({ ...definition, steps: [readSource("result", invoking)] });
  await assert.rejects(() => load({ ...chapter, sources: { invoking }, actions: {}, families: { invalid: [[0, shared]] } }), /CPU schema/);
});
