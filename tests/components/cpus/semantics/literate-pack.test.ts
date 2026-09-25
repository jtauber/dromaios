import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { defineInstruction, validateInstruction } from "../../../../src/components/cpus/semantics/validate.js";

const packed = (bits: number) => `pack<${bits}>(${Array.from({ length: bits }, (_, index) => `f${bits - index - 1}`).join(", ")})`;
const document = (bits: number) => `# Packed bits

Reads proceed from low to high; packing lists the resulting bits high to low.

\`\`\`cpu
cpu "probe"
state {
  register A: 8
  register OUT: ${bits}
${Array.from({ length: bits }, (_, position) => `  flag F${position}`).join("\n")}
}
family probe "00000000" {
${Array.from({ length: bits }, (_, position) => `  f${position} = flag F${position}`).join("\n")}
  OUT <- ${packed(bits)}
}
\`\`\``;
const compile = (text: string) => compileCpuChapter(text, {}, "pack.md");
interface State { a: number; out: number; flags: Record<string, boolean> }
async function executable(text: string) {
  const definition = compile(text).families.probe![0]![1];
  const code = generateInstructions("probe", { probe: definition });
  const { instructions }: { instructions: { probe(state: State): void } } =
    await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(code))}`);
  return { execute: instructions.probe, definition };
}

// Exhaust small layouts; wide layouts exercise each set/clear bit and the unsigned limit.
for (const bits of [3, 8, 14, 16, 32]) test(`pack<${bits}> lists flags most significant first and returns an unsigned value`, async () => {
  const { execute, definition } = await executable(document(bits)), maximum = 2 ** bits - 1;
  const samples = bits <= 8 ? Array.from({ length: maximum + 1 }, (_, value) => value)
    : [0, maximum, ...Array.from({ length: bits }, (_, position) => [2 ** position, maximum - 2 ** position]).flat()];
  for (const expected of samples) {
    const digits = [...expected.toString(2).padStart(bits, "0")].reverse();
    const flags = Object.fromEntries(digits.map((digit, position) => [`f${position}`, digit === "1"]));
    const original = { ...flags }, state: State = { a: 0xa5, out: 0, flags };
    execute(state);
    assert.equal(state.out, expected); assert.equal(state.a, 0xa5);
    assert.equal(state.flags, flags); assert.deepEqual(flags, original);
  }
  assert.ok(describeInstruction(definition).includes(`write OUT:u${bits} := ${packed(bits)}`));
});

test("packing composes with predicates, fixed bits, sources, and policies without rereading flags", async () => {
  const text = document(8).replace('family probe "00000000" {', `policy clear "clear the original flag" () {
  F0 = 0
}
source status "captured inputs" (low: flag, high: flag, byte: 8): 8 {
  return pack<8>(high, 0, not(high), bit(byte, 3), 0, 1, high, low)
}
policy selected "packed policy inputs" (low: flag, high: flag) {
  F1 = bit(pack<3>(low, high, 1), 2)
}
family probe "00000000" {`).replace(`  OUT <- ${packed(8)}`, `  original = register A
  apply clear()
  A <- u8(0)
  pack = source status(f0, f7, original)
  OUT <- pack
  apply selected(f0, f7)`);
  const { execute, definition } = await executable(text);
  for (const low of [false, true]) for (const high of [false, true]) for (const a of [0, 8]) {
    const events: string[] = [], flags = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${i}`, i === 0 ? low : high]));
    const state: State = { a, out: 0, flags: new Proxy(flags, {
      get(target, key, receiver) { events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver); },
      set(target, key, value, receiver) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value, receiver); },
    }) };
    execute(state);
    assert.deepEqual(events, [...Array.from({ length: 8 }, (_, i) => `read f${i}`), "write f0", "write f1"]);
    // Independently written bit strings specify the required layout.
    assert.equal(state.out, Number.parseInt(`${+high}0${+!high}${a ? 1 : 0}01${+high}${+low}`, 2));
    assert.equal(state.a, 0); assert.equal(flags.f0, false); assert.equal(flags.f1, low);
  }
  assert.match(describeInstruction(definition), /F1 := bit\(pack<3>\(f0, f7, 1:flag\), 2\)/);
});

test("packing does not move a failing flag read past the destination write", async () => {
  const { execute } = await executable(document(8));
  const events: string[] = [], failure = new Error("flag unavailable");
  const state: State = { a: 0, out: 0xa5, flags: new Proxy({}, {
    get(_target, key) { events.push(String(key)); if (key === "f2") throw failure; return true; },
  }) };
  assert.throws(() => execute(state), error => error === failure);
  assert.deepEqual(events, ["f0", "f1", "f2"]); assert.equal(state.out, 0xa5);
});

const invalid: readonly [string, string, RegExp][] = [
  ["too few bits", "pack<3>(0, 1)", /pack requires exactly 3 flag expressions/],
  ["too many bits", "pack<3>(0, 1, 0, 1)", /pack requires exactly 3 flag expressions/],
  ["empty bits", "pack<3>()", /pack requires exactly 3 flag expressions/],
  ["unsupported width", "pack<4>(0, 0, 0, 0)", /Expected width 3, 8, 14, 16, or 32/],
  ["missing width", "pack(0, 0, 0)", /Unknown numeric operation pack/],
  ["uncaptured flag", "pack<3>(0, missing, 0)", /has not been captured/],
  ["numeric capture", "pack<3>(0, byte, 0)", /flag byte has not been captured/],
  ["numeric literal", "pack<3>(0, u8(1), 0)", /Unknown flag operation u8/],
  ["implicit state read", "pack<3>(0, flag F0, 0)", /Expected "\)"/],
  ["spelled Boolean", "pack<3>(0, true, 0)", /Write flag literals as 0 or 1/],
  ["trailing comma", "pack<3>(0, 1, 0,)", /Expected a name/],
  ["implicit widening", "pack<8>(0, 0, 0, 0, 0, 0, 0, 1)", /expected 3-bit value/],
];
for (const [name, expression, message] of invalid) test(`packing rejects ${name} at its source line`, () => {
  const update = `OUT <- ${expression}`, text = document(3).replace(`OUT <- ${packed(3)}`, `byte = register A\n  ${update}`);
  const line = text.split("\n").findIndex(line => line.trim() === update) + 1;
  assert.throws(() => compile(text), (error: unknown) => {
    assert.ok(error instanceof ChapterError);
    assert.equal(error.file, "pack.md"); assert.equal(error.line, line);
    assert.match(error.message, message); return true;
  });
});

test("packing checks every specialized width, including unused definitions", async () => {
  const text = document(3).replace('family probe "00000000" {', `source packed<bits: 3> "specialized layout": bits {
  return pack<bits>(1, 0, 1)
}
family probe "00000000" {`).replace(`  OUT <- ${packed(3)}`, "  result = source packed<3>\n  OUT <- result");
  const { execute } = await executable(text), state: State = { a: 0, out: 0, flags: {} };
  execute(state); assert.equal(state.out, 5);
  assert.throws(() => compile(text.replace("bits: 3", "bits: 3, 8")), /pack requires exactly 8 flag expressions/);
  assert.throws(() => compile(document(3).replace(`OUT <- ${packed(3)}`, "selected: flag = pack<3>(0, 0, 0)")));
});

test("serialized packs cannot bypass width, arity, or flag validation", () => {
  const definition = compile(document(3)).families.probe![0]![1];
  for (const value of [
    { kind: "pack", width: 4, bits: [] },
    { kind: "pack", width: 3, bits: [] },
    { kind: "pack", width: 3, bits: null },
    { kind: "pack", width: 3, bits: [{ kind: "literal", width: 3, value: 1 }, { kind: "flag-literal", value: true }, { kind: "flag-literal", value: false }] },
    { kind: "pack", width: 3, bits: Array(3) },
  ]) {
    const malformed = { ...definition, steps: [{ kind: "capture", name: "packed", value }] } as unknown as typeof definition;
    assert.throws(() => validateInstruction(malformed));
    assert.throws(() => defineInstruction(malformed));
  }
});
