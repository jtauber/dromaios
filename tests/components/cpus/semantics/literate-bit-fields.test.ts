import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { bits, literal } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction, validateInstruction } from "../../../../src/components/cpus/semantics/validate.js";

const widths = [3, 8, 14, 16, 32] as const;
const document = (inputWidth: number, outputWidth: number, expression: string) => `# Bit fields

Inclusive bounds count upward from bit zero at the least significant end.

\`\`\`cpu
cpu "probe"
state {
  register A: ${inputWidth}
  register OUT: ${outputWidth}
  flag P
}
family probe "00000000" {
  original = register A
  OUT <- ${expression}
}
\`\`\``;
const compile = (text: string) => compileCpuChapter(text, {}, "fields.md");
interface State { a: number; out: number; flags: { p: boolean } }
async function executable(text: string) {
  const definition = compile(text).families.probe![0]![1];
  const code = generateInstructions("probe", { probe: definition });
  const { instructions }: { instructions: { probe(state: State): void } } =
    await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(code))}`);
  return { execute: instructions.probe, definition };
}

// Exhaust narrow inputs; wider samples cross every bit boundary, including bit 31.
function samples(width: number): number[] {
  if (width <= 8) return Array.from({ length: 2 ** width }, (_, value) => value);
  const maximum = 2 ** width - 1;
  return [...new Set([0, maximum, ...Array.from({ length: width }, (_, position) =>
    [2 ** position - 1, 2 ** position, 2 ** position + 1, maximum - 2 ** position]).flat()])];
}
for (const inputWidth of widths) test(`bit fields extract every supported range from ${inputWidth}-bit values`, async () => {
  for (const outputWidth of widths.filter(width => width <= inputWidth)) {
    for (let low = 0; low + outputWidth <= inputWidth; low++) {
      const high = low + outputWidth - 1, expression = `bits(original, ${high}, ${low})`;
      const { execute, definition } = await executable(document(inputWidth, outputWidth, expression));
      for (const a of samples(inputWidth)) {
        const flags = { p: true }, state: State = { a, out: 0, flags };
        execute(state);
        // Text slicing provides an independent expectation without shifts or masks.
        const digits = a.toString(2).padStart(inputWidth, "0").slice(inputWidth - high - 1, inputWidth - low);
        assert.equal(state.out, Number.parseInt(digits, 2), `${inputWidth}: ${a}, ${high}:${low}`);
        assert.equal(state.a, a); assert.equal(state.flags, flags); assert.equal(flags.p, true);
      }
      assert.ok(describeInstruction(definition).includes(`write OUT:u${outputWidth} := ${expression}`));
    }
  }
});

test("bit fields compose through sources, concatenation, and flag policies using the original capture", async () => {
  const text = document(32, 16, "original").replace('family probe "00000000" {', `source middle "three-bit selector" (input: 16): 3 {
  return bits(input, 10, 8)
}
policy upper "selector high bit" (input: 16) {
  P = bit(bits(input, 10, 8), 2)
}
family probe "00000000" {`).replace("  OUT <- original", `  A <- u32(0)
  bits = source middle(bits(original, 23, 8))
  OUT <- concat(bits(original, $1F, $18), extend(bits, 8))
  apply upper(bits(original, 23, 8))`);
  const { execute, definition } = await executable(text);
  for (const a of [0, 0x80000000, 0xffffffff, 0xa5050042, 0x7fffff80]) {
    const state: State = { a, out: 0, flags: { p: false } }, events: string[] = [];
    const observed = new Proxy(state, {
      get(target, key, receiver) { if (key === "a") events.push("read a"); return Reflect.get(target, key, receiver); },
      set(target, key, value, receiver) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value, receiver); },
    });
    execute(observed);
    const digits = a.toString(2).padStart(32, "0");
    assert.equal(state.out, Number.parseInt(digits.slice(0, 8) + "00000" + digits.slice(13, 16), 2));
    assert.equal(state.flags.p, digits[13] === "1"); assert.equal(state.a, 0);
    assert.deepEqual(events, ["read a", "write a", "write out"]);
  }
  assert.match(describeInstruction(definition), /P := bit\(bits\(bits\(original, 23, 8\), 10, 8\), 2\)/);
});

const invalid: readonly [string, string, RegExp][] = [
  ["out-of-width high bound", "bits(original, 8, 6)", /bit range.*high < 8/],
  ["reversed bounds", "bits(original, 2, 4)", /bit range/],
  ["negative bound", "bits(original, 2, -1)", /Unexpected character/],
  ["fractional high bound", "bits(original, 4.5, 2)", /Expected ","/],
  ["fractional low bound", "bits(original, 4, 2.5)", /Expected "\)"/],
  ["unsupported result width", "bits(original, 7, 4)", /expected width 3, 8, 14, 16, or 32/],
  ["single-bit numeric result", "bits(original, 2, 2)", /expected width 3, 8, 14, 16, or 32/],
  ["dynamic high bound", "bits(original, original, 0)", /Expected a decimal number/],
  ["typed low bound", "bits(original, 4, u8(2))", /Expected a decimal number/],
  ["missing low bound", "bits(original, 4)", /Expected ","/],
  ["extra bound", "bits(original, 4, 2, 0)", /Expected "\)"/],
  ["uncaptured operand", "bits(missing, 4, 2)", /has not been captured/],
  ["Boolean operand", "bits(zero(original), 4, 2)", /Unknown numeric operation zero/],
  ["implicit state read", "bits(register A, 4, 2)", /Expected ","/],
  ["implicit narrowing", "bits(original, 7, 0)", /expected 3-bit value/],
];
for (const [name, expression, message] of invalid) test(`bit fields reject ${name} at its source line`, () => {
  const text = document(8, 3, expression), line = text.split("\n").findIndex(line => line.includes("OUT <-")) + 1;
  assert.throws(() => compile(text), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, "fields.md"); assert.equal(error.line, line);
    assert.match(error.message, message); return true;
  });
});

test("bit fields check bounds in every width specialization, even when unused", async () => {
  const text = document(16, 8, "original").replace('family probe "00000000" {', `source upper<bits: 16, 32> "bits 15 through 8" (input: bits): 8 {
  return bits(input, 15, 8)
}
family probe "00000000" {`).replace("  OUT <- original", "  selected = source upper<16>(original)\n  OUT <- selected");
  const { execute } = await executable(text), state: State = { a: 0xa55a, out: 0, flags: { p: false } };
  execute(state); assert.equal(state.out, 0xa5);
  assert.throws(() => compile(text.replace("bits: 16, 32", "bits: 16, 8")), /bit range.*high < 8/);
  assert.throws(() => compile(document(8, 3, "original").replace("OUT <- original", "selected: flag = bits(original, 4, 2)")), /Unknown flag operation bits/);
});

test("serialized bit fields cannot bypass integer bounds, operand types, or result widths", () => {
  const definition = compile(document(32, 32, "bits(original, 31, 0)")).families.probe![0]![1];
  const check = (expression: unknown) => validateInstruction({ ...definition, steps: [{ kind: "capture", name: "field", value: expression }] } as typeof definition);
  const valid = bits(literal(32, 0xffffffff), 31, 0);
  assert.doesNotThrow(() => check(valid));
  for (const bounds of [
    { high: 32, low: 0 }, { high: 2, low: 4 }, { high: 1, low: -1 },
    { high: 2.5, low: 0.5 }, { high: NaN, low: 0 }, { high: 7, low: Infinity },
    { high: undefined, low: 0 }, { high: 7, low: "0" }, { high: true, low: false },
  ]) assert.throws(() => check({ ...valid, ...bounds }), /bit range/);
  for (const high of [0, 1, 3, 6, 14, 30]) assert.throws(() => check({ ...valid, high }), /expected width/);
  assert.throws(() => check({ ...valid, value: { kind: "flag-literal", value: true } }), /unknown numeric expression/);
  assert.doesNotThrow(() => defineInstruction({ ...definition, steps: [{ kind: "capture", name: "field", value: valid }] }));
});
