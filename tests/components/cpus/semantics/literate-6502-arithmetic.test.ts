import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import type { Cpu6502State } from "../../../../src/components/cpus/semantics/generated/state/6502.js";

const file = "src/components/cpus/specifications/6502.md", markdown = readFileSync(file, "utf8");
interface Context { fetchByte(): number; readByte(address: number): number; writeByte(address: number, value: number): void }
async function probes(text: string, opcodes: readonly number[]) {
  const chapter = compileCpuChapter(text, { name: "6502" }, file);
  const definitions = Object.fromEntries(Object.values(chapter.families).flat());
  const source = generateInstructions("6502", Object.fromEntries(opcodes.map(code => [code, definitions[code]!])));
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: Record<number, (state: Cpu6502State, context: Context) => void> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return compiled.instructions;
}
function state(a: number, decimal = true): Cpu6502State {
  return { a, x: 1, y: 2, sp: 0xff, pc: 0x200, flags: { n: false, v: false, d: decimal, i: true, z: false, c: false } };
}
const forbidden = () => { assert.fail("Unexpected memory access"); };

test("decimal corrections and overflow flags change when their chapter expressions change", async () => {
  for (const [opcode, before, after, a, byte, carry, field, expected] of [
    [0x69, "add(low, u16($06))", "add(low, u16($05))", 0x09, 1, false, "a", [0x10, 0x1f]],
    [0xe9, "subtract(low, u16($06))", "subtract(low, u16($05))", 0x00, 1, true, "a", [0x99, 0x9a]],
    [0x69, "addOverflow(left, right, carry)", "carry(left, right, carry)", 0x7f, 1, false, "v", [true, false]],
    [0xe9, "overflow(left, right, not(carry))", "borrow(left, right, not(carry))", 0x80, 1, true, "v", [true, false]],
  ] as const) {
    assert.ok(markdown.includes(before));
    for (const changed of [false, true]) {
      const execute = await probes(changed ? markdown.replace(before, after) : markdown, [opcode]);
      const current = state(a, field === "a"); current.flags.c = carry;
      execute[opcode]!(current, { fetchByte: () => byte, readByte: forbidden, writeByte: forbidden });
      assert.equal(field === "a" ? current.a : current.flags.v, expected[Number(changed)], `${before}, changed=${changed}`);
      assert.equal(current.flags.d, field === "a"); assert.equal(current.flags.i, true);
    }
  }
});

test("the memory rotation's original write and post-write N/Z rule come from the chapter", async () => {
  const before = "  memory(address) <- original\n  carry = flag C\n  result = shiftLeft(original, carry)";
  assert.ok(markdown.includes(before));
  const after = "  carry = flag C\n  result = shiftLeft(original, carry)";
  for (const changed of [false, true]) {
    const execute = await probes(changed ? markdown.replace(before, after) : markdown, [0x26]);
    const current = state(0x45), writes: number[] = [];
    execute[0x26]!(current, {
      fetchByte: () => 0xff, readByte: address => { assert.equal(address, 0xff); return 0x80; },
      writeByte(address, byte) { assert.equal(address, 0xff); writes.push(byte); current.flags.c = true; },
    });
    // The original write changes incoming C before ROL captures it.
    assert.deepEqual(writes, changed ? [0] : [0x80, 1]);
    assert.equal(current.flags.z, changed); assert.equal(current.a, 0x45);
  }
  const execute = await probes(markdown, [0x26]);
  const current = state(0x45), failure = new Error("result write failed"); let writes = 0;
  assert.throws(() => execute[0x26]!(current, {
    fetchByte: () => 0xff, readByte: () => 0x80,
    writeByte() { if (++writes === 2) throw failure; },
  }), error => error === failure);
  assert.equal(writes, 2);
  assert.deepEqual(current.flags, { n: false, v: false, d: true, i: true, z: false, c: true });
});

test("overflow predicates retain width, incoming-bit, and document-location checks", () => {
  for (const [before, after, message] of [
    ["addOverflow(left, right, carry)", "addOverflow(left, extend(right, 16), carry)", /equal widths/],
    ["overflow(left, right, not(carry))", "overflow(left, right, left)", /flag left has not been captured/],
    ["addOverflow(left, right, carry)", "addOverflow(left, right, missing)", /flag missing has not been captured/],
    ["overflow(left, right, not(carry))", "overflow(left, right, not(carry), 0)", /Expected/],
  ] as const) {
    const changed = markdown.replace(before, after);
    const line = markdown.slice(0, markdown.indexOf(before)).split("\n").length;
    assert.throws(() => compileCpuChapter(changed, { name: "6502" }, file), (error: unknown) => {
      assert.ok(error instanceof ChapterError); assert.equal(error.line, line); assert.equal(error.file, file);
      assert.match(error.message, message); return true;
    });
  }
});

test("literate signed-overflow predicates work at byte, word, and long widths with optional incoming bits", async () => {
  for (const bits of [8, 16, 32]) {
    const chapter = compileCpuChapter(`Compare the mathematical signed result with the range at each width.

\`\`\`cpu
cpu "probe"
state {
  register L: ${bits}
  register R: ${bits}
  flag C
  flag V
}
policy ADD "sum overflow" (left: ${bits}, right: ${bits}, carry: flag) {
  V = addOverflow(left, right, carry)
}
policy SUB "difference overflow" (left: ${bits}, right: ${bits}) {
  V = overflow(left, right)
}
family add "00000000" {
  left = register L
  right = register R
  carry = flag C
  apply ADD(left, right, carry)
}
family subtract "00000001" {
  left = register L
  right = register R
  apply SUB(left, right)
}
\`\`\``, { name: "probe" }, "overflow.md");
    const source = generateInstructions("probe", Object.fromEntries(Object.values(chapter.families).flat()));
    const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
    const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
    type State = { l: number; r: number; flags: { c: boolean; v: boolean } };
    const compiled: { instructions: Record<number, (state: State) => void> } = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
    const half = 2 ** (bits - 1), modulus = 2 ** bits;
    const signed = (value: number) => value < half ? value : value - modulus;
    for (const l of [0, 1, half - 1, half, modulus - 1]) for (const r of [0, 1, half - 1, half, modulus - 1]) {
      for (const c of [false, true]) for (const opcode of [0, 1]) {
        const exact = opcode === 0 ? signed(l) + signed(r) + Number(c) : signed(l) - signed(r);
        const current = { l, r, flags: { c, v: false } }; compiled.instructions[opcode]!(current);
        assert.deepEqual(current, { l, r, flags: { c, v: exact < -half || exact >= half } });
      }
    }
  }
});
