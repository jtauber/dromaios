import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import * as logicModule from "../../../../src/components/cpus/generated/68000-mode-code.js";
import { selectFamily } from "../../../helpers/68000-families.js";
const logicFamily = selectFamily(logicModule, "operandLogic");
const { opcodeInstructions } = logicFamily;
import { logic68000 } from "../../../helpers/68000-families.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import type { InstructionDefinition } from "../../../../src/components/cpus/semantics/model.js";
import type { Cpu68000State } from "../../../../src/components/cpus/semantics/generated/state/68000.js";
import { initialState } from "../../../helpers/68000-state.js";

const file = "src/components/cpus/specifications/68000.md";
const markdown = readFileSync(file, "utf8");
const compile = (text = markdown) => compileCpuChapter(text, { name: "68000" }, file);
const bodies: Readonly<Record<number, unknown>> = opcodeInstructions;

test("all logical production definitions and encodings come from the chapter", () => {
  const chapter = compile();
  const entries = Object.entries(chapter.families).filter(([name]) => name.startsWith("operandLogic")).flatMap(([, entries]) => entries);
  assert.equal(entries.length, 6660);
  assert.deepEqual(entries.map(([opcode]) => opcode).sort((a, b) => a - b), Object.keys(bodies).map(Number));
  const definitions = Object.fromEntries(entries.map(([, definition]) => [definition.name, definition]));
  assert.equal(Object.keys(definitions).length, 906);
  assert.deepEqual(definitions, logic68000);
  for (const definition of Object.values(definitions)) assert.deepEqual(definition.inputs, { mode: 3, code: 3 });
});

test("AND/OR source-EA immediates share bodies with their explicit immediate encodings", () => {
  // Separate literal opcode bases from the chapter's pattern expansion.
  for (const [immediate, sourceEA] of [[0x0000, 0x803c], [0x0200, 0xc03c]]) {
    for (let size = 0; size < 3; size++) for (let register = 0; register < 8; register++) {
      assert.equal(bodies[immediate! + size * 64 + register], bodies[sourceEA! + size * 64 + register * 512]);
    }
  }
});

async function generated(definition: InstructionDefinition) {
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const source = stripTypeScriptTypes(generateInstructions("68000", { run: definition })).replace('"../alu.ts"', JSON.stringify(alu));
  const module: { instructions: { run(state: Cpu68000State, mode: number, code: number): void | "unsupported" } } =
    await import(`data:text/javascript,${encodeURIComponent(source)}`);
  return module.instructions.run;
}

test("one edit to a chapter calculation changes logical results and flags at every width", async () => {
  const changed = markdown.replace("return and(left, right)", "return or(left, right)");
  assert.notEqual(changed, markdown);
  const families = compile(changed).families;
  for (const [width, opcode, left, right, expected] of [
    [8, 0xc001, 0xabcd000f, 0xf0, 0xabcd00ff],
    [16, 0xc041, 0xabcd000f, 0xf000, 0xabcdf00f],
    [32, 0xc081, 0x0f, 0xf0000000, 0xf000000f],
  ] as const) {
    const definition = families[`operandLogic${width}DataData`]!.find(([word]) => word === opcode)![1];
    const run = await generated(definition), state = initialState(127);
    state.d0 = left; state.d1 = right;
    assert.equal(run(state, 0, 1), undefined);
    assert.equal(state.d0, expected);
    assert.deepEqual(state.flags, { x: true, n: true, z: false, v: false, c: false, t: true, s: true });
  }
});

test("editing chapter register fields changes opcode binding without a native catalogue", async () => {
  const before = '"1100 ddd 0 00 000 rrr"', after = '"1100 rrr 0 00 000 ddd"';
  assert.ok(markdown.includes(before));
  const definition = compile(markdown.replace(before, after)).families.operandLogic8DataData!.find(([opcode]) => opcode === 0xc001)![1];
  assert.equal(definition.name, "AND.B D0,D1");
  const run = await generated(definition), state = initialState(0);
  state.d0 = 0xf0; state.d1 = 0x123400a5;
  run(state, 0, 1);
  assert.equal(state.d0, 0xf0); assert.equal(state.d1, 0x123400a0);
  assert.equal(state.flags.n, true); assert.equal(state.flags.z, false);
});

for (const [name, before, after, message] of [
  ["unknown calculation", "with calculation = andValue<8>", "with calculation = missing", /Unknown name missing/],
  ["wrong calculation width", "with calculation = andValue<8>", "with calculation = andValue<16>", /input.*16-bit|must be 16-bit|expected 16/i],
  ["uncaptured calculation argument", "source calculation(destination, sourceValue)", "source calculation(destination, missing)", /not been captured/],
] as const) test(`logical chapter rejects ${name} at its document location`, () => {
  assert.ok(markdown.includes(before));
  assert.throws(() => compile(markdown.replace(before, after)), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, file);
    assert.match(error.message, message); assert.ok(error.line > 0); return true;
  });
});
