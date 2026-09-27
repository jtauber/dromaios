import assert from "node:assert/strict";
import { test } from "node:test";
import { defineState, unsigned } from "../../../../src/components/cpus/state.js";
import { literal } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { chapterCatalogue } from "../../../../src/components/cpus/semantics/literate/catalogue.js";
import type { InstructionDefinition, ValueSource } from "../../../../src/components/cpus/semantics/model.js";

const state = defineState({ a: unsigned(8) });
const cpu = { name: "probe", state };
const ordinary = defineInstruction({ cpu, name: "ordinary", explanation: "No effects.", steps: [] });
const operand = defineInstruction({ ...ordinary, name: "operand", inputs: { mode: 3, upperCode: 3 } });
const reversed = defineInstruction({ ...operand, name: "reversed", inputs: { upperCode: 3, mode: 3 } });
const repeated = defineInstruction({ ...ordinary, name: "repeated", inputs: { repeatMode: 8 } });
const view: ValueSource = { name: "constant", type: 8, steps: [], result: literal(8, 0) };
const data = { cpu: "probe", state, sources: { selected: view, unused: view }, views: { A: view },
  actions: { idle: ordinary }, pages: {} };

test("byte catalogues preserve opcode order, aliases, views, and prefixed inventories", () => {
  const chapter = { ...data, mode: "byte" as const,
    families: { aliases: [[0xddcb01, ordinary], [1, ordinary]] as const },
    pages: { index: 0xdd, bits: { prefix: 0xcb, on: "index", operands: ["displacement"], opcodeFetch: false } } };
  const before = structuredClone(chapter), catalogue = chapterCatalogue("sample", chapter);
  assert.deepEqual(Object.keys(catalogue.instructions), ["1", "14535425"]);
  assert.equal(catalogue.instructions[1], ordinary);
  assert.equal(catalogue.instructions[0xddcb01], ordinary);
  assert.deepEqual(catalogue.instructionModules.map(module => module.name), ["sample", "sample-state"]);
  assert.equal(catalogue.instructionModules[0]!.options!.pages, chapter.pages);
  assert.equal(catalogue.instructionModules[1]!.options!.sources!.groups.views, data.views);
  assert.deepEqual(catalogue.instructionDefinitions, [ordinary, ordinary, ordinary]);
  assert.deepEqual(chapter, before);
});

test("segmented catalogues separate ordinary, operand, and repeat-mode instructions", () => {
  const catalogue = chapterCatalogue("sample", { ...data, mode: "segmented",
    families: { mixed: [[0xa4, repeated], [0x90, ordinary], [0x01, operand]] } });
  assert.deepEqual(catalogue.instructionModules.map(module => module.name),
    ["sample-state", "sample", "sample-operands", "sample-strings"]);
  assert.deepEqual(Object.keys(catalogue.instructions), ["144"]);
  assert.deepEqual(Object.keys(catalogue.operandInstructions), ["1"]);
  assert.deepEqual(Object.keys(catalogue.strings), ["164"]);
  assert.deepEqual(catalogue.instructionDefinitions, [ordinary, ordinary, operand, repeated]);
  assert.deepEqual(catalogue.instructionModules[2]!.options, {
    state: { name: "StoredState", module: "../semantics/generated/state/sample.ts" }, origin: "specifications/sample.md",
  });
});

test("word catalogues retain ordered input signatures, named aliases, selected readers, and explanation order", () => {
  const catalogue = chapterCatalogue("sample", { ...data, mode: "word", readers: ["selected"],
    families: { mixed: [[0x8000, operand], [0x8001, reversed], [0x8002, operand], [0x4e71, ordinary]] } });
  assert.deepEqual(catalogue.instructionModules.map(module => module.name),
    ["sample-state", "sample-mode-upper-code", "sample-upper-code-mode", "sample"]);
  assert.deepEqual(catalogue.instructionModules[1]!.options!.opcodeAliases, [[0x8000, "operand"], [0x8002, "operand"]]);
  assert.equal(catalogue.instructionModules[1]!.definitions.operand, operand);
  assert.deepEqual(catalogue.instructionModules[0]!.options!.sources!.groups.sources, { selected: view });
  assert.equal(catalogue.instructionModules[0]!.options!.sources!.cpu.wordBoundary, true);
  assert.deepEqual(catalogue.instructionDefinitions, [ordinary, ordinary, operand, reversed]);
});

test("catalogue binding retains opcode and alias validation", () => {
  const bind = (mode: "byte" | "word", entries: readonly (readonly [number, InstructionDefinition])[]) =>
    chapterCatalogue("sample", { ...data, mode, families: { entries } });
  assert.throws(() => bind("byte", [[256, ordinary]]), /opcode/);
  assert.throws(() => bind("byte", [[0, ordinary], [0, ordinary]]), /Duplicate opcode/);
  assert.throws(() => bind("word", [[0, ordinary], [0, operand]]), /Duplicate opcode/);
  assert.throws(() => bind("word", [[0, operand], [1, { ...operand, explanation: "Different meaning." }]]), /Conflicting instruction alias/);
});
