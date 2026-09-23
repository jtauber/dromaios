import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { validateFlagPolicy } from "../../../../src/components/cpus/semantics/validate.js";

const document = (bits: number) => `# Numeric comparisons

Equality compares bits; ordering states their interpretation.

\`\`\`cpu
cpu "probe"
state {
  register A: ${bits}
  register B: ${bits}
  flag E
  flag U
  flag S
  flag P
}
policy comparison "numeric relations" (left: ${bits}, right: ${bits}) {
  E = equal(left, right)
  U = lessThan(left, right, unsigned)
  S = lessThan(left, right, signed)
}
family compare "00000000" {
  left = register A
  right = register B
  apply comparison(left, right)
}
\`\`\``;

const compile = (text: string) => compileCpuChapter(text, {}, "comparisons.md");
interface State { a: number; b: number; flags: { e: boolean; u: boolean; s: boolean; p: boolean } }

async function executable(text: string) {
  const chapter = compile(text), definition = chapter.families.compare![0]![1];
  const code = generateInstructions("probe", { compare: definition });
  const { instructions }: { instructions: { compare(state: State): void } } =
    await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(code))}`);
  return { compare: instructions.compare, definition };
}

// Exhaust narrow operands; wider samples straddle every bit boundary, including
// both signed endpoints and unsigned values above JavaScript's signed word range.
function operands(bits: number): number[] {
  if (bits <= 8) return Array.from({ length: 2 ** bits }, (_, index) => index);
  const limit = 2 ** bits;
  return [...new Set([0, limit - 1, ...Array.from({ length: bits }, (_, bit) =>
    [2 ** bit - 1, 2 ** bit, 2 ** bit + 1]).flat()])];
}

for (const bits of [3, 8, 14, 16, 32]) test(`${bits}-bit comparisons use equal-width values and explicit signedness`, async () => {
  const { compare } = await executable(document(bits));
  const samples = operands(bits);
  for (const a of samples) for (const b of samples) {
    const flags = { e: false, u: false, s: false, p: true };
    const state: State = { a, b, flags };
    compare(state);
    assert.deepEqual(flags, {
      e: a === b, u: a < b,
      s: BigInt.asIntN(bits, BigInt(a)) < BigInt.asIntN(bits, BigInt(b)), p: true,
    }, `${bits}: ${a}, ${b}`);
    assert.equal(state.a, a); assert.equal(state.b, b);
    assert.equal(state.flags, flags);
  }
});

test("comparisons compose with numeric expressions and preserve explicit state reads", async () => {
  const text = document(32).replace("  apply comparison(left, right)", `  A <- u32(0)
  when not(equal(left, right)) {
    B <- select(lessThan(left, right, signed), left, right)
  }
  apply comparison(and(left, u32($FFFFFFFF)), or(right, u32(0)))`);
  const { compare, definition } = await executable(text);
  const events: string[] = [], state: State = { a: 0x80000000, b: 0x7fffffff, flags: { e: true, u: true, s: false, p: false } };
  const observed = new Proxy(state, {
    get(target, key, receiver) {
      if (key === "a" || key === "b") events.push(`read ${key}`);
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      if (key === "a" || key === "b") events.push(`write ${key}`);
      return Reflect.set(target, key, value, receiver);
    },
  });
  compare(observed);
  assert.deepEqual(events, ["read a", "read b", "write a", "write b"]);
  assert.deepEqual(state, { a: 0, b: 0x80000000, flags: { e: false, u: false, s: true, p: false } });
  const description = describeInstruction(definition);
  assert.match(description, /equal\(left, right\)/);
  assert.match(description, /lessThan\(left, right, signed\)/);
  assert.match(description, /lessThan\(.+, unsigned\)/);
});

const invalid: readonly [string, string, RegExp][] = [
  ["equality width", "equal(left, u16(0))", /equal widths/],
  ["ordering width", "lessThan(left, u16(0), signed)", /equal widths/],
  ["missing signedness", "lessThan(left, right)", /Expected ","/],
  ["invalid signedness", "lessThan(left, right, native)", /signed or unsigned/],
  ["equality signedness", "equal(left, right, signed)", /Expected "\)"/],
  ["extra argument", "lessThan(left, right, signed, 0)", /Expected "\)"/],
  ["uncaptured operand", "equal(left, missing)", /has not been captured/],
  ["implicit state read", "equal(left, register A)", /Expected "\)"/],
  ["flag operand", "equal(left, zero(right))", /Unknown numeric operation zero/],
];
for (const [name, expression, message] of invalid) test(`comparisons reject ${name} at the source line`, () => {
  const update = `E = ${expression}`, text = document(8).replace("E = equal(left, right)", update);
  const line = text.split("\n").findIndex(line => line.trim() === update) + 1;
  assert.throws(() => compile(text), (error: unknown) => {
    assert.ok(error instanceof ChapterError);
    assert.equal(error.file, "comparisons.md"); assert.equal(error.line, line);
    assert.match(error.message, message); return true;
  });
});

test("comparison results remain Boolean and serialized ordering requires signedness", () => {
  assert.throws(() => compile(document(8).replace("left = register A", "left = equal(u8(0), u8(0))")), /Unknown numeric operation equal/);
  const chapter = compile(document(8));
  const cpu = chapter.families.compare![0]![1].cpu, policy = chapter.policies.comparison!;
  for (const signed of [undefined, "signed", 0]) {
    const malformed = { ...policy, updates: policy.updates.map(update => update.value.kind === "less-than"
      ? { ...update, value: { ...update.value, signed } } : update) };
    // External serialized data must be checked even when it bypasses TypeScript.
    assert.throws(() => validateFlagPolicy(cpu, malformed as unknown as typeof policy), /signedness must be Boolean/);
  }
});
