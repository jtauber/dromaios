import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

const compile = (declarations: string) => compileCpuChapter(`Expression grammar probe.
\`\`\`cpu
cpu "probe"
state {
  register OUT: 8
}
${declarations}
family probe "00000000" {
}
\`\`\``, {}, "expressions.md");

test("nested calls distinguish numeric and Boolean grammar, optional carry, and signedness", async () => {
  const cases = [
    ["numeric", 8, "and(or(u8($A0), u8($0F)), xor(u8($FF), u8($33)))", 0x8c],
    ["boolean", "flag", "and(or(0, 1), xor(1, 0))", true],
    ["selected", 8, "select(and(bit(u8($80), 7), not(zero(u8(1)))), add(u8($FF), u8(0), borrow(u8(0), u8(1))), u8($AA))", 0],
    ["carried", "flag", "carry(add(u8($FE), u8(1)), u8(0), not(borrow(u8(1), u8(0))))", true],
    ["defaultProduct", 16, "multiply(u8($FF), u8(2))", 510],
    ["signedProduct", 16, "multiply(u8($FF), u8(2), signed)", 65534],
    ["unsignedProduct", 16, "multiply(u8($FF), u8(2), unsigned)", 510],
  ] as const;
  const chapter = compile(cases.map(([name, type, expression]) => `source ${name} "${name}": ${type} {
  return ${expression}
}`).join("\n") + `
source names "Operation names remain ordinary captures": 8 {
  add = u8($81)
  and: flag = 1
  constructor = u8(1)
  return subtract(add, constructor, and)
}`);
  const definition = chapter.families.probe![0]![1];
  const source = generateInstructions("probe", { probe: definition }, { sources: {
    cpu: definition.cpu, groups: { expressions: chapter.sources },
  } });
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"',
    JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  const module: { sourceReaders(state: { out: number }): { expressions: Record<string, () => number | boolean> } } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const readers = module.sourceReaders({ out: 0 }).expressions;
  for (const [name, , , expected] of cases) assert.equal(readers[name]!(), expected, name);
  assert.equal(readers.names!(), 0x7f);
});

test("operation lookup rejects inherited names and calls of the wrong result type at their document location", () => {
  for (const [type, expression, operation] of [
    [8, "constructor()", "constructor"], [8, "toString()", "toString"],
    ["flag", "constructor()", "constructor"], ["flag", "hasOwnProperty()", "hasOwnProperty"],
    [8, "carry(u8(1), u8(2))", "carry"], ["flag", "add(u8(1), u8(2))", "add"],
  ] as const) {
    assert.throws(() => compile(`source invalid "Invalid call": ${type} {
  return ${expression}
}`), (error: unknown) => {
      assert.ok(error instanceof ChapterError);
      assert.equal(error.file, "expressions.md");
      assert.equal(error.line, 8);
      assert.equal(error.column, `  return ${operation}(`.length + 1);
      assert.match(error.message, new RegExp(`Unknown ${type === "flag" ? "flag" : "numeric"} operation ${operation}\\.`));
      return true;
    });
  }
});

test("shared argument parsing still rejects missing, extra, mistyped, and unseparated arguments", () => {
  for (const [type, expression] of [
    [8, "and(u8(1))"], [8, "and(u8(1), u8(2), u8(3))"], [8, "and(u8(1) u8(2))"],
    ["flag", "and(1)"], ["flag", "not(1, 0)"], ["flag", "carry(u8(1), u8(2), 0, 1)"],
    [8, "add(u8(1), u8(2), u8(1))"], [8, "shiftLeft(u8(1))"], [8, "extend(u8(1))"],
    [16, "multiply(u8(1), u8(2), 1)"], ["flag", "lessThan(u8(1), u8(2))"],
    ["flag", "equal(u8(1), u8(2), signed)"], [8, "withBits(u8(1), 7, 0)"],
  ] as const) {
    assert.throws(() => compile(`source invalid "Invalid arguments": ${type} {
  return ${expression}
}`), (error: unknown) => {
      assert.ok(error instanceof ChapterError, expression);
      assert.equal(error.file, "expressions.md");
      assert.equal(error.line, 8, expression);
      return true;
    });
  }
});
