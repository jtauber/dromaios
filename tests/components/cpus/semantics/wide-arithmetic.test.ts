import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { cpu8088StateDescription } from "../../../../src/components/cpus/state/8088.js";
import type { Cpu8088State } from "../../../../src/components/cpus/state/8088.js";
import { addWrap, bitAnd, bitOr, bitXor, capture, concat, cpuSymbols, divide, extend, flagLiteral, iterate, literal, multiply,
  readMemory, readSource, reject, shiftBits, shiftLeft, shiftRight, signExtend, subtract, truncate, value, when, writeRegister, zero } from "../../../../src/components/cpus/semantics/model.js";
import type { InstructionDefinition, NumberExpression, Statement } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { initialState } from "../8088/helpers.js";

const cpu = cpuSymbols("8088", cpu8088StateDescription);
const define = (steps: readonly Statement[], inputs?: InstructionDefinition["inputs"]) =>
  defineInstruction({ cpu: cpu.declaration, name: "arithmetic probe", explanation: "Independent compiler contract.", steps, ...(inputs ? { inputs } : {}) });
const wordPair = (expression: NumberExpression): Statement[] => [capture("output", expression),
  writeRegister(cpu.register("ax"), truncate(value("output"), 16)),
  writeRegister(cpu.register("dx"), truncate(shiftBits(value("output"), "right", 16), 16))];
async function compile<Methods>(definitions: Readonly<Record<string, InstructionDefinition>>): Promise<Methods> {
  const source = stripTypeScriptTypes(generateInstructions("8088", definitions))
    .replace('"../alu.ts"', JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  return (await import("data:text/javascript," + encodeURIComponent(source))).instructions;
}

test("wide values, bounded iteration, and checked division validate widths, scopes, outcomes, and source isolation", () => {
  const quotient = divide({ dividend: literal(32, 0xffffffff), divisor: literal(16, 1),
    quotient: "quotient", remainder: "remainder", signed: false, onError: "overflow" });
  define([quotient, writeRegister(cpu.register("ax"), value("quotient"))]);
  const loop = iterate("current", literal(8, 2), literal(16, 0), [capture("next", addWrap(value("current"), literal(16, 1)))], value("next"));
  define([loop, writeRegister(cpu.register("ax"), value("current"))]);
  for (const steps of [
    [iterate("current", literal(16, 2), literal(16, 0), [], value("current"))],
    [iterate("current", literal(8, 2), literal(16, 0), [], literal(8, 0))],
    [iterate("current", literal(8, 2), value("current"), [], value("current"))],
    [loop, capture("copy", value("next"))], [loop, loop],
    [iterate("current", literal(8, 0), literal(16, 0), [capture("current", literal(16, 1))], value("current"))],
    [quotient, capture("quotient", literal(16, 0))],
    [divide({ dividend: literal(16, 1), divisor: literal(16, 1), quotient: "q", remainder: "r", signed: false, onError: "overflow" })],
    [divide({ dividend: literal(16, 1), divisor: literal(8, 1), quotient: "q", remainder: "q", signed: false, onError: "overflow" })],
    [reject("")], [reject("invalid reason")],
    [readSource("closed", { name: "rejecting source", width: 16, steps: [when(flagLiteral(true), [quotient])], result: literal(16, 0) })],
    [readSource("closed", { name: "rejecting iteration", width: 16, steps: [
      iterate("current", literal(8, 1), literal(16, 0), [reject("stop")], value("current"))], result: value("current") })],
    [capture("bad", multiply(literal(32, 1), literal(32, 1)))],
    [capture("bad", concat(literal(32, 1), literal(32, 1)))],
    [capture("bad", literal(32, 0x100000000))],
  ]) assert.throws(() => define(steps));
  const description = describeInstruction(define([loop, quotient, when(zero(value("quotient")), [reject("zero")])]));
  assert.match(description, /iterate 02:u8 times/);
  assert.match(description, /divideUnsigned\(FFFFFFFF:u32, 0001:u16\)/);
  assert.match(description, /quotient overflow returns "overflow"/);
  assert.match(description, /return outcome "zero"/);
});

test("32-bit expressions retain unsigned results at every sign boundary and shift count", async () => {
  const left = value("left"), right = value("right");
  const definitions = Object.fromEntries(Object.entries({
    add: addWrap(left, right), subtract: subtract(left, right), and: bitAnd(left, right), or: bitOr(left, right), xor: bitXor(left, right),
    shiftLeft: shiftLeft(left, flagLiteral(true)), shiftRight: shiftRight(left, flagLiteral(true)),
    concat: concat(truncate(left, 16), truncate(right, 16)),
    signExtend: signExtend(truncate(left, 16), 32), extend: extend(truncate(left, 16), 32),
    ...Object.fromEntries(Array.from({ length: 33 }, (_, count) => ["left" + count, shiftBits(left, "left", count)])),
    ...Object.fromEntries(Array.from({ length: 33 }, (_, count) => ["right" + count, shiftBits(left, "right", count)])),
  }).map(([name, expression]) => [name, define(wordPair(expression), { left: 32, right: 32 })]));
  const bodies = await compile<Record<string, (state: Cpu8088State, left: number, right: number) => void>>(definitions);
  const samples = [0, 1, 0x7fffffff, 0x80000000, 0xffffffff, ...Array.from({ length: 32 }, (_, i) => 2 ** i)];
  const state = initialState();
  for (const a of samples) for (const b of samples) for (const [name, body] of Object.entries(bodies)) {
    const x = BigInt(a), y = BigInt(b);
    const expected = name.startsWith("left") ? x << BigInt(name.slice(4)) : name.startsWith("right") ? x >> BigInt(name.slice(5))
      : ({ add: x + y, subtract: x - y, and: x & y, or: x | y, xor: x ^ y,
        shiftLeft: (x << 1n) | 1n, shiftRight: (x >> 1n) | 0x80000000n,
        concat: ((x & 65535n) << 16n) | (y & 65535n), signExtend: BigInt.asIntN(16, x), extend: x & 65535n })[name]!;
    body(state, a, b);
    assert.equal(state.dx * 65536 + state.ax, Number(BigInt.asUintN(32, expected)), name);
  }
});

test("full products and checked signed/unsigned division match independent BigInt arithmetic", async () => {
  for (const width of [8, 16] as const) for (const signed of [false, true]) {
    const wide = width === 8 ? 16 : 32, mask = 2 ** width - 1, sign = 2 ** (width - 1);
    const product = multiply(value("left"), value("right"), signed);
    const bodies = await compile<{
      product(state: Cpu8088State, left: number, right: number): void;
      division(state: Cpu8088State, dividend: number, divisor: number): "overflow" | void;
    }>({
      product: define(width === 8 ? [writeRegister(cpu.register("ax"), product)] : wordPair(product), { left: width, right: width }),
      division: define([divide({ dividend: value("dividend"), divisor: value("divisor"), quotient: "q", remainder: "r", signed, onError: "overflow" }),
        writeRegister(cpu.register("ax"), width === 8 ? concat(value("r"), value("q")) : value("q")),
        ...(width === 16 ? [writeRegister(cpu.register("dx"), value("r"))] : [])], { dividend: wide, divisor: width }),
    });
    const samples = width === 8 ? Array.from({ length: 256 }, (_, i) => i)
      : [...new Set([0, mask, ...Array.from({ length: 16 }, (_, i) => [2 ** i - 1, 2 ** i, 2 ** i + 1]).flat()])];
    const state = initialState();
    for (const left of samples) for (const right of samples) {
      const a = signed ? BigInt.asIntN(width, BigInt(left)) : BigInt(left), b = signed ? BigInt.asIntN(width, BigInt(right)) : BigInt(right);
      bodies.product(state, left, right);
      assert.equal(width === 8 ? state.ax : state.dx * 65536 + state.ax, Number(BigInt.asUintN(wide, a * b)));
    }
    for (const divisor of samples) for (const dividend of [...samples, 2 ** wide - 1, 2 ** (wide - 1),
      ...[-sign - 1, -sign, -sign + 1, sign - 1, sign, mask, mask + 1].map(q => Number(BigInt.asUintN(wide, BigInt(q) * BigInt(divisor))))]) {
      const before = initialState(), state = structuredClone(before);
      const a = signed ? BigInt.asIntN(wide, BigInt(dividend)) : BigInt(dividend), b = signed ? BigInt.asIntN(width, BigInt(divisor)) : BigInt(divisor);
      const q = b === 0n ? 0n : a / b, r = b === 0n ? 0n : a % b;
      const bad = b === 0n || q < BigInt(signed ? -sign : 0) || q > BigInt(signed ? sign - 1 : mask);
      assert.equal(bodies.division(state, dividend, divisor), bad ? "overflow" : undefined);
      const quotient = Number(BigInt.asUintN(width, q)), remainder = Number(BigInt.asUintN(width, r));
      assert.deepEqual(state, bad ? before : { ...before, ax: width === 8 ? remainder * 256 + quotient : quotient,
        dx: width === 8 ? before.dx : remainder });
    }
  }
});

test("iterations keep immutable local scopes, read a count once, stop on failed effects, and propagate outcomes", async () => {
  const definition = define([iterate("current", value("count"), value("initial"), [
    readMemory("byte", value("current")), capture("next", addWrap(value("current"), extend(value("byte"), 16))),
    when(zero(value("byte")), [reject("zero")]),
  ], value("next")), writeRegister(cpu.register("ax"), value("current"))], { count: 8, initial: 16 });
  const bodies = await compile<{ run(state: Cpu8088State, count: number, initial: number, context: { readByte(address: number): number }): void | "zero" }>({ run: definition });
  for (const count of [0, 1, 2, 255]) {
    const failure = Error("read failed"), initial = 0xfff0;
    for (const failAt of [-1, 0, count - 1]) {
      const state = initialState(), reads: number[] = [];
      const run = () => bodies.run(state, count, initial, { readByte(a) { reads.push(a); if (reads.length - 1 === failAt) throw failure; return 3; } });
      if (failAt >= 0 && failAt < count) assert.throws(run, error => error === failure); else assert.equal(run(), undefined);
      assert.deepEqual(reads, Array.from({ length: failAt >= 0 && failAt < count ? failAt + 1 : count }, (_, i) => (initial + i * 3) % 65536));
      assert.equal(state.ax, failAt >= 0 && failAt < count ? initialState().ax : (initial + count * 3) % 65536);
    }
  }
  const state = initialState();
  let reads = 0;
  assert.equal(bodies.run(state, 255, 0, { readByte() { reads++; return 0; } }), "zero");
  assert.equal(reads, 1); assert.deepEqual(state, initialState());
});
