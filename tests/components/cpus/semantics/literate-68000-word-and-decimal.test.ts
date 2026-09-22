import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { opcodeInstructions as words } from "../../../../src/components/cpus/generated/68000-word-arithmetic.js";
import { opcodeInstructions as decimals } from "../../../../src/components/cpus/generated/68000-decimal.js";
import { wordArithmetic68000, decimal68000 } from "../../../../src/components/cpus/semantics/definitions/68000.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import type { InstructionDefinition } from "../../../../src/components/cpus/semantics/model.js";
import type { Cpu68000AddressContext, OperandAlignmentFault } from "../../../../src/components/cpus/68000-context.js";
import type { Cpu68000State } from "../../../../src/components/cpus/state/68000.js";
import { initialState } from "../../../helpers/68000-state.js";

const file = "src/components/cpus/specifications/68000.md";
const markdown = readFileSync(file, "utf8");
const compile = (text = markdown) => compileCpuChapter(text, { name: "68000" }, file);

test("every production word/decimal definition and encoding comes from the chapter", () => {
  const entries = Object.entries(compile().families).filter(([name]) => name.startsWith("operandWord") || name.startsWith("operandDecimal"))
    .flatMap(([, entries]) => entries);
  assert.equal(entries.length, 2426);
  assert.deepEqual(entries.map(([opcode]) => opcode).sort((a, b) => a - b), Object.keys({ ...words, ...decimals }).map(Number));
  const definitions = Object.fromEntries(entries.map(([, definition]) => [definition.name, definition]));
  assert.equal(Object.keys(definitions).length, 579);
  assert.deepEqual(definitions, { ...wordArithmetic68000, ...decimal68000 });
  for (const definition of Object.values(definitions)) assert.deepEqual(definition.inputs, { mode: 3, code: 3, upperCode: 3 }, definition.name);
});

type Context = Pick<Cpu68000AddressContext, "resolveAddress" | "commitAddressUpdates"> & {
  readByte(address: number): number; writeByte(address: number, byte: number): void;
};
async function generated(definition: InstructionDefinition) {
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const source = stripTypeScriptTypes(generateInstructions("68000", { run: definition })).replace('"../alu.ts"', JSON.stringify(alu));
  const module: { instructions: { run(state: Cpu68000State, mode: number, code: number, upperCode: number,
    context?: Context): void | "unsupported" | "divide-by-zero" | "bounds-check" | OperandAlignmentFault } } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  return module.instructions.run;
}
function edited(before: string, after: string, opcode: number) {
  assert.ok(markdown.includes(before));
  return Object.values(compile(markdown.replace(before, after)).families).flat().find(([word]) => word === opcode)![1];
}

test("editing product signedness changes the full destination and its flags", async () => {
  const run = await generated(edited("return multiply(left, right, signed)", "return multiply(left, right, unsigned)", 0xc1c1)); // MULS.W D1,D0
  const state = initialState(0); state.d0 = 0xffff; state.d1 = 2;
  run(state, 0, 1, 0);
  assert.equal(state.d0, 0x1fffe); assert.equal(state.flags.n, false);
});

test("editing quotient overflow policy changes V without writing the oversized quotient", async () => {
  const run = await generated(edited('policy divisionOverflow "68000 division overflow" () {\n  V = 1',
    'policy divisionOverflow "68000 division overflow" () {\n  V = 0', 0x80c1)); // DIVU.W D1,D0
  const state = initialState(127); state.d0 = 0x10000; state.d1 = 1;
  assert.equal(run(state, 0, 1, 0), undefined);
  assert.equal(state.d0, 0x10000); assert.equal(state.flags.v, false); assert.equal(state.flags.c, false);
  assert.equal(state.flags.n, true); assert.equal(state.flags.z, true);
});

test("editing the signed-bound comparison changes CHK's accepted range", async () => {
  const before = "or(negative(tested), or(negative(sourceWord), borrow(sourceWord, tested)))";
  const run = await generated(edited(before, "negative(tested)", 0x4181)); // CHK.W D1,D0
  const state = initialState(0); state.d0 = 3; state.d1 = 2;
  assert.equal(run(state, 0, 1, 0), undefined);
  assert.equal(state.d0, 3); assert.equal(state.flags.n, false);
});

test("editing decimal correction changes the packed byte and cumulative Z", async () => {
  const run = await generated(edited("add(rawLow, u8(6))", "add(rawLow, u8(0))", 0xc101)); // ABCD D1,D0
  const state = initialState(0); state.d0 = 0x12000009; state.d1 = 1; state.flags.z = true;
  run(state, 0, 1, 0);
  assert.equal(state.d0, 0x1200001a); assert.equal(state.flags.z, false);
});

test("editing cumulative zero changes a zero result after an earlier nonzero byte", async () => {
  const run = await generated(edited('policy decimalZero "68000 decimal zero" (previous: flag, result: 8) {\n  Z = and(previous, zero(result))',
    'policy decimalZero "68000 decimal zero" (previous: flag, result: 8) {\n  Z = zero(result)', 0x4800)); // NBCD D0
  const state = initialState(0); state.d0 = 0;
  run(state, 0, 0, 0);
  assert.equal(state.d0, 0); assert.equal(state.flags.z, true);
});

test("editing the paired destination selector changes the second predecrement", async () => {
  const before = markdown.match(/family operandDecimalPairMemory \([\s\S]+?\n}/)![0];
  const run = await generated(edited(before, before.replace("u3(4), upperCode", "u3(4), code"), 0xc30f)); // ABCD -(A7),-(A1)
  const state = initialState(0), events: unknown[][] = [];
  run(state, 1, 7, 1, {
    resolveAddress(size, mode, code) { events.push(["resolve", size, mode, code]); return code; },
    readByte(address) { events.push(["read", address]); return 0; },
    commitAddressUpdates() { events.push(["commit"]); },
    writeByte(address, byte) { events.push(["write", address, byte]); },
  });
  assert.deepEqual(events, [["resolve", 8, 4, 7], ["read", 7], ["resolve", 8, 4, 7], ["commit"], ["read", 7], ["write", 7, 0]]);
});
