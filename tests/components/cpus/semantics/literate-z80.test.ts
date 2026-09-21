import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { boolean, choices, defineState, flag, group, unsigned } from "../../../../src/components/cpus/state.js";
import { cpuZ80StateDescription } from "../../../../src/components/cpus/state/z80.js";
import { instructionsZ80 } from "../../../../src/components/cpus/semantics/definitions.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { instructions } from "../../../../src/components/cpus/generated/z80.js";
import { instructions as actions, sourceReaders } from "../../../../src/components/cpus/generated/z80-state.js";
import { initialState } from "../z80/helpers.js";

const chapter = compileCpuChapter(readFileSync("src/components/cpus/specifications/z80.md", "utf8"), { name: "z80" });
// The four prefix bytes select separate pages; every other base opcode is documented.
const baseOpcodes = Array.from({ length: 256 }, (_, opcode) => opcode).filter(opcode => ![0xcb, 0xdd, 0xed, 0xfd].includes(opcode));

const cbOpcodes = Array.from({ length: 256 }, (_, opcode) => opcode).filter(opcode => opcode < 0x30 || opcode > 0x37).map(opcode => 0xcb00 + opcode);
const edOpcodes = [
  0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4d, 0x4f,
  0x50, 0x51, 0x52, 0x53, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5b, 0x5e, 0x5f,
  0x60, 0x61, 0x62, 0x63, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6f,
  0x72, 0x73, 0x78, 0x79, 0x7a, 0x7b,
  0xa0, 0xa1, 0xa2, 0xa3, 0xa8, 0xa9, 0xaa, 0xab, 0xb0, 0xb1, 0xb2, 0xb3, 0xb8, 0xb9, 0xba, 0xbb,
].map(opcode => 0xed00 + opcode);
const indexOpcodes = [0x09, 0x19, 0x21, 0x22, 0x23, 0x29, 0x2a, 0x2b, 0x34, 0x35, 0x36, 0x39,
  0x46, 0x4e, 0x56, 0x5e, 0x66, 0x6e, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x77, 0x7e,
  0x86, 0x8e, 0x96, 0x9e, 0xa6, 0xae, 0xb6, 0xbe, 0xe1, 0xe3, 0xe5, 0xe9, 0xf9];
const indexBits = [0x06, 0x0e, 0x16, 0x1e, 0x26, 0x2e, 0x3e,
  0x46, 0x4e, 0x56, 0x5e, 0x66, 0x6e, 0x76, 0x7e, 0x86, 0x8e, 0x96, 0x9e, 0xa6, 0xae, 0xb6, 0xbe,
  0xc6, 0xce, 0xd6, 0xde, 0xe6, 0xee, 0xf6, 0xfe];
const opcodes = [...baseOpcodes, ...cbOpcodes, ...edOpcodes,
  ...[0xdd, 0xfd].flatMap(prefix => [...indexOpcodes.map(opcode => prefix * 256 + opcode),
    ...indexBits.map(opcode => prefix * 65536 + 0xcb00 + opcode)])].sort((a, b) => a - b);

test("the Z80 chapter owns both banks, numeric interrupt mode, and all 698 documented forms", () => {
  const bank = defineState({ a: unsigned(8), b: unsigned(8), c: unsigned(8), d: unsigned(8), e: unsigned(8), h: unsigned(8), l: unsigned(8),
    flags: group({ s: flag, z: flag, h: flag, pv: flag, n: flag, c: flag }) });
  const expected = defineState({ ...bank, alternate: group(bank), ix: unsigned(16), iy: unsigned(16), pc: unsigned(16), sp: unsigned(16),
    i: unsigned(8), r: unsigned(8), iff1: boolean, iff2: boolean, im: choices(0, 1, 2), interruptDeferred: boolean, nmiDeferred: boolean, halted: boolean });
  assert.deepEqual(chapter.state, expected); assert.deepEqual(cpuZ80StateDescription, expected);
  assert.deepEqual(Object.keys(cpuZ80StateDescription), Object.keys(expected));
  assert.equal(baseOpcodes.length, 252); assert.equal(cbOpcodes.length, 248);
  assert.equal(edOpcodes.length, 58); assert.equal(new Set(opcodes).size, 698);
  assert.equal(indexOpcodes.length, 39); assert.equal(indexBits.length, 31);
  assert.deepEqual(chapter.pages, { CB: 0xcb, ED: 0xed, DD: 0xdd, FD: 0xfd,
    DDCB: { prefix: 0xcb, on: "DD", operands: ["displacement"], opcodeFetch: false },
    FDCB: { prefix: 0xcb, on: "FD", operands: ["displacement"], opcodeFetch: false } });
  for (const owned of [instructionsZ80, instructions]) assert.deepEqual(Object.keys(owned).map(Number).sort((a, b) => a - b), opcodes);
  assert.deepEqual(Object.fromEntries(Object.values(chapter.families).flat()), instructionsZ80);
  assert.equal(chapter.execution?.interrupt, "external"); assert.equal(chapter.interface, undefined);
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

test("chapter refresh preserves the stored high bit for every byte and modeled fetch count", () => {
  for (let byte = 0; byte < 256; byte++) for (const count of [0, 1, 2, 3]) {
    const state = initialState({ r: byte }), before = structuredClone(state);
    actions.refresh(state, count);
    assert.deepEqual(state, { ...before, r: Math.floor(byte / 128) * 128 + (byte % 128 + count) % 128 });
  }
});
