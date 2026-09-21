import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { boolean, choices, defineState, flag, group, unsigned } from "../../../../src/components/cpus/state.js";
import { cpuZ80StateDescription } from "../../../../src/components/cpus/state/z80.js";
import { chapterZ80, instructionsZ80 } from "../../../../src/components/cpus/semantics/definitions.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { instructions } from "../../../../src/components/cpus/generated/z80-chapter.js";
import { instructions as actions, sourceReaders } from "../../../../src/components/cpus/generated/z80-state.js";
import { aluForms, initialState, transferRows } from "../z80/helpers.js";

const chapter = compileCpuChapter(readFileSync("src/components/cpus/specifications/z80.md", "utf8"), { name: "z80" });
const opcodes = [
  ...transferRows.flatMap(({ opcodes }) => opcodes.filter(opcode => opcode !== 0x76)),
  0x06, 0x0e, 0x16, 0x1e, 0x26, 0x2e, 0x36, 0x3e,
  ...aluForms.flatMap(({ opcodes, immediate }) => [...opcodes, immediate]),
  0x04, 0x0c, 0x14, 0x1c, 0x24, 0x2c, 0x34, 0x3c,
  0x05, 0x0d, 0x15, 0x1d, 0x25, 0x2d, 0x35, 0x3d,
].sort((a, b) => a - b);

test("the Z80 chapter owns both banks, numeric interrupt mode, and exactly 159 complete unprefixed forms", () => {
  const bank = defineState({ a: unsigned(8), b: unsigned(8), c: unsigned(8), d: unsigned(8), e: unsigned(8), h: unsigned(8), l: unsigned(8),
    flags: group({ s: flag, z: flag, h: flag, pv: flag, n: flag, c: flag }) });
  const expected = defineState({ ...bank, alternate: group(bank), ix: unsigned(16), iy: unsigned(16), pc: unsigned(16), sp: unsigned(16),
    i: unsigned(8), r: unsigned(8), iff1: boolean, iff2: boolean, im: choices(0, 1, 2), interruptDeferred: boolean, nmiDeferred: boolean, halted: boolean });
  assert.deepEqual(chapter.state, expected); assert.deepEqual(cpuZ80StateDescription, expected);
  assert.deepEqual(Object.keys(cpuZ80StateDescription), Object.keys(expected));
  assert.equal(opcodes.length, 159); assert.equal(new Set(opcodes).size, 159);
  for (const owned of [chapterZ80, instructions]) assert.deepEqual(Object.keys(owned).map(Number).sort((a, b) => a - b), opcodes);
  assert.deepEqual(Object.fromEntries(Object.values(chapter.families).flat()), chapterZ80);
  for (const opcode of opcodes) assert.equal(Object.hasOwn(instructionsZ80, opcode), false, `Native duplicate of ${opcode.toString(16)}`);
  for (const name of ["addB", "adcM", "cpImmediate", "incH", "decA"]) assert.equal(Object.hasOwn(instructionsZ80, name), false);
  assert.equal(chapter.execution, undefined); assert.equal(chapter.interface, undefined);
});

test("both banks' pair views read their own high byte then low byte without flags or memory", () => {
  const state = initialState(), events: string[] = [];
  const other = new Proxy(state.alternate, { get(target, key, receiver) { events.push(`alternate.${String(key)}`); return Reflect.get(target, key, receiver); } });
  const observed = new Proxy(state, { get(target, key, receiver) {
    if (key === "alternate") return other;
    events.push(String(key)); return Reflect.get(target, key, receiver);
  } });
  const views = sourceReaders(observed).views;
  for (const [view, value, reads] of [
    [views.BC, 0x2233, ["b", "c"]], [views.DE, 0x4455, ["d", "e"]], [views.HL, 0x6677, ["h", "l"]],
    [views.BC_ALT, 0x99aa, ["alternate.b", "alternate.c"]], [views.DE_ALT, 0xbbcc, ["alternate.d", "alternate.e"]],
    [views.HL_ALT, 0xddee, ["alternate.h", "alternate.l"]],
  ] as const) {
    events.length = 0; assert.equal(view(), value); assert.deepEqual(events, reads);
  }
});

test("F ignores bits 5/3, packs every documented bit, and replacement leaves the alternate bank untouched", () => {
  for (let status = 0; status < 256; status++) {
    const state = initialState(), alternate = structuredClone(state.alternate), oldFlags = state.flags;
    actions.writeF(state, status);
    assert.deepEqual(state.flags, { s: Boolean(status & 0x80), z: Boolean(status & 0x40), h: Boolean(status & 0x10),
      pv: Boolean(status & 0x04), n: Boolean(status & 0x02), c: Boolean(status & 0x01) });
    assert.notEqual(state.flags, oldFlags); assert.deepEqual(state.alternate, alternate);
    assert.equal(sourceReaders(state).views.F(), status & 0xd7);
  }
});

// Retain the exhaustive word-pair checks formerly exercised through the removed native helper.
test("chapter pair views combine every word in either bank without changing stored bytes", () => {
  const bytes = new DataView(new ArrayBuffer(2)), state = initialState();
  const views = sourceReaders(state).views;
  for (const bank of [state, state.alternate]) {
    for (const [high, low, view] of [
      ["b", "c", bank === state ? views.BC : views.BC_ALT],
      ["d", "e", bank === state ? views.DE : views.DE_ALT],
      ["h", "l", bank === state ? views.HL : views.HL_ALT],
    ] as const) for (let value = 0; value < 65536; value++) {
      bytes.setUint16(0, value, false); bank[high] = bytes.getUint8(0); bank[low] = bytes.getUint8(1);
      assert.equal(view(), value); assert.equal(bank[high], bytes.getUint8(0)); assert.equal(bank[low], bytes.getUint8(1));
    }
  }
});
