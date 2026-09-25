import assert from "node:assert/strict";
import { test } from "node:test";
import { expressionEmitter } from "../../../../src/components/cpus/semantics/generate-expressions.js";
import type { EmittedValue } from "../../../../src/components/cpus/semantics/generate-expressions.js";
import { addWrap, flagValue, literal, shiftRight, value, zero } from "../../../../src/components/cpus/semantics/model.js";

test("one expression emitter respects each capture scope's widths and flags without changing its bindings", async () => {
  const helpers = new Set<string>(), emitter = expressionEmitter(helpers);
  const expression = shiftRight(value("input"), flagValue("carry"));
  const byte = new Map<string, EmittedValue>([["input", { code: "n", type: 8 }], ["carry", { code: "incoming", type: "flag" }]]);
  const long = new Map(byte); long.set("input", { code: "n", type: 32 });
  const before = [[...byte], [...long]];
  const byteResult = emitter.typed(expression, undefined, byte);
  const longResult = emitter.number(expression, long);
  const flagResult = emitter.typed(zero(value("input")), "flag", byte);
  assert.equal(byteResult.type, 8); assert.equal(longResult.type, 32); assert.equal(flagResult.type, "flag");
  assert.deepEqual(emitter.number(expression, byte), byteResult);
  assert.deepEqual([[...byte], [...long]], before);
  assert.deepEqual([...helpers], ["shiftRight"]);

  const source = `import { shiftRight } from ${JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href)};
    export const byte = (n, incoming) => ${byteResult.code};
    export const long = (n, incoming) => ${longResult.code};
    export const zero = n => ${flagResult.code};`;
  const compiled: { byte(n: number, incoming: boolean): number; long(n: number, incoming: boolean): number; zero(n: number): boolean } =
    await import(`data:text/javascript,${encodeURIComponent(source)}`);
  assert.equal(compiled.byte(0x80, false), 0x40);
  assert.equal(compiled.byte(0x80, true), 0xc0);
  assert.equal(compiled.long(0x80000000, false), 0x40000000);
  assert.equal(compiled.long(0x80000000, true), 0xc0000000);
  assert.equal(compiled.zero(0), true); assert.equal(compiled.zero(0x80), false);
});

test("ALU dependencies belong to the current module, and rendering records imports without evaluating expressions", () => {
  const firstImports = new Set<string>(), secondImports = new Set<string>();
  const first = expressionEmitter(firstImports), second = expressionEmitter(secondImports);
  // These are symbolic generated names; no runtime values or CPU instance exist during emission.
  const scope = new Map<string, EmittedValue>([["input", { code: "notYetExecuted", type: 8 }]]);
  first.number(addWrap(value("input"), literal(8, 1)), scope);
  assert.deepEqual([...firstImports], ["add"]); assert.equal(secondImports.size, 0);
  second.flag(zero(value("input")), scope);
  assert.equal(secondImports.size, 0);
  second.number(shiftRight(value("input"), zero(value("input"))), scope);
  assert.deepEqual([...secondImports], ["shiftRight"]);
  assert.deepEqual([...firstImports], ["add"]);
});
