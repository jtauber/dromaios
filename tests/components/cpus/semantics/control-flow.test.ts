import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import type { ByteInstructionContext } from "../../../../src/components/cpus/instruction-context.js";
import { cpu6502StateDescription } from "../../../../src/components/cpus/semantics/generated/state/6502.js";
import type { Cpu6502State } from "../../../../src/components/cpus/semantics/generated/state/6502.js";
import { and, capture, cpuSymbols, fetchByte, flagLiteral, flagValue, literal, not, readFlag, readMemory, readRegister, readSource, signExtend, updateFlags, value, when, writeMemory, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import type { FlagExpression, InstructionDefinition, NumberExpression, Statement } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";

const cpu = cpuSymbols("6502", cpu6502StateDescription);
const define = (steps: readonly Statement[]) => defineInstruction({ cpu: cpu.declaration, name: "conditional probe", explanation: "Probe conditional scope and effects.", steps });
const state = (): Cpu6502State => ({ a: 0, x: 0, y: 0, sp: 0xff, pc: 0x1234, flags: { c: false, z: false, n: false, v: false, d: false, i: true } });
const noAccess: ByteInstructionContext = {
  fetchByte() { assert.fail("unexpected fetch"); }, readByte() { assert.fail("unexpected read"); }, writeByte() { assert.fail("unexpected write"); },
};
async function compile(definitions: Readonly<Record<string, InstructionDefinition>>) {
  const source = generateInstructions("6502", definitions);
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: Record<string, (state: Cpu6502State, instruction: ByteInstructionContext) => void> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return compiled.instructions;
}

test("conditional scopes inherit captures, prohibit shadowing and escape, and keep source scopes closed", () => {
  define([capture("outer", literal(8, 1)), readFlag("condition", cpu.flag("c")),
    when(flagValue("condition"), [capture("inner", value("outer")), when(flagLiteral(true), [writeRegister(cpu.register("a"), value("inner"))])]),
    when(flagLiteral(true), [capture("inner", value("outer"))]),
  ]);
  for (const [steps, message] of [
    [[when(flagValue("missing"), [])], /flag missing has not been captured/],
    [[capture("number", literal(8, 1)), when(flagValue("number"), [])], /flag number has not been captured/],
    [[when(literal(8, 1) as unknown as FlagExpression, [])], /unknown flag expression/],
    [[capture("outer", literal(8, 1)), when(flagLiteral(false), [capture("outer", literal(8, 2))])], /duplicate capture/],
    [[when(flagLiteral(true), [capture("inner", literal(8, 1))]), capture("escaped", value("inner"))], /not been captured/],
    [[when(flagLiteral(false), [readFlag("inner", cpu.flag("c"))]), when(flagValue("inner"), [])], /not been captured/],
    [[capture("outer", literal(8, 1)), when(flagLiteral(true), [readSource("result", {
      name: "closed", width: 8, steps: [], result: value("outer"),
    })])], /not been captured/],
  ] satisfies [Statement[], RegExp][]) assert.throws(() => define(steps), message);
});

test("signed widening requires a narrower numeric value and Boolean AND validates both operands", () => {
  for (const expr of [signExtend(literal(8, 1), 8), signExtend(literal(16, 1), 8), signExtend(literal(16, 1), 16)]) {
    assert.throws(() => define([capture("bad", expr)]), /widen/);
  }
  assert.throws(() => define([capture("bad", signExtend(flagLiteral(true) as unknown as NumberExpression, 16))]), /numeric expression/);
  assert.throws(() => define([writeRegister(cpu.register("a"), signExtend(literal(8, 1), 16))]), /expected 8-bit value/);
  for (const invalid of [literal(8, 1) as unknown as FlagExpression, flagValue("missing")]) {
    for (const expr of [and(flagLiteral(false), invalid), and(invalid, flagLiteral(false))]) {
      assert.throws(() => define([when(expr, [])]), /flag expression|not been captured/);
    }
  }
});

test("generated signed widening covers every byte and AND covers its truth table", async () => {
  const instructions = await compile({ extend: define([readRegister("byte", cpu.register("a")), writeRegister(cpu.register("pc"), signExtend(value("byte"), 16))]),
    conjunction: define([readFlag("left", cpu.flag("c")), readFlag("right", cpu.flag("z")),
      when(and(flagValue("left"), flagValue("right")), [writeRegister(cpu.register("a"), literal(8, 1))])]),
  });
  for (let byte = 0; byte < 256; byte++) {
    const actual = { ...state(), a: byte }, expected = { ...actual, pc: byte < 128 ? byte : byte + 0xff00 };
    instructions.extend!(actual, noAccess); assert.deepEqual(actual, expected);
  }
  for (const left of [false, true]) for (const right of [false, true]) {
    const actual = state(); actual.flags.c = left; actual.flags.z = right;
    const expected = { ...actual, a: Number(left && right) };
    instructions.conjunction!(actual, noAccess); assert.deepEqual(actual, expected);
  }
});

test("nested conditionals defer all body effects, infer latent capabilities, and stop at the first failure", async () => {
  const definition = define([
    readFlag("outer", cpu.flag("c")), readFlag("inner", cpu.flag("z")), capture("address", literal(16, 0xffff)),
    when(flagValue("outer"), [fetchByte("local"), writeRegister(cpu.register("a"), value("local")),
      when(flagValue("inner"), [readMemory("byte", value("address")), writeMemory(value("address"), value("byte"))]),
      writeRegister(cpu.register("x"), value("local")),
    ]),
    when(not(flagValue("outer")), [capture("local", literal(8, 0x80)), writeRegister(cpu.register("y"), value("local"))]),
    writeRegister(cpu.register("sp"), literal(8, 0x42)),
  ]);
  const source = generateInstructions("6502", { probe: definition });
  assert.match(source, /Pick<ByteInstructionContext, "fetchByte" \| "readByte" \| "writeByte">/);
  const instructions = await compile({ probe: definition }), failure = new Error("conditional effect failure");
  for (const outer of [false, true]) for (const inner of [false, true]) {
    const count = outer ? inner ? 3 : 1 : 0;
    for (let failAt = -1; failAt < count; failAt++) {
      const actual = state(); actual.flags.c = outer; actual.flags.z = inner;
      const expected = structuredClone(actual), events: string[] = [];
      const attempt = (event: string) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
      const run = () => instructions.probe!(actual, {
        fetchByte() { attempt("fetch"); return 0x12; },
        readByte(address) { assert.equal(address, 0xffff); attempt("read"); return 0x34; },
        writeByte(address, byte) { assert.equal(address, 0xffff); assert.equal(byte, 0x34); attempt("write"); },
      });
      if (failAt < 0) run(); else assert.throws(run, error => error === failure);
      if (outer && failAt !== 0) expected.a = 0x12;
      if (failAt < 0) { expected.sp = 0x42; if (outer) expected.x = 0x12; else expected.y = 0x80; }
      assert.deepEqual(actual, expected);
      assert.deepEqual(events, ["fetch", "read", "write"].slice(0, failAt < 0 ? count : failAt + 1));
    }
  }
});

test("review expansion shows conditional scope and does not claim conditional flag updates are preserved", () => {
  const description = describeInstruction(define([readFlag("condition", cpu.flag("c")), when(and(flagValue("condition"), flagLiteral(true)), [
    writeRegister(cpu.register("pc"), signExtend(literal(8, 0xff), 16)),
    updateFlags({ name: "conditional Z", parameters: {}, unlisted: "preserve", updates: [{ flag: cpu.flag("z"), value: flagLiteral(true) }] }, {}),
  ])]));
  assert.match(description, /when and\(condition, 1:flag\) \{\n  write PC:u16 := signExtend16\(FF:u8\)/);
  assert.match(description, /\n  flags "conditional Z" simultaneously \{\n    Z := 1:flag\n  \}/);
  assert.doesNotMatch(description.split("Flags preserved throughout:")[1]!, /\bZ\b/);
});
