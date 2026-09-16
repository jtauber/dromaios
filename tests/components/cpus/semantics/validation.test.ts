import assert from "node:assert/strict";
import { test } from "node:test";
import { cpu6502StateDescription } from "../../../../src/components/cpus/6502.js";
import { cpu6809StateDescription } from "../../../../src/components/cpus/6809.js";
import { addWrap, capture, concat, cpuSymbols, evenParity, extend, flagLiteral, flagValue, literal, readFlag, readMemory, shiftLeft, value, xor, zero } from "../../../../src/components/cpus/semantics/model.js";
import type { FlagExpression, FlagPolicy, InstructionDefinition, NumberExpression, Statement } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";

const mos = cpuSymbols("6502", cpu6502StateDescription), motorola = cpuSymbols("6809", cpu6809StateDescription);
const policy: FlagPolicy = {
  name: "zero only", parameters: { byte: 8 }, unlisted: "preserve",
  updates: [{ flag: mos.flag("z"), value: zero(value("byte")) }],
};
function define(steps: readonly Statement[]): InstructionDefinition {
  return defineInstruction({ name: "probe", cpu: mos.declaration, explanation: "Validation probe.", steps });
}

test("captures are immutable, ordered, scoped, and available only after their defining statement", () => {
  for (const [steps, message] of [
    [[{ kind: "capture", name: "byte", value: value("missing") }], /not been captured/],
    [[{ kind: "capture", name: "byte", value: value("byte") }], /not been captured/],
    [[{ kind: "fetch-byte", name: "byte" }, { kind: "fetch-byte", name: "byte" }], /duplicate capture/],
    [[{ kind: "fetch-byte", name: "invalid-name" }], /invalid value name/],
    [[{ kind: "fetch-byte", name: "outer" }, { kind: "read-source", name: "byte", source: {
      name: "unbound", width: 8, steps: [], result: value("outer"),
    } }], /not been captured/],
    [[{ kind: "read-source", name: "byte", source: {
      name: "nested", width: 8, steps: [{ kind: "fetch-byte", name: "inner" }], result: value("inner"),
    } }, { kind: "capture", name: "copy", value: value("inner") }], /not been captured/],
  ] satisfies [Statement[], RegExp][]) assert.throws(() => define(steps), message);
  const owned = define([
    { kind: "read-source", name: "byte", source: {
      name: "nested", width: 8, steps: [{ kind: "fetch-byte", name: "byte" }], result: value("byte"),
    } },
    { kind: "write-register", register: mos.register("a"), value: value("byte") },
  ]);
  assert.equal(owned.steps.length, 2); // Same spelling in distinct lexical scopes is legal.
});

test("widths require explicit widening, matching arithmetic operands, byte memory, and word addresses", () => {
  for (const expr of [
    literal(8, -1), literal(8, 256), literal(16, 65536), literal(8, 1.5), literal(8, NaN),
    addWrap(literal(8, 1), literal(16, 1)), concat(literal(16, 1), literal(16, 2)),
    extend(literal(16, 1), 8), extend(literal(8, 1), 8),
  ]) assert.throws(() => define([{ kind: "capture", name: "test", value: expr }]), /literal|width|concatenation|widen/);
  for (const step of [
    { kind: "write-register", register: mos.register("a"), value: literal(16, 1) },
    { kind: "read-memory", name: "byte", address: literal(8, 1) },
    { kind: "write-memory", address: literal(16, 1), value: literal(16, 1) },
    { kind: "read-source", name: "byte", source: { name: "wrong result", width: 16, steps: [], result: literal(8, 0) } },
  ] satisfies Statement[]) assert.throws(() => define([step]), /expected .*bit|source result width/);
  define([{ kind: "capture", name: "address", value: extend(literal(8, 255), 16) },
    { kind: "read-memory", name: "byte", address: value("address") }]);
});

test("instruction inputs are immutable typed captures in the body, not implicit source or policy parameters", () => {
  const base = { name: "inputs", cpu: mos.declaration, explanation: "Input validation probe.", inputs: { address: 16 as const } };
  defineInstruction({ ...base, steps: [readMemory("byte", value("address"))] });
  for (const [steps, message] of [
    [[capture("address", literal(16, 0))], /duplicate capture address/],
    [[capture("result", shiftLeft(literal(8, 0), flagValue("address")))], /flag address has not been captured/],
    [[{ kind: "read-source", name: "byte", source: { name: "closed", width: 8,
      steps: [readMemory("byte", value("address"))], result: value("byte") } }], /not been captured/],
    [[{ kind: "update-flags", policy: { ...policy, updates: [{ flag: mos.flag("z"), value: zero(value("address")) }] },
      arguments: { byte: literal(8, 0) } }], /not been captured/],
  ] satisfies [Statement[], RegExp][]) assert.throws(() => defineInstruction({ ...base, steps }), message);
  assert.throws(() => defineInstruction({ ...base, inputs: { address: 8 }, steps: [readMemory("byte", value("address"))] }), /expected 16-bit value/);
  assert.throws(() => defineInstruction({ ...base, inputs: { "bad-name": 16 }, steps: [] }), /inputs: invalid value name/);
  assert.throws(() => defineInstruction({ ...base, inputs: { address: 32 }, steps: [] } as unknown as InstructionDefinition), /inputs: expected width/);
  const inputs = { address: 16 as const };
  const owned = defineInstruction({ ...base, inputs, steps: [] });
  assert.notEqual(owned.inputs, inputs);
  assert.equal(Object.isFrozen(owned.inputs), true);
  assert.equal(Object.isFrozen(inputs), false);
});

test("CPU-owned state descriptions validate register identity, declared widths, and flag targets", () => {
  for (const register of [motorola.register("a"), { ...mos.register("a"), width: 16 as const }, { ...mos.register("a"), field: "q" }]) {
    assert.throws(() => define([{ kind: "read-register", name: "byte", register }]), /does not match the CPU schema/);
  }
  for (const flag of [motorola.flag("z"), { ...mos.flag("z"), field: "q" }]) {
    assert.throws(() => define([{ kind: "update-flags", policy: { ...policy, updates: [{ flag, value: zero(value("byte")) }] },
      arguments: { byte: literal(8, 0) } }]), /unknown flag/);
  }
});

test("flag policies have closed parameter scopes, exact argument widths, unique assignments, and byte parity", () => {
  for (const [candidate, args, message] of [
    [policy, {}, /missing argument/],
    [policy, { byte: literal(8, 1), extra: literal(8, 0) }, /unknown argument/],
    [policy, { byte: literal(16, 1) }, /must have width 8/],
    [{ ...policy, updates: [...policy.updates, ...policy.updates] }, { byte: literal(8, 1) }, /duplicate flag/],
    [{ ...policy, updates: [{ flag: mos.flag("z"), value: zero(value("outer")) }] }, { byte: literal(8, 1) }, /not been captured/],
    [{ ...policy, parameters: { byte: 16 }, updates: [{ flag: mos.flag("z"), value: evenParity(value("byte")) }] },
      { byte: literal(16, 1) }, /even parity requires a byte/],
  ] satisfies [FlagPolicy, Record<string, NumberExpression>, RegExp][]) {
    assert.throws(() => define([
      { kind: "fetch-byte", name: "outer" },
      { kind: "update-flags", policy: candidate, arguments: args },
    ]), message);
  }
  // Diagnostics preserve the instruction, statement, and named source/policy context.
  assert.throws(() => define([{ kind: "update-flags", policy, arguments: {} }]),
    /6502 probe \/ body \/ 1 update-flags \/ policy zero only: missing argument byte/);
});

test("flag captures have distinct types, CPU ownership, ordering, and lexical scope", () => {
  const carry = readFlag("carry", mos.flag("c")), shifted = shiftLeft(literal(8, 0x80), flagValue("carry"));
  define([carry, capture("result", shifted)]);
  for (const [steps, message] of [
    [[capture("result", shifted), carry], /flag carry has not been captured/],
    [[capture("carry", literal(8, 1)), capture("result", shifted)], /flag carry has not been captured/],
    [[carry, capture("byte", value("carry"))], /is a flag, not a number/],
    [[carry, capture("carry", literal(8, 1))], /duplicate capture/],
    [[readFlag("carry", motorola.flag("c"))], /unknown flag/],
    [[readFlag("carry", { ...mos.flag("c"), field: "pc" })], /unknown flag/],
    [[{ kind: "read-source", name: "result", source: { name: "local carry", width: 8, steps: [carry], result: shifted } },
      capture("escaped", shifted)], /flag carry has not been captured/],
    [[carry, { kind: "read-source", name: "result", source: { name: "outer carry", width: 8, steps: [], result: shifted } }], /flag carry has not been captured/],
    [[carry, { kind: "update-flags", policy: { ...policy, updates: [{ flag: mos.flag("z"), value: flagValue("carry") }] },
      arguments: { byte: literal(8, 0) } }], /flag carry has not been captured/],
  ] satisfies [Statement[], RegExp][]) assert.throws(() => define(steps), message);
  const invalid = { kind: "flag-literal", value: 1 } as unknown as FlagExpression;
  assert.throws(() => define([capture("bad", shiftLeft(literal(8, 0), invalid))]), /flag literal must be Boolean/);
  assert.throws(() => define([capture("bad", shiftLeft(literal(8, 256), flagLiteral(false)))]), /literal does not fit/);
});

test("Boolean XOR validates both operands and respects closed policy scopes", () => {
  const flag = flagLiteral(false);
  for (const invalid of [literal(8, 1) as unknown as FlagExpression, flagValue("missing")]) {
    for (const expression of [xor(flag, invalid), xor(invalid, flag)]) {
      assert.throws(() => define([capture("result", shiftLeft(literal(8, 0), expression))]), /flag expression|not been captured/);
    }
  }
  assert.throws(() => define([
    readFlag("carry", mos.flag("c")),
    { kind: "update-flags", policy: { ...policy, updates: [
      { flag: mos.flag("z"), value: xor(zero(value("byte")), flagValue("carry")) },
    ] }, arguments: { byte: literal(8, 0) } },
  ]), /flag carry has not been captured/);
});

test("validated descriptions own and freeze their data without freezing caller objects", () => {
  const expr = { kind: "literal" as const, width: 8 as const, value: 12 };
  const steps: Statement[] = [{ kind: "capture", name: "byte", value: expr }];
  const owned = define(steps);
  expr.value = 13;
  steps.length = 0;
  assert.deepEqual(owned.steps, [{ kind: "capture", name: "byte", value: { kind: "literal", width: 8, value: 12 } }]);
  assert.equal(Object.isFrozen(expr), false);
  assert.equal(Object.isFrozen(owned.steps), true);
  assert.equal(Object.isFrozen(owned.steps[0]), true);
  assert.notEqual(owned.cpu.state, cpu6502StateDescription);
  assert.equal(Object.isFrozen(owned.cpu.state.flags), true);
  assert.throws(() => { Object.assign(owned.steps[0]!, { name: "changed" }); }, TypeError);
});

test("definitions reject hidden host behavior, instances, and recursive data", () => {
  let called = false;
  const base = { name: "bad", cpu: mos.declaration, explanation: "Bad definition.", steps: [] };
  // Deliberately bypass static types to check the construction boundary.
  for (const hidden of [() => { called = true; }, new Date()]) {
    assert.throws(() => defineInstruction({ ...base, hidden } as InstructionDefinition), /plain data/);
  }
  const accessor = Object.defineProperty({ ...base }, "steps", { get: () => { called = true; return []; } });
  assert.throws(() => defineInstruction(accessor), /without accessors/);
  const array: Statement[] = [];
  Object.defineProperty(array, "map", { value: () => { called = true; return []; } });
  assert.throws(() => defineInstruction({ ...base, steps: array }), /only indexed data/);
  const cycle: Record<string, unknown> = { ...base };
  cycle.self = cycle;
  assert.throws(() => defineInstruction(cycle as unknown as InstructionDefinition), /cannot contain cycles/);
  assert.equal(called, false);
});
