import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { checkByteExecution } from "../../../../src/components/cpus/semantics/literate/execution.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

function compile(body: string) {
  return compileCpuChapter(`Bounded operations preserve ordered effects and explicit outcomes.

\`\`\`cpu
cpu "probe"
state {
  register A: 8
  register B: 8
  register W: 16
}
${body}
\`\`\``, {}, "iteration.md");
}
type State = { a: number; b: number; w: number };
type Context = { readByte(address: number): number; writeByte(address: number, byte: number): void };
async function executable(body: string) {
  const chapter = compile(body), definitions = Object.fromEntries(Object.values(chapter.families).flat());
  const source = generateInstructions("probe", definitions);
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  const module: { instructions: Record<number, (state: State, context: Context) => "arithmetic" | "stop" | void> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return { ...module, source, chapter };
}
const loop = `action advance "repeat memory effects" (count: 8) using memory {
  result = iterate(count, u8(250)) {
    next = add(result, u8(1))
    memory(u16(10)) <- next
    A <- next
    return next
  }
  B <- result
}
family run "00000000" {
  count = register A
  perform advance(count)
}`;

test("chapter iteration captures its count, retains zero-count initial values, and executes all 255 effects in order", async () => {
  const { instructions, source, chapter } = await executable(loop);
  assert.match(source, /writeByte/); // Memory inside iteration contributes the action's capability.
  checkByteExecution(chapter.families.run![0]![1].steps);
  for (const count of [0, 1, 8, 32, 255]) {
    const state = { a: count, b: 0, w: 0 }, writes: number[] = [];
    instructions[0]!(state, { readByte() { assert.fail(); }, writeByte(address, byte) {
      assert.equal(address, 10); writes.push(byte); state.a = 0;
    } });
    assert.deepEqual(writes, Array.from({ length: count }, (_, i) => (251 + i) % 256));
    assert.equal(state.a, count ? (250 + count) % 256 : 0);
    assert.equal(state.b, (250 + count) % 256);
  }
  const state = { a: 8, b: 99, w: 0 }, failure = new Error("third write"), writes: number[] = [];
  assert.throws(() => instructions[0]!(state, { readByte() { assert.fail(); }, writeByte(_address, byte) {
    if (writes.length === 2) throw failure;
    writes.push(byte);
  } }), error => error === failure);
  assert.deepEqual(writes, [251, 252]); assert.deepEqual(state, { a: 252, b: 99, w: 0 });
});

const division = (mode: "signed" | "unsigned") => `family divideBytes "00000000" {
  dividend = register W
  divisor = register B
  quotient, remainder = divide(dividend, divisor, ${mode}) otherwise "arithmetic"
  A <- quotient
  B <- remainder
}
family product "00000001" {
  left = register A
  right = register B
  W <- multiply(left, right, ${mode})
}`;

test("chapter multiplication and division distinguish signed values and reject zero/overflow before writes", async () => {
  for (const mode of ["signed", "unsigned"] as const) {
    const { instructions } = await executable(division(mode));
    const context = { readByte() { assert.fail(); }, writeByte() { assert.fail(); } };
    for (const dividend of [0, 1, 127, 128, 255, 256, 32767, 32768, 65535]) for (const divisor of [0, 1, 2, 127, 128, 255]) {
      const signed = mode === "signed", left = signed && dividend >= 32768 ? dividend - 65536 : dividend;
      const right = signed && divisor >= 128 ? divisor - 256 : divisor;
      const quotient = Math.trunc(left / right), invalid = right === 0 || quotient < (signed ? -128 : 0) || quotient > (signed ? 127 : 255);
      const state = { a: 77, b: divisor, w: dividend }, before = { ...state };
      assert.equal(instructions[0]!(state, context), invalid ? "arithmetic" : undefined);
      assert.deepEqual(state, invalid ? before : { a: (quotient + 256) % 256, b: (left % right + 256) % 256, w: dividend });
    }
    const state = { a: 255, b: 2, w: 0 };
    instructions[1]!(state, context); assert.equal(state.w, mode === "signed" ? 65534 : 510);
  }
});

test("a third division result reports overflow while zero still returns before subsequent effects", async () => {
  for (const mode of ["signed", "unsigned"] as const) {
    const body = division(mode).replace("quotient, remainder =", "quotient, remainder, tooLarge =")
      .replace("  A <- quotient\n  B <- remainder", `  when not(tooLarge) {
    A <- quotient
    B <- remainder
  }
  W <- select(tooLarge, u16(1), u16(0))`);
    const { instructions } = await executable(body);
    for (const dividend of [0, 1, 127, 128, 255, 256, 32767, 32768, 65535]) for (const divisor of [0, 1, 2, 127, 128, 255]) {
      const state = { a: 77, b: divisor, w: dividend }, before = { ...state };
      const result = instructions[0]!(state, { readByte() { assert.fail(); }, writeByte() { assert.fail(); } });
      if (divisor === 0) { assert.equal(result, "arithmetic"); assert.deepEqual(state, before); continue; }
      const signed = mode === "signed", left = signed ? BigInt.asIntN(16, BigInt(dividend)) : BigInt(dividend);
      const right = signed ? BigInt.asIntN(8, BigInt(divisor)) : BigInt(divisor), quotient = left / right;
      const overflow = quotient < (signed ? -128n : 0n) || quotient > (signed ? 127n : 255n);
      assert.equal(result, undefined);
      assert.deepEqual(state, overflow ? { ...before, w: 1 } : {
        a: Number(BigInt.asUintN(8, quotient)), b: Number(BigInt.asUintN(8, left % right)), w: 0,
      });
    }
  }
});

test("named rejection exits nested iteration immediately, preserving earlier effects", async () => {
  const { instructions, chapter } = await executable(`family stop "00000000" {
  result = iterate(u8(3), u8(0)) {
    A <- result
    reject "stop" if zero(subtract(result, u8(1)))
    return add(result, u8(1))
  }
  B <- result
}`);
  const state = { a: 9, b: 9, w: 0 };
  assert.equal(instructions[0]!(state, { readByte() { assert.fail(); }, writeByte() { assert.fail(); } }), "stop");
  assert.deepEqual(state, { a: 1, b: 9, w: 0 });
  assert.throws(() => checkByteExecution(chapter.families.stop![0]![1].steps), /does not support reject/);
  assert.throws(() => checkByteExecution(compile(division("signed")).families.divideBytes![0]![1].steps), /does not support divide/);
});

test("bounded operations reject wrong widths, escaped locals, invalid outcomes, and forbidden source/action effects at chapter locations", () => {
  const invalid = [
    loop.replace('iterate(count, u8(250))', 'iterate(u16(1), u8(250))'),
    loop.replace('return next', 'return u16(1)'),
    loop.replace('return next', 'return missing'),
    loop.replace('return next', 'A <- next'),
    loop.replace('B <- result', 'B <- next'),
    loop.replace('next = add(result, u8(1))', 'count = u8(0)'),
    loop.replace(' using memory', ''),
    loop.replace('memory(u16(10)) <- next', 'byte = fetch'),
    division('signed').replace('dividend, divisor, signed', 'divisor, divisor, signed'),
    division('signed').replace('dividend, divisor, signed', 'dividend, divisor, maybe'),
    division('signed').replace('quotient, remainder', 'quotient, quotient'),
    division('signed').replace('quotient, remainder', 'quotient, remainder, quotient'),
    division('signed').replace('quotient, remainder', 'quotient, remainder, flag, extra'),
    division('signed').replace('quotient, remainder', 'quotient, remainder, flag').replace('A <- quotient', 'A <- flag'),
    division('signed').replace('quotient, remainder', 'quotient, remainder, dividend'),
    `source invalid "cannot divide with overflow": 8 {\n  q, r, overflow = divide(u16(1), u8(1), unsigned) otherwise "stop"\n  return q\n}`,
    division('signed').replace('"arithmetic"', '"bad outcome"'),
    `action invalid "cannot return named outcomes" {\n  reject "stop"\n}`,
    `source invalid "cannot divide with an outcome": 8 {\n  q, r = divide(u16(1), u8(1), unsigned) otherwise "stop"\n  return q\n}`,
    `view invalid "cannot write through a loop": 8 {\n  result = iterate(u8(1), u8(0)) {\n    A <- result\n    return result\n  }\n  return result\n}`,
  ];
  for (const body of invalid) assert.throws(() => compile(body), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, "iteration.md"); assert.ok(error.line >= 10);
    return true;
  }, body);
});
