import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { cpu8088StateDescription } from "../../../../src/components/cpus/semantics/generated/state/8088.js";
import type { Cpu8088State } from "../../../../src/components/cpus/semantics/generated/state/8088.js";
import { capture, cpuSymbols, flagLiteral, flagValue, iterateTogether, literal, not, readMemory, readSource, reject, select,
  updateFlags, value, when, writeRegister, zero } from "../../../../src/components/cpus/semantics/model.js";
import type { InstructionDefinition, IterationValue, Statement } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { flagPolicy } from "../../../../src/components/cpus/semantics/status.js";
import { initialState } from "../8088/helpers.js";

const cpu = cpuSymbols("8088", cpu8088StateDescription);
const define = (steps: readonly Statement[], inputs?: InstructionDefinition["inputs"]) =>
  defineInstruction({ cpu: cpu.declaration, name: "parallel iteration", explanation: "Named values advance together.", steps, ...(inputs ? { inputs } : {}) });
const values = {
  left: { type: 16, initial: literal(16, 1), next: value("right") },
  right: { type: 16, initial: literal(16, 2), next: value("left") },
  bit: { type: "flag", initial: flagLiteral(false), next: not(flagValue("bit")) },
} as const satisfies Record<string, IterationValue>;
async function compile(definition: InstructionDefinition) {
  const source = stripTypeScriptTypes(generateInstructions("8088", { run: definition }));
  return (await import("data:text/javascript," + encodeURIComponent(source))).instructions.run as
    (state: Cpu8088State, count: number, context: { readByte(address: number): number }) => "zero" | void;
}

test("named iteration checks types, simultaneous initial scope, immutable locals, and source isolation", () => {
  const loop = iterateTogether(literal(8, 2), values, [capture("temporary", value("left"))]);
  define([loop, writeRegister(cpu.register("ax"), value("left"))]);
  for (const steps of [
    [iterateTogether(literal(16, 1), values, [])], [iterateTogether(literal(8, 1), {}, [])],
    [iterateTogether(literal(8, 1), { ...values, right: { ...values.right, initial: value("left") } }, [])],
    [iterateTogether(literal(8, 1), { ...values, left: { ...values.left, next: literal(8, 1) } }, [])],
    [iterateTogether(literal(8, 1), { bit: { type: "flag", initial: literal(8, 0), next: flagLiteral(true) } }, [])],
    [iterateTogether(literal(8, 1), { ...values, bit: { ...values.bit, next: value("left") } }, [])],
    [iterateTogether(literal(8, 1), { ...values, left: { ...values.left, next: flagValue("bit") } }, [])],
    [iterateTogether(literal(8, 1), values, [capture("left", literal(16, 0))])],
    [iterateTogether(literal(8, 1), values, [when(flagLiteral(true), [capture("local", literal(8, 0))]), capture("bad", value("local"))])],
    [loop, loop], [loop, capture("bad", value("temporary"))],
    [readSource("closed", { name: "rejecting loop", type: 16, steps: [iterateTogether(literal(8, 1), values, [reject("zero")])], result: value("left") })],
  ]) assert.throws(() => define(steps));
  const description = describeInstruction(define([loop]));
  assert.match(description, /iterate 02:u8 times with left, right, bit/);
  assert.match(description, /next left := right/);
  assert.match(description, /Update all values together/);
});

test("named iteration advances numbers and flags simultaneously and publishes only completed loops", async () => {
  // Extra plain-data properties cannot override the compiler's chosen local names.
  const describedValues = { ...values, left: { ...values.left, name: "unused", code: "unused" } };
  const definition = define([iterateTogether(value("count"), describedValues, [readMemory("byte", value("left")), when(zero(value("byte")), [reject("zero")])]),
    writeRegister(cpu.register("ax"), value("left")), writeRegister(cpu.register("dx"), value("right")),
    updateFlags(flagPolicy(cpu, "loop flag", { bit: "flag" }, { cf: flagValue("bit") }), { bit: flagValue("bit") }),
    writeRegister(cpu.register("bx"), select(flagValue("bit"), literal(16, 7), literal(16, 9)))], { count: 8 });
  const run = await compile(definition), failure = Error("iteration read failed");
  for (const count of [0, 1, 2, 3, 254, 255]) for (const failAt of [-1, 0, count - 1]) {
    const state = initialState(), reads: number[] = [], failed = failAt >= 0 && failAt < count;
    const execute = () => run(state, count, { readByte(a) { reads.push(a); if (reads.length - 1 === failAt) throw failure; return 1; } });
    if (failed) assert.throws(execute, e => e === failure); else assert.equal(execute(), undefined);
    assert.deepEqual(reads, Array.from({ length: failed ? failAt + 1 : count }, (_, i) => i % 2 + 1));
    assert.deepEqual(state, failed ? initialState() : { ...initialState(), ax: count % 2 ? 2 : 1, dx: count % 2 ? 1 : 2,
      bx: count % 2 ? 7 : 9, flags: { ...initialState().flags, cf: count % 2 !== 0 } });
  }
  const state = initialState(); let reads = 0;
  assert.equal(run(state, 255, { readByte() { reads++; return 0; } }), "zero");
  assert.equal(reads, 1); assert.deepEqual(state, initialState());
});
