import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { literal, withBits } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction, validateInstruction } from "../../../../src/components/cpus/semantics/validate.js";

const widths = [3, 8, 14, 16, 32] as const;
const document = (width: number, replacementWidth: number, expression: string) => `# Replace a bit field

Preserve every bit outside the inclusive high-to-low range.

\`\`\`cpu
cpu "probe"
state {
  register A: ${width}
  register B: ${replacementWidth}
  register OUT: ${width}
  flag P
}
family probe "00000000" {
  original = register A
  replacement = register B
  OUT <- ${expression}
}
\`\`\``;
const compile = (text: string) => compileCpuChapter(text, {}, "with-bits.md");
interface State { a: number; b: number; out: number; flags: { p: boolean } }
async function executable(text: string) {
  const definition = compile(text).families.probe![0]![1];
  const code = generateInstructions("probe", { probe: definition });
  const { instructions }: { instructions: { probe(state: State): void } } =
    await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(code))}`);
  return { execute: instructions.probe, definition };
}

// Exhaust byte-sized operands; wider samples set and clear each individual bit.
function samples(width: number): number[] {
  if (width <= 8) return Array.from({ length: 2 ** width }, (_, value) => value);
  const maximum = 2 ** width - 1;
  return [0, maximum, ...Array.from({ length: width }, (_, position) => [2 ** position, maximum - 2 ** position]).flat()];
}
for (const width of widths) test(`withBits preserves surrounding bits for every supported range in ${width}-bit values`, async () => {
  for (const replacementWidth of widths.filter(bits => bits <= width)) {
    for (let low = 0; low + replacementWidth <= width; low++) {
      const high = low + replacementWidth - 1, expression = `withBits(original, ${high}, ${low}, replacement)`;
      const { execute, definition } = await executable(document(width, replacementWidth, expression));
      for (const a of samples(width)) for (const b of samples(replacementWidth)) {
        const flags = { p: true }, state: State = { a, b, out: 0, flags };
        execute(state);
        // String splicing supplies an independent expectation without masks or shifts.
        const original = a.toString(2).padStart(width, "0"), replacement = b.toString(2).padStart(replacementWidth, "0");
        const expected = original.slice(0, width - high - 1) + replacement + original.slice(width - low);
        assert.equal(state.out, Number.parseInt(expected, 2), `${width}: ${a}, ${high}:${low}, ${b}`);
        assert.equal(state.a, a); assert.equal(state.b, b); assert.equal(state.flags, flags); assert.equal(flags.p, true);
      }
      assert.ok(describeInstruction(definition).includes(`write OUT:u${width} := ${expression}`));
    }
  }
});

test("withBits uses captured inputs and preserves a later explicit read of live state", async () => {
  const text = document(16, 8, "original").replace('family probe "00000000" {', `source low "replace the low byte" (word: 16, byte: 8): 16 {
  return withBits(word, 7, 0, byte)
}
policy sign "sign after high-byte replacement" (word: 16, byte: 8) {
  P = negative(withBits(word, 15, 8, byte))
}
family probe "00000000" {`).replace("  OUT <- original", `  A <- u16($FFFF)
  B <- u8(0)
  withBits = source low(original, replacement)
  OUT <- withBits
  apply sign(original, replacement)
  live = register A
  A <- withBits(live, $0F, $08, replacement)`);
  const { execute, definition } = await executable(text);
  for (const a of [0x1234, 0x8001, 0xffff]) for (const b of [0, 0x5a, 0x80, 0xff]) {
    const state: State = { a, b, out: 0, flags: { p: false } }, events: string[] = [];
    const observed = new Proxy(state, {
      get(target, key, receiver) { if (key === "a" || key === "b") events.push(`read ${key}`); return Reflect.get(target, key, receiver); },
      set(target, key, value, receiver) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value, receiver); },
    });
    execute(observed);
    assert.equal(state.out, Number.parseInt(a.toString(16).padStart(4, "0").slice(0, 2) + b.toString(16).padStart(2, "0"), 16));
    assert.equal(state.a, b * 256 + 255); assert.equal(state.b, 0); assert.equal(state.flags.p, b >= 128);
    assert.deepEqual(events, ["read a", "read b", "write a", "write b", "write out", "read a", "write a"]);
  }
  assert.match(describeInstruction(definition), /P := topBit\(withBits\(original, 15, 8, replacement\)\)/);
});

test("a failed replacement read stops before the write, including full-width replacement", async () => {
  const { execute } = await executable(document(32, 32, "withBits(original, 31, 0, replacement)"));
  const state: State = { a: 0xffffffff, b: 0, out: 0xa5, flags: { p: false } }, events: string[] = [];
  const failure = new Error("replacement unavailable");
  const observed = new Proxy(state, {
    get(target, key, receiver) {
      if (key === "a" || key === "b") events.push(`read ${key}`);
      if (key === "b") throw failure;
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value, receiver); },
  });
  assert.throws(() => execute(observed), error => error === failure);
  assert.deepEqual(events, ["read a", "read b"]); assert.equal(state.out, 0xa5);
});

const invalid: readonly [string, string, RegExp][] = [
  ["out-of-width bounds", "withBits(original, 16, 9, replacement)", /bit range.*high < 16/],
  ["reversed bounds", "withBits(original, 0, 7, replacement)", /bit range/],
  ["negative bound", "withBits(original, 7, -1, replacement)", /Unexpected character/],
  ["fractional bound", "withBits(original, 7.5, 0, replacement)", /Expected ","/],
  ["dynamic bound", "withBits(original, 7, replacement, replacement)", /Expected a decimal number/],
  ["unsupported field width", "withBits(original, 3, 0, replacement)", /expected width 3, 8, 14, 16, or 32/],
  ["replacement too wide", "withBits(original, 2, 0, replacement)", /replacement must have width 3/],
  ["replacement too narrow", "withBits(original, 7, 0, u3(0))", /replacement must have width 8/],
  ["Boolean replacement", "withBits(original, 7, 0, zero(replacement))", /Unknown numeric operation zero/],
  ["uncaptured original", "withBits(missing, 7, 0, replacement)", /has not been captured/],
  ["uncaptured replacement", "withBits(original, 7, 0, missing)", /has not been captured/],
  ["implicit original read", "withBits(register A, 7, 0, replacement)", /Expected ","/],
  ["implicit replacement read", "withBits(original, 7, 0, register B)", /Expected "\)"/],
  ["missing replacement", "withBits(original, 7, 0)", /Expected ","/],
  ["extra argument", "withBits(original, 7, 0, replacement, replacement)", /Expected "\)"/],
];
for (const [name, expression, message] of invalid) test(`withBits rejects ${name} at its source line`, () => {
  const text = document(16, 8, expression), line = text.split("\n").findIndex(line => line.includes("OUT <-")) + 1;
  assert.throws(() => compile(text), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, "with-bits.md"); assert.equal(error.line, line);
    assert.match(error.message, message); return true;
  });
});

test("withBits retains the original width and checks every specialization", async () => {
  const text = document(16, 8, "original").replace('family probe "00000000" {', `source low<bits: 8, 16, 32> "replace low byte" (word: bits, byte: 8): bits {
  return withBits(word, 7, 0, byte)
}
family probe "00000000" {`).replace("  OUT <- original", "  result = source low<16>(original, replacement)\n  OUT <- result");
  const { execute } = await executable(text), state: State = { a: 0x1234, b: 0xab, out: 0, flags: { p: false } };
  execute(state); assert.equal(state.out, 0x12ab);
  assert.throws(() => compile(text.replace("bits: 8, 16, 32", "bits: 8, 16, 32, 3")), /bit range.*high < 3/);
  const simple = document(16, 8, "withBits(original, 7, 0, replacement)");
  assert.throws(() => compile(simple.replace("register OUT: 16", "register OUT: 8")), /expected 8-bit value/);
  assert.throws(() => compile(simple.replace("OUT <-", "selected: flag =")), /Unknown flag operation withBits/);
});

test("serialized replacements cannot bypass range, width, or numeric-type validation", () => {
  const definition = compile(document(32, 8, "withBits(original, 7, 0, replacement)")).families.probe![0]![1];
  const valid = withBits(literal(32, 0xffffffff), 31, 24, literal(8, 0xab));
  const probe = (value: unknown) => ({ ...definition, steps: [{ kind: "capture", name: "field", value }] }) as typeof definition;
  assert.doesNotThrow(() => defineInstruction(probe(valid)));
  for (const bounds of [{ high: 32, low: 25 }, { high: 0, low: 7 }, { high: 7, low: -1 },
    { high: 7.5, low: 0.5 }, { high: NaN, low: 0 }, { high: 7, low: "0" }]) {
    assert.throws(() => validateInstruction(probe({ ...valid, ...bounds })), /bit range/);
  }
  for (const replacement of [literal(3, 7), literal(16, 0xab), literal(32, 0xab)]) {
    assert.throws(() => defineInstruction(probe({ ...valid, replacement })), /replacement must have width 8/);
  }
  for (const field of ["value", "replacement"]) {
    assert.throws(() => validateInstruction(probe({ ...valid, [field]: { kind: "flag-literal", value: true } })), /unknown numeric expression/);
  }
});
