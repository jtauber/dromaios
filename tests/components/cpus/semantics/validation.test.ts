import assert from "node:assert/strict";
import { test } from "node:test";
import { cpu6502StateDescription } from "../../../../src/components/cpus/generated/6502-cpu.js";
import { cpu6809StateDescription } from "../../../../src/components/cpus/generated/6809-cpu.js";
import { addOverflow, borrow, carry, halfBorrow, halfCarry, overflow, subtract, updateFlags, addWrap, bitAnd, bitOr, bitXor, capture, concat, cpuSymbols, evenParity, extend, flagLiteral, flagValue, highByte, lowByte, literal, readFlag, readMemory, shiftLeft, value, writeLatch, writeRegister, xor, zero } from "../../../../src/components/cpus/semantics/model.js";
import type { Expression, FlagExpression, FlagPolicy, InstructionDefinition, NumberExpression, Statement } from "../../../../src/components/cpus/semantics/model.js";
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
    addWrap(literal(8, 1), literal(16, 1)), concat(literal(32, 1), literal(32, 2)),
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
  assert.throws(() => defineInstruction({ ...base, inputs: { address: 64 }, steps: [] } as unknown as InstructionDefinition), /inputs: expected width/);
  const inputs = { address: 16 as const };
  const owned = defineInstruction({ ...base, inputs, steps: [] });
  assert.notEqual(owned.inputs, inputs);
  assert.equal(Object.isFrozen(owned.inputs), true);
  assert.equal(Object.isFrozen(inputs), false);
});

test("numeric bitwise expressions require equally wide captured numbers and preserve their width", () => {
  for (const operation of [bitAnd, bitOr, bitXor]) {
    for (const width of [8, 16] as const) {
      const operand = literal(width, 2 ** width - 1), result = operation(operand, literal(width, 0));
      define([{ kind: "write-register", register: mos.register(width === 8 ? "a" : "pc"), value: result }]);
      assert.throws(() => define([{ kind: "write-register", register: mos.register(width === 8 ? "pc" : "a"), value: result }]), /expected .*bit value/);
      for (const [invalid, message] of [
        [literal(width === 8 ? 16 : 8, 1), /equal widths/],
        [value("missing"), /not been captured/],
        [value("carry"), /is a flag, not a number/],
        [flagLiteral(true) as unknown as NumberExpression, /unknown numeric expression/],
      ] satisfies [NumberExpression, RegExp][]) {
        for (const expression of [operation(operand, invalid), operation(invalid, operand)]) {
          assert.throws(() => define([readFlag("carry", mos.flag("c")), capture("result", expression)]), message);
        }
      }
    }
  }
});

test("byte extraction requires a captured word and yields a byte, without implicit reads or conversions", () => {
  for (const extract of [highByte, lowByte]) {
    define([capture("word", literal(16, 0xabcd)), { kind: "write-register", register: mos.register("a"), value: extract(value("word")) }]);
    for (const [expr, message] of [
      [extract(literal(8, 255)), /byte requires a word/],
      [extract(extract(literal(16, 65535))), /byte requires a word/],
      [extract(value("missing")), /not been captured/],
      [extract(flagLiteral(true) as unknown as NumberExpression), /unknown numeric expression/],
    ] satisfies [NumberExpression, RegExp][]) assert.throws(() => define([capture("byte", expr)]), message);
    assert.throws(() => define([{ kind: "write-register", register: mos.register("pc"), value: extract(literal(16, 0)) }]), /expected 16-bit value/);
  }
});

test("control-latch writes require a Boolean value and a declared latch belonging to this CPU", () => {
  const latch = motorola.latch("nmiArmed");
  const instruction = (steps: readonly Statement[]) => defineInstruction({ cpu: motorola.declaration, name: "latch", explanation: "Latch probe.", steps });
  for (const value of [false, true, flagLiteral(true)]) instruction([writeLatch(latch, value)]);
  for (const ref of [{ ...latch, cpu: "6502" }, ...["s", "flags", "c", "waitMode", "missing"].map(field => ({ ...latch, field }))]) {
    assert.throws(() => instruction([writeLatch(ref, true)]), /unknown control latch/);
  }
  assert.throws(() => define([writeLatch(latch, true)]), /unknown control latch/);
  for (const value of [0, 1, "true", null]) {
    assert.throws(() => instruction([{ kind: "write-latch", latch, value } as unknown as Statement]), /control latch value must be Boolean/);
  }
  assert.throws(() => motorola.latch("s" as "nmiArmed"), /expected a stored control latch/);
  assert.throws(() => motorola.register("nmiArmed" as "s"), /expected a stored register/);
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

test("owned definitions and shared input data avoid repeated copying without trusting caller freezes", () => {
  const original = define([capture("byte", literal(8, 12))]);
  assert.equal(defineInstruction(original), original);
  const extended = defineInstruction({ ...original, name: "extended", steps: [...original.steps, writeRegister(mos.register("a"), value("byte"))] });
  assert.deepEqual(extended.cpu, original.cpu);
  assert.deepEqual(extended.steps[0], original.steps[0]);
  assert.notEqual(extended.steps, original.steps);
  assert.throws(() => defineInstruction({ ...original, steps: [writeRegister(mos.register("a"), value("byte"))] }), /not been captured/);
  const shared = literal(8, 12);
  const dag = define([capture("left", shared), capture("right", shared)]);
  assert.equal(dag.steps[0]!.kind === "capture" && dag.steps[0].value,
    dag.steps[1]!.kind === "capture" && dag.steps[1].value);
  assert.notEqual(dag.steps[0]!.kind === "capture" && dag.steps[0].value, shared);
  const changed = { kind: "literal" as const, width: 8 as const, value: 12 };
  const foreign = Object.freeze({ ...original, steps: Object.freeze([capture("byte", changed)]) });
  const owned = defineInstruction(foreign); changed.value = 13;
  assert.deepEqual(owned.steps, original.steps);
  assert.notEqual(owned, foreign);
  assert.throws(() => defineInstruction(Object.freeze({ ...original, steps: [capture("byte", literal(16, 1)), writeRegister(mos.register("a"), value("byte"))] })), /expected 8-bit value/);
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

test("arithmetic carry inputs and flag-policy parameters require explicitly captured Booleans", () => {
  for (const operation of [addWrap, subtract]) {
    define([readFlag("carry", mos.flag("c")), capture("result", operation(literal(8, 0xff), literal(8, 1), flagValue("carry")))]);
    assert.throws(() => define([capture("result", operation(literal(8, 1), literal(8, 2), flagValue("carry")))]), /not been captured/);
    assert.throws(() => define([capture("carry", literal(8, 1)), capture("result", operation(literal(8, 1), literal(8, 2), flagValue("carry")))]), /not been captured/);
    assert.throws(() => define([capture("result", operation(literal(8, 1), literal(8, 2), literal(8, 1) as unknown as FlagExpression))]), /unknown flag expression/);
  }
  for (const operation of [carry, halfCarry, addOverflow, borrow, halfBorrow, overflow]) {
    const flags: FlagPolicy = { name: "arithmetic", parameters: { incoming: "flag" }, unlisted: "preserve", updates: [
      { flag: mos.flag("c"), value: operation(literal(16, 0xffff), literal(16, 0), flagValue("incoming")) },
    ] };
    define([readFlag("carry", mos.flag("c")), updateFlags(flags, { incoming: flagValue("carry") })]);
    define([updateFlags(flags, { incoming: flagLiteral(true) })]);
    for (const [args, message] of [
      [{}, /missing argument/], [{ incoming: literal(8, 1) }, /unknown flag expression/],
      [{ incoming: flagValue("missing") }, /not been captured/],
      [{ incoming: flagLiteral(false), extra: flagLiteral(true) }, /unknown argument/],
    ] satisfies [Record<string, Expression>, RegExp][]) assert.throws(() => define([updateFlags(flags, args)]), message);
    for (const invalid of [operation(literal(8, 1), literal(16, 1)), operation(literal(8, 1), literal(8, 1), flagValue("missing")),
      operation(literal(8, 1), literal(8, 1), value("incoming") as unknown as FlagExpression)]) {
      assert.throws(() => define([updateFlags({ ...flags, updates: [{ flag: mos.flag("c"), value: invalid }] }, { incoming: flagLiteral(false) })]),
        /equal widths|not been captured|unknown flag expression/);
    }
    assert.throws(() => define([updateFlags({ ...flags, updates: [{ flag: mos.flag("c"), value: zero(value("incoming")) }] }, { incoming: flagLiteral(false) })]), /is a flag, not a number/);
  }
  assert.throws(() => define([updateFlags(policy, { byte: flagLiteral(false) })]), /unknown numeric expression/);
});
