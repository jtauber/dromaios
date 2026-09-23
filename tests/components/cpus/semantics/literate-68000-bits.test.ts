import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import * as bitsModule from "../../../../src/components/cpus/generated/68000-mode-code-upper-code.js";
import { selectFamily } from "../../../helpers/68000-families.js";
const bitsFamily = selectFamily(bitsModule, "operandBits");
const { opcodeInstructions } = bitsFamily;
import { bits68000 } from "../../../helpers/68000-families.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import type { InstructionDefinition } from "../../../../src/components/cpus/semantics/model.js";
import type { WordAddressContext, OperandAlignmentFault } from "../../../../src/components/cpus/word-execution.js";
import type { Cpu68000State } from "../../../../src/components/cpus/semantics/generated/state/68000.js";
import { initialState } from "../../../helpers/68000-state.js";

const file = "src/components/cpus/specifications/68000.md";
const markdown = readFileSync(file, "utf8");
const compile = (text = markdown) => compileCpuChapter(text, { name: "68000" }, file);
const bodies: Readonly<Record<number, unknown>> = opcodeInstructions;

test("every production bit/shift/TAS definition and encoding comes from the chapter", () => {
  const entries = Object.entries(compile().families).filter(([name]) => name.startsWith("operandBits")).flatMap(([, entries]) => entries);
  assert.equal(entries.length, 5284);
  assert.deepEqual(entries.map(([opcode]) => opcode).sort((a, b) => a - b), Object.keys(bodies).map(Number));
  const definitions = Object.fromEntries(entries.map(([, definition]) => [definition.name, definition]));
  assert.equal(Object.keys(definitions).length, 2086);
  assert.deepEqual(Object.keys(definitions).sort(), Object.keys(bits68000).sort());
  for (const [name, definition] of Object.entries(definitions)) {
    assert.deepEqual(definition, bits68000[name], name);
    assert.deepEqual(definition.inputs, { mode: 3, code: 3, upperCode: 3 }, name);
  }
});

test("all eight immediate shift counts select one body per destination, operation, and size", () => {
  for (let opcode = 0xe000; opcode < 0xe200; opcode++) if ((opcode & 0xc0) !== 0xc0 && !(opcode & 0x20)) {
    assert.ok(bodies[opcode]);
    for (let count = 1; count < 8; count++) assert.equal(bodies[opcode], bodies[opcode + count * 512]);
  }
});

type Context = Pick<WordAddressContext, "resolveAddress" | "commitAddressUpdates"> & {
  readByte(address: number): number; writeByte(address: number, byte: number): void;
};
async function generated(definition: InstructionDefinition) {
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const source = stripTypeScriptTypes(generateInstructions("68000", { run: definition })).replace('"../alu.ts"', JSON.stringify(alu));
  const module: { instructions: { run(state: Cpu68000State, mode: number, code: number, upperCode: number,
    context?: Context): void | "unsupported" | OperandAlignmentFault } } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  return module.instructions.run;
}
function edited(before: string, after: string): Readonly<Record<number, InstructionDefinition>> {
  assert.ok(markdown.includes(before));
  return Object.fromEntries(Object.values(compile(markdown.replace(before, after)).families).flat());
}

test("one edit to local carry initialization changes zero-count ASR flags at every width", async () => {
  const definitions = edited("carryBit: flag = 0", "carryBit: flag = 1");
  for (const [width, opcode] of [[8, 0xe220], [16, 0xe260], [32, 0xe2a0]] as const) { // ASR D1,D0
    const run = await generated(definitions[opcode]!);
    const state = initialState(0); state.d0 = 2 ** (width - 1); state.d1 = 0;
    run(state, 0, 0, 1);
    assert.equal(state.d0, 2 ** (width - 1));
    assert.equal(state.flags.c, true); assert.equal(state.flags.x, false);
  }
});

test("one edit to the overflow recurrence changes ASL at every width without changing its result", async () => {
  const definitions = edited("next overflowBit = or(overflowBit, xor(negative(shifted), negative(result)))",
    "next overflowBit = 0");
  for (const [width, opcode] of [[8, 0xe320], [16, 0xe360], [32, 0xe3a0]] as const) { // ASL D1,D0
    const run = await generated(definitions[opcode]!);
    const state = initialState(0); state.d0 = 2 ** (width - 2); state.d1 = 1;
    run(state, 0, 0, 1);
    assert.equal(state.d0, 2 ** (width - 1));
    assert.equal(state.flags.n, true); assert.equal(state.flags.v, false);
  }
});

test("editing the chapter count mask changes full-count execution", async () => {
  const run = await generated(edited("count = and(truncate(countRegister, 8), u8(63))",
    "count = and(truncate(countRegister, 8), u8(31))")[0xe320]!);
  const state = initialState(0); state.d0 = 1; state.d1 = 32;
  run(state, 0, 0, 1);
  assert.equal(state.d0, 1);
});

test("editing bit-number reduction changes the memory bit selected", async () => {
  const run = await generated(edited("iterate(and(bitNumber, u8(7)), u8(1))",
    "iterate(and(bitNumber, u8(3)), u8(1))")[0x03d0]!); // BSET.B D1,(A0)
  const state = initialState(0), writes: number[][] = []; state.d1 = 7;
  run(state, 2, 0, 1, {
    resolveAddress: () => 0x100, commitAddressUpdates() {}, readByte: () => 0,
    writeByte(address, byte) { writes.push([address, byte]); },
  });
  assert.deepEqual(writes, [[0x100, 8]]); assert.equal(state.flags.z, true);
});
