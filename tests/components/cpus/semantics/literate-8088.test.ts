import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { boolean, defineState, flag, group, unsigned } from "../../../../src/components/cpus/state.js";
import { cpu8088StateDescription } from "../../../../src/components/cpus/state/8088.js";
import { instructions8088, operandInstructions8088, strings8088 } from "../../../../src/components/cpus/semantics/definitions.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { instructions as actions, sourceReaders } from "../../../../src/components/cpus/generated/8088-state.js";
import { initialState } from "../8088/helpers.js";

const chapter = compileCpuChapter(readFileSync("src/components/cpus/specifications/8088.md", "utf8"), { name: "8088" });
const opcodes = [
  0x00, 0x01, 0x02, 0x03, 0x08, 0x09, 0x0a, 0x0b, 0x10, 0x11, 0x12, 0x13, 0x18, 0x19, 0x1a, 0x1b,
  0x20, 0x21, 0x22, 0x23, 0x28, 0x29, 0x2a, 0x2b, 0x30, 0x31, 0x32, 0x33, 0x38, 0x39, 0x3a, 0x3b,
  0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b,
  0x27, 0x2f, 0x37, 0x3f, 0x98, 0x99, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xf6, 0xf7, 0xfe, 0xff,
  0xa0, 0xa1, 0xa2, 0xa3, 0xc6, 0xc7,
  0x04, 0x05, 0x0c, 0x0d, 0x14, 0x15, 0x1c, 0x1d, 0x24, 0x25, 0x2c, 0x2d, 0x34, 0x35, 0x3c, 0x3d,
  0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f,
  0x9e, 0x9f, 0xa8, 0xa9,
  0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf,
  0x06, 0x0e, 0x16, 0x1e, 0x07, 0x17, 0x1f, 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
  0x59, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78,
  0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e, 0x7f, 0x8c, 0x8d, 0x8e, 0x8f, 0x90, 0x91, 0x92, 0x93, 0x94,
  0x95, 0x96, 0x97, 0x9a, 0x9c, 0x9d, 0xc2, 0xc3, 0xc4, 0xc5, 0xca, 0xcb, 0xd7, 0xe0, 0xe1, 0xe2,
  0xe3, 0xe8, 0xe9, 0xea, 0xeb, 0xf4, 0xf5, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd,
  0xa4, 0xa5, 0xa6, 0xa7, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf,
  0xe4, 0xe5, 0xe6, 0xe7, 0xec, 0xed, 0xee, 0xef, 0x9b, 0xcc, 0xcd, 0xce, 0xcf,
  0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf,
].sort((a, b) => a - b);

test("the 8088 chapter owns the complete stored schema and all 291 forms across 226 primary encodings", () => {
  const expected = defineState({
    ax: unsigned(16), bx: unsigned(16), cx: unsigned(16), dx: unsigned(16),
    sp: unsigned(16), bp: unsigned(16), si: unsigned(16), di: unsigned(16),
    cs: unsigned(16), ds: unsigned(16), ss: unsigned(16), es: unsigned(16), ip: unsigned(16),
    halted: boolean, waiting: boolean, interruptDeferred: boolean, recognitionDeferred: boolean, trapPending: boolean,
    flags: group({ cf: flag, pf: flag, af: flag, zf: flag, sf: flag, tf: flag, if: flag, df: flag, of: flag }),
  });
  assert.deepEqual(chapter.state, expected); assert.deepEqual(cpu8088StateDescription, expected);
  assert.deepEqual(Object.keys(cpu8088StateDescription), Object.keys(expected));
  assert.deepEqual(Object.keys(cpu8088StateDescription.flags.fields), Object.keys(expected.flags.fields));
  const entries = Object.values(chapter.families).flat();
  assert.equal(entries.length, 226);
  // Replace primary group bytes with their documented extension forms; far pointers
  // count once per operation, independent of the three legal memory modes.
  assert.equal(entries.length - 4 + 8 + 8 + 5 + 5 - 4 + 4 * 7 - 2 + 2 * 7 - 2 + 2 + 7, 291);
  assert.deepEqual(entries.map(([opcode]) => opcode).sort((a, b) => a - b), opcodes);
  for (const [opcode, definition] of entries) assert.deepEqual(({ ...instructions8088, ...operandInstructions8088, ...strings8088 })[opcode], definition);
  assert.equal(chapter.execution?.mode, "segmented"); assert.equal(chapter.interface, undefined);
});

test("every chapter byte view and write selects its own word and preserves the live other half", () => {
  const state = initialState(), events: string[] = [];
  const observed = new Proxy(state, {
    get(target, key, receiver) { events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver); },
    set(target, key, value) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value); },
  });
  const views = sourceReaders(observed).views;
  for (const [word, low, high, setLow, setHigh] of [
    ["ax", views.AL, views.AH, actions.setAL, actions.setAH],
    ["bx", views.BL, views.BH, actions.setBL, actions.setBH],
    ["cx", views.CL, views.CH, actions.setCL, actions.setCH],
    ["dx", views.DL, views.DH, actions.setDL, actions.setDH],
  ] as const) {
    state[word] = 0x1234; events.length = 0;
    assert.equal(low(), 0x34); assert.equal(high(), 0x12);
    assert.deepEqual(events, [`read ${word}`, `read ${word}`]);
    state[word] = 0xabcd; const before = structuredClone(state); events.length = 0;
    setLow(observed, 0x56); assert.deepEqual(state, { ...before, [word]: 0xab56 });
    setHigh(observed, 0x78); assert.deepEqual(state, { ...before, [word]: 0x7856 });
    assert.deepEqual(events, [`read ${word}`, `write ${word}`, `read ${word}`, `write ${word}`]);
  }
});

test("the physical PC view reads CS then IP and wraps the twenty-bit address", () => {
  const state = initialState(), events: PropertyKey[] = [];
  const views = sourceReaders(new Proxy(state, { get(target, key, receiver) {
    events.push(key); return Reflect.get(target, key, receiver);
  } })).views;
  for (const [cs, ip, physical] of [[0, 0, 0], [0x1234, 0x10, 0x12350], [0x1235, 0, 0x12350],
    [0xffff, 0xf, 0xfffff], [0xffff, 0x10, 0], [0xffff, 0xffff, 0xffef]]) {
    state.cs = cs!; state.ip = ip!; events.length = 0;
    assert.equal(views.PC(), physical); assert.deepEqual(events, ["cs", "ip"]);
  }
});

test("chapter FLAGS packing/restoration handles every word, reserved bit, and flag-object replacement", () => {
  const state = initialState();
  const views = sourceReaders(state).views;
  for (let status = 0; status < 65536; status++) {
    const before = state.flags;
    actions.restoreFlags(state, status);
    assert.notEqual(state.flags, before);
    assert.deepEqual(state.flags, { cf: Boolean(status & 1), pf: Boolean(status & 4), af: Boolean(status & 0x10),
      zf: Boolean(status & 0x40), sf: Boolean(status & 0x80), tf: Boolean(status & 0x100), if: Boolean(status & 0x200),
      df: Boolean(status & 0x400), of: Boolean(status & 0x800) });
    assert.equal(views.LOWFLAGS(), (status & 0xd5) | 2);
    assert.equal(views.FLAGS(), (status & 0xfd5) | 0xf002);
  }
});
