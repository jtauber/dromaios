import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { opcodeInstructions } from "../../../../src/components/cpus/generated/68000-arithmetic.js";
import { arithmetic68000 } from "../../../../src/components/cpus/semantics/definitions.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import type { InstructionDefinition } from "../../../../src/components/cpus/semantics/model.js";
import type { Cpu68000AddressContext, OperandAlignmentFault } from "../../../../src/components/cpus/68000-context.js";
import type { Cpu68000State } from "../../../../src/components/cpus/state/68000.js";
import { initialState } from "../../../helpers/68000-state.js";

const file = "src/components/cpus/specifications/68000.md";
const markdown = readFileSync(file, "utf8");
const compile = (text = markdown) => compileCpuChapter(text, { name: "68000" }, file);
const bodies: Readonly<Record<number, unknown>> = opcodeInstructions;

test("all arithmetic production definitions and raw-field bindings come from the chapter", () => {
  const chapter = compile();
  const entries = Object.entries(chapter.families).filter(([name]) => name.startsWith("operandArithmetic")).flatMap(([, entries]) => entries);
  assert.equal(entries.length, 13510);
  assert.deepEqual(entries.map(([opcode]) => opcode).sort((a, b) => a - b), Object.keys(bodies).map(Number));
  const definitions = Object.fromEntries(entries.map(([, definition]) => [definition.name, definition]));
  assert.equal(Object.keys(definitions).length, 2678);
  assert.deepEqual(Object.keys(definitions).sort(), Object.keys(arithmetic68000).sort());
  for (const [name, definition] of Object.entries(definitions)) {
    assert.deepEqual(definition, arithmetic68000[name], name);
    assert.deepEqual(definition.inputs, { mode: 3, code: 3, upperCode: 3 }, name);
  }
});

test("arithmetic immediate and quick literals select shared bodies", () => {
  // Independent literal opcode bases; neither the chapter nor native inventories supply them.
  for (const [immediate, sourceEA] of [[0x0400, 0x903c], [0x0600, 0xd03c], [0x0c00, 0xb03c]]) {
    for (let size = 0; size < 3; size++) for (let register = 0; register < 8; register++) {
      assert.equal(bodies[immediate! + size * 64 + register], bodies[sourceEA! + size * 64 + register * 512]);
    }
  }
  for (let opcode = 0x5000; opcode < 0x5200; opcode++) if (bodies[opcode]) {
    for (let amount = 1; amount < 8; amount++) assert.equal(bodies[opcode], bodies[opcode + amount * 512]);
  }
});

type Context = Pick<Cpu68000AddressContext, "resolveAddress" | "commitAddressUpdates"> & { readByte(address: number): number };
async function generated(definition: InstructionDefinition) {
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const source = stripTypeScriptTypes(generateInstructions("68000", { run: definition })).replace('"../alu.ts"', JSON.stringify(alu));
  const module: { instructions: { run(state: Cpu68000State, mode: number, code: number, upperCode: number,
    context?: Context): void | "unsupported" | OperandAlignmentFault } } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  return module.instructions.run;
}
function edited(before: string, after: string, opcode: number) {
  assert.ok(markdown.includes(before));
  const entries = Object.values(compile(markdown.replace(before, after)).families).flat();
  return entries.find(([word]) => word === opcode)![1];
}

test("editing the arithmetic calculation changes generated execution", async () => {
  const run = await generated(edited("result = add(left, right)", "result = subtract(left, right)", 0xd001));
  const state = initialState(0); state.d0 = 0xabcd0005; state.d1 = 3;
  assert.equal(run(state, 0, 1, 0), undefined);
  assert.equal(state.d0, 0xabcd0002);
});

test("editing a chapter X policy changes X independently of carry", async () => {
  const run = await generated(edited("X = carry(left, right, incoming)", "X = 0", 0xd001));
  const state = initialState(0); state.d0 = 0xff; state.d1 = 1;
  run(state, 0, 1, 0);
  assert.equal(state.d0, 0); assert.equal(state.flags.c, true); assert.equal(state.flags.x, false);
});

test("editing cumulative zero reaches extended arithmetic", async () => {
  const run = await generated(edited("Z = and(previous, zero(result))", "Z = zero(result)", 0xd101));
  const state = initialState(0); state.d0 = 0; state.d1 = 0;
  run(state, 0, 1, 0);
  assert.equal(state.flags.z, true);
});

test("quick zero means eight because the chapter says so", async () => {
  const run = await generated(edited("select(zero(upperCode), u8(8), extend(upperCode, 8))",
    "select(zero(upperCode), u8(1), extend(upperCode, 8))", 0x5000));
  const state = initialState(0); state.d0 = 10;
  run(state, 0, 0, 0);
  assert.equal(state.d0, 11);
});

test("paired-memory destination selection comes from the chapter", async () => {
  const run = await generated(edited("destinationAddress = resolve(8, u3(3), upperCode)",
    "destinationAddress = resolve(8, u3(3), code)", 0xb30a)); // CMPM.B (A2)+,(A1)+
  const resolutions: number[][] = [], state = initialState(0);
  run(state, 1, 2, 1, {
    resolveAddress(size, mode, code) { resolutions.push([size, mode, code]); return code * 16; },
    commitAddressUpdates() {}, readByte(address) { return address; },
  });
  assert.deepEqual(resolutions, [[8, 3, 2], [8, 3, 2]]);
  assert.equal(state.flags.z, true);
});

for (const [name, before, after, message] of [
  ["unknown calculation", "with calculation = addByte", "with calculation = missing", /Unknown name missing/],
  ["wrong calculation width", "with calculation = addByte", "with calculation = addWord", /input.*16-bit|must be 16-bit|expected 16/i],
  ["wrong incoming flag type", "result = add(left, right, incoming)", "result = add(left, right, u8(1))", /flag|predicate/i],
] as const) test(`arithmetic chapter rejects ${name} at its document location`, () => {
  assert.ok(markdown.includes(before));
  assert.throws(() => compile(markdown.replace(before, after)), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, file);
    assert.match(error.message, message); assert.ok(error.line > 0); return true;
  });
});
