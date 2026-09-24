import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { validateFlagPolicy } from "../../../../src/components/cpus/semantics/validate.js";

const document = (bits: number) => `# Bit positions

Each flag observes one captured bit, numbered from the least significant end.

\`\`\`cpu
cpu "probe"
state {
  register A: ${bits}
  register OUT: 8
${Array.from({ length: bits }, (_, position) => `  flag F${position}`).join("\n")}
  flag P
}
policy bits "individual bits" (original: ${bits}) {
${Array.from({ length: bits }, (_, position) => `  F${position} = bit(original, ${position})`).join("\n")}
}
family probe "00000000" {
  original = register A
  apply bits(original)
}
\`\`\``;
const compile = (text: string) => compileCpuChapter(text, {}, "bits.md");
interface State { a: number; out: number; flags: Record<string, boolean> }
async function executable(text: string) {
  const chapter = compile(text), definition = chapter.families.probe![0]![1];
  const code = generateInstructions("probe", { probe: definition });
  const { instructions }: { instructions: { probe(state: State): void } } =
    await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(code))}`);
  return { execute: instructions.probe, definition };
}

// Exhaust narrow values; wider samples set/clear every bit and straddle each boundary.
function samples(bits: number): number[] {
  if (bits <= 8) return Array.from({ length: 2 ** bits }, (_, value) => value);
  const maximum = 2 ** bits - 1;
  return [...new Set([0, maximum, ...Array.from({ length: bits }, (_, position) =>
    [2 ** position - 1, 2 ** position, 2 ** position + 1, maximum - 2 ** position]).flat()])];
}
for (const bits of [3, 8, 14, 16, 32]) test(`bit predicates inspect all ${bits} positions without changing captured state`, async () => {
  const { execute, definition } = await executable(document(bits));
  for (const a of samples(bits)) for (const preserved of [false, true]) {
    const flags: Record<string, boolean> = { p: preserved };
    const state: State = { a, out: 0xa5, flags };
    execute(state);
    // Binary text supplies expectations independently of the generated mask operation.
    const digits = [...a.toString(2).padStart(bits, "0")].reverse();
    assert.deepEqual(flags, { p: preserved, ...Object.fromEntries(digits.map((digit, position) =>
      [`f${position}`, digit === "1"])) }, `${bits}: ${a}`);
    assert.equal(state.a, a); assert.equal(state.out, 0xa5); assert.equal(state.flags, flags);
  }
  const description = describeInstruction(definition);
  assert.match(description, /F0 := bit\(original, 0\)/);
  assert.ok(description.includes(`F${bits - 1} := bit(original, ${bits - 1})`));
});

test("bit predicates compose through Boolean sources, actions, and branches with explicit reads", async () => {
  const text = document(8).replace('family probe "00000000" {', `source highBit "captured high bit" (byte: 8): flag {
  return bit(byte, 7)
}
action remember "use the captured decision" (decision: flag) {
  when decision {
    OUT <- u8($A5)
  }
}
family probe "00000000" {`).replace("  apply bits(original)", `  bit: flag = bit(original, $07)
  selected = source highBit(or(original, u8(0)))
  A <- u8(0)
  perform remember(and(bit, selected))
  apply bits(select(not(bit), u8($55), original))`);
  const { execute } = await executable(text);
  for (const a of [0x00, 0x01, 0x7f, 0x80, 0xff]) {
    const state: State = { a, out: 0, flags: { p: true } }, events: string[] = [];
    const observed = new Proxy(state, {
      get(target, key, receiver) {
        if (key === "a") events.push("read a");
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value, receiver) {
        events.push(`write ${String(key)}`); return Reflect.set(target, key, value, receiver);
      },
    });
    execute(observed);
    assert.deepEqual(events, a >= 128 ? ["read a", "write a", "write out"] : ["read a", "write a"]);
    assert.equal(state.a, 0); assert.equal(state.out, a >= 128 ? 0xa5 : 0);
    assert.equal(state.flags.f0, a >= 128 ? a % 2 === 1 : true);
    assert.equal(state.flags.f7, a >= 128); assert.equal(state.flags.p, true);
  }
});

const invalid: readonly [string, string, RegExp][] = [
  ["out-of-width position", "bit(original, 8)", /bit position.*0 through 7/],
  ["negative position", "bit(original, -1)", /Unexpected character/],
  ["fractional position", "bit(original, 1.5)", /Expected "\)"/],
  ["dynamic position", "bit(original, original)", /Expected a decimal number/],
  ["typed position", "bit(original, u8(1))", /Expected a decimal number/],
  ["missing position", "bit(original)", /Expected ","/],
  ["extra argument", "bit(original, 1, 2)", /Expected "\)"/],
  ["uncaptured value", "bit(missing, 0)", /has not been captured/],
  ["implicit state read", "bit(register A, 0)", /Expected ","/],
  ["Boolean operand", "bit(zero(original), 0)", /Unknown numeric operation zero/],
];
for (const [name, expression, message] of invalid) test(`bit predicates reject ${name} at its source line`, () => {
  const update = `F0 = ${expression}`, text = document(8).replace("F0 = bit(original, 0)", update);
  const line = text.split("\n").findIndex(line => line.trim() === update) + 1;
  assert.throws(() => compile(text), (error: unknown) => {
    assert.ok(error instanceof ChapterError);
    assert.equal(error.file, "bits.md"); assert.equal(error.line, line);
    assert.match(error.message, message); return true;
  });
});

test("bit results are Boolean and positions are checked against every specialized width", () => {
  assert.throws(() => compile(document(8).replace("original = register A", "original = bit(u8(0), 0)")), /Unknown numeric operation bit/);
  for (const bits of [3, 8, 14, 16, 32]) {
    assert.throws(() => compile(document(bits).replace("bit(original, 0)", `bit(original, ${bits})`)), /bit position/);
  }
  const generic = document(8).replace('policy bits "individual bits" (original: 8)',
    'policy bits<width: 8, 16> "individual bits" (original: width)').replace("apply bits(original)", "apply bits<8>(original)");
  assert.doesNotThrow(() => compile(generic));
  assert.throws(() => compile(generic.replace("width: 8, 16", "width: 8, 3")), /bit position.*0 through 2/);
});

test("serialized bit positions cannot bypass width and integer validation", () => {
  const chapter = compile(document(32)), cpu = chapter.families.probe![0]![1].cpu, policy = chapter.policies.bits!;
  for (const position of [-1, 32, 33, 0.5, NaN, Infinity, undefined, "1", true]) {
    const malformed = { ...policy, updates: policy.updates.map(update => ({ ...update, value: { ...update.value, position } })) };
    assert.throws(() => validateFlagPolicy(cpu, malformed as unknown as typeof policy), /bit position.*0 through 31/);
  }
});
