import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/z80.js";
import type { CpuZ80State } from "../../../../src/components/cpus/state/z80.js";
import { initialState, flagPattern } from "../z80/helpers.js";

function observe(state: CpuZ80State, events: string[]) {
  return new Proxy(state, {
    get(target, key, receiver) {
      if (key === "flags") return new Proxy(target.flags, {
        get(target, key, receiver) { events.push(`read flag ${String(key)}`); return Reflect.get(target, key, receiver); },
        set(target, key, value) { events.push(`write flag ${String(key)}`); return Reflect.set(target, key, value); },
      });
      events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver);
    },
    set(target, key, value) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value); },
  });
}
const parity = (byte: number) => byte.toString(2).replaceAll("0", "").length % 2 === 0;

test("Z80 bank exchanges read both bytes before each write and exchange flags by identity without reading their bits", () => {
  for (const accumulator of [false, true]) {
    const state = initialState(), main = { ...state }, other = { ...state.alternate }, events: string[] = [];
    const fields = accumulator ? ["a"] as const : ["b", "c", "d", "e", "h", "l"] as const;
    const forbidden = { get() { assert.fail("Exchange must not inspect flag bits"); } };
    const mainFlags = new Proxy(state.flags, forbidden), otherFlags = new Proxy(state.alternate.flags, forbidden);
    state.flags = mainFlags; state.alternate.flags = otherFlags;
    state.alternate = new Proxy(state.alternate, {
      get(target, key, receiver) { events.push(`read alternate.${String(key)}`); return Reflect.get(target, key, receiver); },
      set(target, key, value) { events.push(`write alternate.${String(key)}`); return Reflect.set(target, key, value); },
    });
    (accumulator ? instructions.exchangeAf : instructions.exchangeGeneralBanks)(new Proxy(state, {
      get(target, key, receiver) { if (key !== "alternate") events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver); },
      set(target, key, value) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value); },
    }));
    assert.deepEqual(events, [...fields, ...(accumulator ? ["flags"] : [])].flatMap(field =>
      [`read alternate.${field}`, `read ${field}`, `write ${field}`, `write alternate.${field}`]));
    for (const field of fields) { assert.equal(state[field], other[field]); assert.equal(state.alternate[field], main[field]); }
    assert.equal(state.flags, accumulator ? otherFlags : mainFlags);
    assert.equal(state.alternate.flags, accumulator ? mainFlags : otherFlags);
  }
});

test("Z80 bank exchange failures retain completed byte swaps and a completed first flag-object assignment", () => {
  const failure = new Error("bank effect failure"), state = initialState(), before = structuredClone(state);
  assert.throws(() => instructions.exchangeGeneralBanks(new Proxy(state, { set(target, key, value) {
    if (key === "c") throw failure; return Reflect.set(target, key, value);
  } })), error => error === failure);
  assert.deepEqual(state, { ...before, b: before.alternate.b, alternate: { ...before.alternate, b: before.b } });
  const af = initialState(), mainFlags = af.flags, alternateFlags = af.alternate.flags;
  af.alternate = new Proxy(af.alternate, { set(target, key, value) { if (key === "flags") throw failure; return Reflect.set(target, key, value); } });
  assert.throws(() => instructions.exchangeAf(af), error => error === failure);
  assert.equal(af.a, 0x88); assert.equal(af.alternate.a, 0x11);
  assert.equal(af.flags, alternateFlags); assert.equal(af.alternate.flags, alternateFlags); assert.notEqual(af.flags, mainFlags);
});

test("Z80 special transfers and NEG have explicit latch/flag reads and replace flags before A", () => {
  for (const [name, execute, expected] of [
    ["LD A,I", instructions.loadAFromI, ["read i", "read iff2", "read flag c", "write flags", "write a"]],
    ["LD A,R", instructions.loadAFromR, ["read r", "read iff2", "read flag c", "write flags", "write a"]],
    ["LD I,A", instructions.loadIFromA, ["read a", "write i"]],
    ["LD R,A", instructions.loadRFromA, ["read a", "write r"]],
    ["NEG", instructions.neg, ["read a", "write flags", "write a"]],
  ] as const) {
    const state = initialState(), flags = state.flags, events: string[] = [];
    execute(observe(state, events)); assert.deepEqual(events, expected, name);
    assert.equal(state.flags === flags, name === "LD I,A" || name === "LD R,A");
  }
  const failure = new Error("IFF2 read failure"), state = initialState(), before = structuredClone(state);
  assert.throws(() => instructions.loadAFromI(new Proxy(state, { get(target, key, receiver) {
    if (key === "iff2") throw failure; return Reflect.get(target, key, receiver);
  } })), error => error === failure);
  assert.deepEqual(state, before);
});

test("Z80 digit rotates retain captured addresses/results but sample carry only after a successful memory write", () => {
  for (const left of [false, true]) for (let failAt = -1; failAt < 2; failAt++) {
    const state = initialState(), before = structuredClone(state), events: string[] = [], failure = new Error("digit access failure");
    const observed = observe(state, events);
    const run = () => (left ? instructions.rld : instructions.rrd)(observed, {
      readByte(address) {
        events.push("read memory"); assert.equal(address, 0x6677); if (failAt === 0) throw failure;
        state.h = 0; state.l = 1; state.a = 0xab; state.flags = flagPattern(0); return 0x34;
      },
      writeByte(address, byte) {
        events.push("write memory"); assert.equal(address, 0x6677); assert.equal(byte, left ? 0x4b : 0xb3);
        if (failAt === 1) throw failure;
        state.a = 0; state.h = 9; state.flags = flagPattern(32);
      },
    });
    if (failAt >= 0) assert.throws(run, error => error === failure); else run();
    assert.deepEqual(events, ["read h", "read l", "read memory", ...(failAt === 0 ? [] : ["read a", "write memory"]),
      ...(failAt < 0 ? ["read flag c", "write flags", "write a"] : [])]);
    const result = left ? 0xa3 : 0xa4;
    assert.deepEqual(state, failAt === 0 ? before : failAt === 1 ? { ...before, h: 0, l: 1, a: 0xab, flags: flagPattern(0) }
      : { ...before, h: 9, l: 1, a: result, flags: { s: true, z: false, h: false, pv: parity(result), n: false, c: true } });
  }
});

const blocks = [
  [instructions.ldi, 1, false, false], [instructions.ldd, -1, false, false],
  [instructions.ldir, 1, false, true], [instructions.lddr, -1, false, true],
  [instructions.cpi, 1, true, false], [instructions.cpd, -1, true, false],
  [instructions.cpir, 1, true, true], [instructions.cpdr, -1, true, true],
] as const;

test("Z80 block bodies preserve live pair reads, captured counters, flag stages, and conditional PC access", () => {
  for (const [execute, delta, compare, repeat] of blocks) for (const count of [0, 1, 2]) for (const byte of [0x3f, 0x40]) {
    const state = initialState({ pc: 1 }), before = structuredClone(state), events: string[] = [];
    execute(observe(state, events), {
      readByte(address) {
        events.push("read memory"); assert.equal(address, 0x6677);
        state.a = 0x40; state.b = 0; state.c = count; state.d = 0x10; state.e = 0;
        state.h = state.l = 0xff; state.flags = flagPattern(63); return byte;
      },
      writeByte(address, value) {
        events.push("write memory"); assert.equal(compare, false); assert.equal(address, 0x1000); assert.equal(value, byte);
        state.d = state.e = 0xff; state.b = 0xbe; state.c = 0xef; // BC was captured before this write; DE is reread afterward.
      },
    });
    const remaining = (count + 65535) % 65536, next = delta === 1 ? 0 : 0xfffe, repeating = repeat && remaining !== 0 && (!compare || byte !== 0x40);
    assert.deepEqual(state, { ...before, a: 0x40, b: Math.floor(remaining / 256), c: remaining % 256,
      h: Math.floor(next / 256), l: next % 256, d: compare ? 0x10 : Math.floor(next / 256), e: compare ? 0 : next % 256,
      pc: repeating ? 0xffff : 1, flags: compare ? { s: false, z: byte === 0x40, h: byte === 0x3f, pv: remaining !== 0, n: true, c: true }
        : { ...flagPattern(63), n: false, h: false, pv: remaining !== 0 } });
    assert.deepEqual(events, ["read h", "read l", "read memory", "read b", "read c",
      ...(compare ? ["read a", "read flag c", "write flags"] : ["read d", "read e", "write memory", "read d", "read e", "write d", "write e", "write flag n", "write flag h", "write flag pv"]),
      "read h", "read l", "write h", "write l", "write b", "write c",
      ...(repeat && remaining && compare ? ["read flag z"] : []), ...(repeating ? ["read pc", "write pc"] : [])]);
  }
});

test("failed block reads/writes preserve the register and flag state present at the failing access", () => {
  for (const [execute, _delta, compare] of blocks) for (let failAt = 0; failAt < (compare ? 1 : 2); failAt++) {
    const state = initialState(), before = structuredClone(state), failure = new Error("block access failure");
    assert.throws(() => execute(state, {
      readByte() { if (failAt === 0) throw failure; state.b = 0; state.c = 2; return 0x81; },
      writeByte() { throw failure; },
    }), error => error === failure);
    assert.deepEqual(state, failAt === 0 ? before : { ...before, b: 0, c: 2 });
  }
});
