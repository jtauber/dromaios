import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { boolean, defineState, flag, group, unsigned } from "../../../../src/components/cpus/state.js";
import { cpu8088StateDescription } from "../../../../src/components/cpus/state/8088.js";
import { instructions8088 } from "../../../../src/components/cpus/semantics/definitions.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { instructions as actions, sourceReaders } from "../../../../src/components/cpus/generated/8088-state.js";
import { initialState } from "../8088/helpers.js";

const chapter = compileCpuChapter(readFileSync("src/components/cpus/specifications/8088.md", "utf8"), { name: "8088" });
const opcodes = [
  0x04, 0x05, 0x0c, 0x0d, 0x14, 0x15, 0x1c, 0x1d, 0x24, 0x25, 0x2c, 0x2d, 0x34, 0x35, 0x3c, 0x3d,
  0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f,
  0x9e, 0x9f, 0xa8, 0xa9,
  0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf,
];

test("the 8088 chapter owns the complete stored schema and 52 exact instruction forms", () => {
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
  assert.equal(entries.length, 52);
  assert.deepEqual(entries.map(([opcode]) => opcode).sort((a, b) => a - b), opcodes);
  for (const [opcode, definition] of entries) assert.deepEqual(instructions8088[opcode], definition);
  assert.equal(chapter.execution, undefined); assert.equal(chapter.interface, undefined);
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
