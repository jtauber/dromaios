import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import * as controlModule from "../../../../src/components/cpus/generated/68000-mode-code-displacement.js";
import { selectFamily } from "../../../helpers/68000-families.js";
const controlFamily = selectFamily(controlModule, "operandControl");
const { opcodeInstructions: control } = controlFamily;
import * as transfersModule from "../../../../src/components/cpus/generated/68000-mode-code.js";
const transfersFamily = selectFamily(transfersModule, "operandTransfer");
const { opcodeInstructions: transfers } = transfersFamily;
import * as systemModule from "../../../../src/components/cpus/generated/68000-mode-code.js";
const systemFamily = selectFamily(systemModule, "operandSystem");
const { opcodeInstructions: system } = systemFamily;
import { control68000, transfers68000, system68000 } from "../../../helpers/68000-families.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import type { WordAddressContext, WordControlContext, DeviceResetContext } from "../../../../src/components/cpus/word-execution.js";
import type { WordInstructionContext } from "../../../../src/components/cpus/instruction-context.js";
import type { Cpu68000State } from "../../../../src/components/cpus/semantics/generated/state/68000.js";
import { initialState } from "../../../helpers/68000-state.js";

const file = "src/components/cpus/specifications/68000.md", markdown = readFileSync(file, "utf8");
const compile = (text = markdown) => compileCpuChapter(text, {}, file);
type Context = WordAddressContext & WordControlContext & DeviceResetContext
  & Pick<WordInstructionContext, "fetchWord" | "readByte" | "writeByte">;
const context = (effects: Partial<Context> = {}): Context => ({
  fetchWord: () => 0, readByte: () => 0, readProgramByte: () => 0, writeByte: () => {},
  resolveAddress: () => 0x100, commitAddressUpdates: () => {}, nextAddress: () => 0x100,
  jump: () => {}, resetDevices: () => {}, ...effects,
});

test("every control, transfer, and system definition and encoding comes from the chapter", () => {
  const chapter = compile();
  for (const [prefix, production, definitions, words, bodies] of [
    ["Control", control, control68000, 5349, 332], ["Transfer", transfers, transfers68000, 396, 294],
    ["System", system, system68000, 8393, 63],
  ] as const) {
    const entries = Object.entries(chapter.families).filter(([name]) => name.startsWith(`operand${prefix}`)).flatMap(([, entries]) => entries);
    assert.equal(entries.length, words);
    assert.deepEqual(entries.map(([opcode]) => opcode).sort((a, b) => a - b), Object.keys(production).map(Number));
    const authored = Object.fromEntries(entries.map(([, definition]) => [definition.name, definition]));
    assert.equal(Object.keys(authored).length, bodies);
    assert.deepEqual(authored, definitions);
  }
});

async function edited(opcode: number, before: string, after: string) {
  assert.ok(markdown.includes(before), before);
  const definition = Object.values(compile(markdown.replace(before, after)).families).flat().find(([word]) => word === opcode)![1];
  const source = stripTypeScriptTypes(generateInstructions("68000", { run: definition }))
    .replace('"../alu.ts"', JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  const module: { instructions: { run(state: Cpu68000State, ...args: (number | Context)[]): unknown } } =
    await import(`data:text/javascript,${encodeURIComponent(source)}`);
  return module.instructions.run;
}
function section(name: string): string {
  const start = markdown.indexOf(`family ${name} `);
  assert.ok(start >= 0, name);
  return markdown.slice(start, markdown.indexOf("\n}", start) + 2);
}

test("editing a compound condition changes its generated result", async () => {
  const run = await edited(0x52c0, "return select(not(or(c, z)), u8(1), u8(0))", "return select(or(c, z), u8(1), u8(0))");
  const state = initialState(0); state.d0 = 0x123456ff;
  assert.equal(run(state, 0, 0, 0), undefined);
  assert.equal(state.d0, 0x12345600);
});

test("editing branch cursor placement changes the displacement base", async () => {
  const before = section("operandControlBranchWord");
  const run = await edited(0x6600, before, before.replace("base = next address\n  offset = fetch word", "offset = fetch word\n  base = next address"));
  const state = initialState(0); let cursor = 0x100, target: number | undefined;
  run(state, 0, 0, 0, context({ nextAddress: () => cursor, fetchWord() { cursor += 2; return 4; }, jump(address) { target = address; } }));
  assert.equal(target, 0x106);
});

test("editing MOVEP's byte spacing changes the bus sequence and assembled word", async () => {
  const run = await edited(0x0108, "byte1 = memory(add(address, u32(2)))", "byte1 = memory(add(address, u32(4)))");
  const state = initialState(0); state.a0 = 0x100; state.d0 = 0x12340000;
  const addresses: number[] = [];
  run(state, 0, 0, context({ readByte(address) { addresses.push(address); return address & 255; } }));
  assert.deepEqual(addresses, [0x100, 0x104]); assert.equal(state.d0, 0x12340004);
});

test("editing MOVEM's reversed selector changes which register the first mask bit stores", async () => {
  const before = section("operandTransferMultipleLongStorePredecrement");
  const run = await edited(0x48e7, before, before.replace("subtract(u8(15), registerIndex)", "registerIndex"));
  const state = initialState(0); state.usp = 0x100; state.d0 = 0x12345678;
  const writes: number[][] = [];
  run(state, 4, 7, context({ fetchWord: () => 1, writeByte(address, byte) { writes.push([address, byte]); } }));
  assert.deepEqual(writes, [[0xfc, 0x12], [0xfd, 0x34], [0xfe, 0x56], [0xff, 0x78]]);
  assert.equal(state.usp, 0xfc);
});

test("editing MOVEM's iteration count changes list traversal and the final postincrement", async () => {
  const before = section("operandTransferMultipleWordLoadPostincrement");
  const run = await edited(0x4c98, before, before.replace("iterate(u8(16))", "iterate(u8(1))"));
  const state = initialState(0); state.a0 = 0x100; state.d1 = 0xabcdef;
  const reads: number[] = [];
  run(state, 3, 0, context({ fetchWord: () => 3, readByte(address) { reads.push(address); return 0xff; } }));
  assert.deepEqual(reads, [0x100, 0x101]); assert.equal(state.d0, 0xffffffff);
  assert.equal(state.d1, 0xabcdef); assert.equal(state.a0, 0x102);
});

test("editing MOVEM word extension changes the complete loaded register", async () => {
  const before = section("operandTransferMultipleWordLoadMemory");
  const run = await edited(0x4c90, before, before.replace("signExtend(result, 32)", "extend(result, 32)"));
  const state = initialState(0);
  run(state, 2, 0, context({ fetchWord: () => 1, readByte: address => address & 1 ? 0 : 0x80 }));
  assert.equal(state.d0, 0x8000);
});

test("editing status privilege and commit order changes generated behavior", async () => {
  const before = section("operandSystemToSRMemory");
  const run = await edited(0x46d0, before, before.replace('reject "privilege-violation" if not(supervisor)', 'reject "privilege-violation" if supervisor')
    .replace("perform writeSR(status)\n  commit addresses", "commit addresses\n  perform writeSR(status)"));
  const state = initialState(0); const committed: boolean[] = [];
  run(state, 2, 0, context({ readByte: address => address & 1 ? 0 : 0x20, commitAddressUpdates() { committed.push(state.flags.s); } }));
  assert.deepEqual(committed, [false]); assert.equal(state.flags.s, true);
});

test("editing RTE frame order changes its read sequence", async () => {
  const before = section("operandSystemReturnException");
  const run = await edited(0x4e73, before, before.replace("high = source readMemoryWord(add(stack, u32(2)))\n  status = source readMemoryWord(stack)",
    "status = source readMemoryWord(stack)\n  high = source readMemoryWord(add(stack, u32(2)))"));
  const state = initialState(127); state.ssp = 0x100;
  const reads: number[] = [];
  run(state, 0, 0, context({ readByte(address) { reads.push(address); return 0; } }));
  assert.deepEqual(reads, [0x100, 0x101, 0x102, 0x103, 0x104, 0x105]);
  assert.equal(state.ssp, 0x106); assert.equal(state.flags.s, false);
});

test("editing RESET's encoding and signal changes the generated instruction table", async () => {
  const before = section("operandSystemReset"), after = before.replace('0111 0000', '0111 0100').replace('reset devices', 'D0 <- u32($1234)');
  const run = await edited(0x4e74, before, after);
  const state = initialState(127); let signals = 0;
  assert.equal(run(state, 0, 0, context({ resetDevices() { signals++; } })), undefined);
  assert.equal(state.d0, 0x1234); assert.equal(signals, 0);
  const opcodes = Object.values(compile(markdown.replace(before, after)).families).flat().map(([opcode]) => opcode);
  assert.ok(!opcodes.includes(0x4e70)); assert.ok(opcodes.includes(0x4e74));
});
