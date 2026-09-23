import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { chapterWordEvents } from "../../../../src/components/cpus/semantics/literate/word-events.js";
import { ChapterError, ChapterTokens } from "../../../../src/components/cpus/semantics/literate/document.js";
import type { InstructionDefinition, ValueSource } from "../../../../src/components/cpus/semantics/model.js";
import { actions, sources, views } from "../../../../src/components/cpus/semantics/generated/68000.js";
import { edited68000 } from "../../../helpers/68000-chapter.js";
import { initialState } from "../../../helpers/68000-state.js";

const markdown = readFileSync("src/components/cpus/specifications/68000.md", "utf8");
const contract = markdown.split("  events {\n")[1]!.split("\n  }")[0]!;

const parse = (text: string, actionMap: Readonly<Record<string, InstructionDefinition>> = actions,
  sourceMap: Readonly<Record<string, ValueSource>> = sources) => chapterWordEvents(
  new ChapterTokens({ text: "events", line: 100 }, "events.md"),
  text.split("\n").map((text, index) => new ChapterTokens({ text, line: 101 + index }, "events.md")),
  { actions: new Map(Object.entries(actionMap)), sources: new Map(Object.entries(sourceMap)), views: new Map(Object.entries(views)), latches: new Map() },
);

test("event hooks reject missing fields, wrong types, hidden effects, and invalid choices with document locations", () => {
  assert.equal(parse(contract).shortBytes, 6);
  for (const [before, after] of [
    ["    prepare action prepareException\n", ""], ["prepare action prepareException", "prepare action finishReset"],
    ["view EXCEPTIONSTACK", "view SR"], ["    halt action haltMemoryError", "    surprise action haltMemoryError"],
    ["short frame action writeExceptionFrame bytes 6", "short frame action writeExceptionFrame bytes 256"],
    ["fault vectors address 3 bus 2", "fault vectors address 3 bus 256"],
    ["values 1, 2, 5, 6", "values 1, 2, 5, 5"], ["levels 1 7", "levels 7 1"],
    ['reasons "faulted", "trace-pending", "masked"', 'reasons "faulted", "faulted"'],
    ["processing 0", "processing 2"], ["gate source interruptGate", "gate source missing"],
    ["    halt action haltMemoryError", "    halt action haltMemoryError\n    halt action haltMemoryError"],
  ] as const) {
    assert.ok(contract.includes(before));
    assert.throws(() => parse(contract.replace(before, after)), error => error instanceof ChapterError && error.file === "events.md" && error.line >= 100, before);
  }
  const badAction = { ...actions, prepareException: { ...actions.prepareException, steps: actions.writeExceptionFrame.steps } };
  assert.throws(() => parse(contract, badAction), /memory/);
  const badSource = { ...sources, interruptGate: { ...sources.interruptGate, steps: actions.haltMemoryError.steps } };
  assert.throws(() => parse(contract, actions, badSource), /Views may only read/);
});

test("event hooks distinguish Boolean decisions from numeric inputs and results", () => {
  const rejects = (run: () => unknown, field: string, message: string) => assert.throws(run, error =>
    error instanceof ChapterError && error.file === "events.md" &&
    error.line === 101 + contract.split("\n").findIndex(line => line.trimStart().startsWith(field)) && error.message.includes(message));
  for (const [name, parameter, type, field, expected] of [
    ["finishException", "processing", 8, "complete", "flag, 8"],
    ["writeMemoryErrorFrame", "write", 8, "fault frame", "32, 16, 32, 32, flag, flag, 8"],
    ["writeMemoryErrorFrame", "processing", 8, "fault frame", "32, 16, 32, 32, flag, flag, 8"],
    ["prepareException", "bytes", "flag", "prepare", "32, 8"],
  ] as const) {
    const original = actions[name];
    const changed = { ...actions, [name]: { ...original, inputs: { ...original.inputs, [parameter]: type } } };
    rejects(() => parse(contract, changed), field, `Event hook needs inputs [${expected}].`);
  }
  for (const [name, parameter, field, expected] of [
    ["exceptionFaultReturn", "vectorPhase", "entry return", "32, 8, flag"],
    ["faultFunctionCode", "program", "function code", "flag"],
  ] as const) {
    const original = sources[name];
    const changed = { ...sources, [name]: { ...original, inputs: { ...original.inputs, [parameter]: 8 as const } } };
    rejects(() => parse(contract, actions, changed), field, `Event hook needs inputs [${expected}].`);
  }
  for (const name of ["terminalInitialFetch", "initialFaultProcessing"] as const) {
    const changed = { ...sources, [name]: { ...sources[name], type: 8 as const } };
    rejects(() => parse(contract, actions, changed), "initial fetch", "Event source needs type flag.");
  }
  const changed = { ...sources, faultFunctionCode: { ...sources.faultFunctionCode, type: "flag" as const } };
  rejects(() => parse(contract, actions, changed), "function code", "Event source needs type 8.");
});

test("chapter edits control short-frame reservation, transfer addresses, and vector geometry through the public CPU", async () => {
  const Cpu = await edited68000([
    ["short frame action writeExceptionFrame bytes 6", "short frame action writeExceptionFrame bytes 8"],
    ["perform writeMemoryWord(subtract(stack, u32(2)), truncate(returnPc, 16))", "perform writeMemoryWord(subtract(stack, u32(8)), truncate(returnPc, 16))"],
    ["return shiftBits(extend(vector, 32), left, 2)", "return shiftBits(extend(vector, 32), left, 3)"],
  ]);
  const state = initialState(64); state.pc = 0x1000; state.ssp = 0x8000;
  const bytes = new Map([[0x1000, 0x4e], [0x1001, 0x40], [0x102, 0x22]]);
  const cpu = new Cpu({ size: 0x1000000, read: address => bytes.get(address) ?? 0, write(address, value) { bytes.set(address, value); } }, state);
  const result = cpu.step();
  assert.deepEqual(result.exception, { source: "trap", vector: 32, returnPc: 0x1002 });
  assert.equal(result.after.ssp, 0x7ff8); assert.equal(result.after.pc, 0x2200);
  assert.deepEqual(result.accesses.map(access => "address" in access && access.address), [0x1000, 0x1001, 0x7ff8, 0x7ff9, 0x7ffa, 0x7ffb, 0x7ffc, 0x7ffd, 0x100, 0x101, 0x102, 0x103]);
  assert.equal(bytes.get(0x7ff8), 0x10); assert.equal(bytes.get(0x7ff9), 2);
});

test("chapter edits control interrupt gates, level validation, acknowledgement selection, and callback-visible acceptance", async () => {
  const Cpu = await edited68000([
    ["levels 1 7", "levels 2 5"],
    ["return select(faulted, u8(1), select(trace, u8(2), select(masked, u8(3), u8(0))))", "return u8(0)"],
    ["INTERRUPTMASK <- truncate(level, 3)", "INTERRUPTMASK <- u3(0)"],
    ["return add(u8(24), level)", "return add(u8(40), level)"],
    ["spurious 24 maximum 255", "spurious 30 maximum 255"],
  ]);
  const state = initialState(64); state.pc = 0x1000; state.ssp = 0x8000; state.interruptMask = 7;
  for (const response of ["autovector", "spurious", 100] as const) {
    const cpu = new Cpu({ size: 0x1000000, read: () => 0, write() {} }, state);
    assert.throws(() => cpu.interrupt(1, assert.fail), /2\.\.5/);
    const result = cpu.interrupt(3, () => {
      assert.equal(cpu.snapshot().ssp, 0x7ffa); assert.equal(cpu.snapshot().interruptMask, 0);
      return response;
    });
    assert.equal(result.outcome, "accepted"); assert.ok("vector" in result);
    assert.equal(result.vector, response === "autovector" ? 43 : response === "spurious" ? 30 : 100);
    assert.deepEqual(result.accesses[0], { kind: "acknowledge", level: 3, value: response });
  }
});

test("chapter edits control initial-fetch recovery, fault vectors, function codes, and special-status bits", async () => {
  const Cpu = await edited68000([
    ["return or(reset, memoryError)", "return 0"],
    ["return select(ordinary, pc, address)", "return u32($BEEF)"],
    ["return or(select(supervisor, u8(4), u8(0)), select(program, u8(2), u8(1)))", "return u8(6)"],
    ["select(not(write), u8($10), u8(0))", "select(not(write), u8($20), u8(0))"],
    ["fault vectors address 3 bus 2", "fault vectors address 11 bus 10"],
  ]);
  const state = initialState(0); state.pc = 0x1001; state.ssp = 0x8000; state.entry = { kind: "reset", vector: 0 };
  for (const secondFault of [false, true]) {
    const bytes = new Map<number, number>();
    const cpu = new Cpu({ size: 0x1000000,
      read: address => secondFault && address === 44 ? "bus-error" : 0,
      write(address, value) { bytes.set(address, value); },
    }, state);
    const result = cpu.step(); assert.ok(result.exception && "fault" in result.exception);
    assert.equal(Number(result.exception.vector), 11); assert.equal(result.exception.returnPc, 0xbeef);
    assert.equal(result.exception.fault.functionCode, 6);
    assert.equal(result.exception.fault.processingInstruction, false);
    assert.equal(bytes.get(0x7ff2), 0); assert.equal(bytes.get(0x7ff3), 0x2e);
    assert.equal(result.after.faulted, secondFault);
    if (secondFault) assert.deepEqual(result.exception.entryFault, { source: "bus-error", operation: "read", address: 44 });
  }
});
