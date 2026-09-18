import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/8088-transfers.js";
import { transfers8088 } from "../../../../src/components/cpus/semantics/definitions.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import type { Cpu8088State } from "../../../../src/components/cpus/state/8088.js";
import { address, byteMoves, initialState, registerValue, replaceRegister, words } from "../8088/helpers.js";

type Context = { fetchByte(): number; readByte(address: number): number; writeByte(address: number, value: number): void };
const registers: Readonly<Record<`${"move" | "exchange"}_${8 | 16}_${number}_${number}`, (state: Cpu8088State) => void>> = instructions;
const memory: Readonly<Record<string, (state: Cpu8088State, segment: number, offset: number, context: Context) => void>> = instructions;
const field = (width: 8 | 16, selector: number) => width === 8 ? byteMoves[selector]![1] : words[selector]!;

test("8088 resolved transfer inventory covers all register pairs, all memory registers, and both immediate widths", () => {
  const expected = [8, 16].flatMap(width => [
    ...Array.from({ length: 8 }, (_, d) => Array.from({ length: 8 }, (_, s) => [`move_${width}_${d}_${s}`, `exchange_${width}_${d}_${s}`])).flat(2),
    ...Array.from({ length: 8 }, (_, r) => [`load_${width}_${r}`, `store_${width}_${r}`, `exchangeMemory_${width}_${r}`]).flat(),
    `immediate_${width}`,
  ]).sort();
  assert.equal(expected.length, 306);
  assert.deepEqual(Object.keys(instructions).sort(), expected); assert.deepEqual(Object.keys(transfers8088).sort(), expected);
});

function observe(state: Cpu8088State, effect: (name: string) => void) {
  return new Proxy(state, {
    get(target, key, receiver) { effect(`read ${String(key)}`); return Reflect.get(target, key, receiver); },
    set(target, key, contents) { effect(`write ${String(key)}`); return Reflect.set(target, key, contents); },
  });
}

test("all register MOV/XCHG bodies preserve aliasing, live byte halves, and partial writes at every effect failure", () => {
  for (const width of [8, 16] as const) for (let d = 0; d < 8; d++) for (let s = 0; s < 8; s++) for (const exchange of [false, true]) {
    const key = `${exchange ? "exchange" : "move"}_${width}_${d}_${s}` as const, before = initialState();
    const schedule: string[] = [], snapshots: Cpu8088State[] = []; let expected = structuredClone(before);
    const event = (name: string) => { schedule.push(name); snapshots.push(structuredClone(expected)); };
    const put = (selector: number, contents: number) => {
      if (width === 8) event(`read ${field(width, selector)}`);
      event(`write ${field(width, selector)}`); expected = replaceRegister(expected, width, selector, contents);
    };
    if (exchange) event(`read ${field(width, d)}`);
    event(`read ${field(width, s)}`); put(d, registerValue(before, width, s));
    if (exchange) put(s, registerValue(before, width, d));
    for (let failAt = -1; failAt < schedule.length; failAt++) {
      const state = structuredClone(before), events: string[] = [], failure = Error("register effect failed");
      const run = () => registers[key]!(observe(state, name => { events.push(name); if (events.length - 1 === failAt) throw failure; }));
      if (failAt < 0) run(); else assert.throws(run, error => error === failure);
      assert.deepEqual(events, schedule.slice(0, failAt < 0 ? undefined : failAt + 1), key);
      assert.deepEqual(state, failAt < 0 ? expected : snapshots[failAt], `${key} at ${failAt}`);
    }
  }
});

test("resolved memory transfers wrap each offset before projection and retain exactly completed effects on failure", () => {
  for (const width of [8, 16] as const) for (const offset of [0x000f, 0xffff]) for (const operation of ["load", "store", "exchangeMemory", "immediate"] as const) {
    for (let r = 0; r < (operation === "immediate" ? 1 : 8); r++) {
      const before = initialState(), segment = 0xffff, key = `${operation}_${width}${operation === "immediate" ? "" : `_${r}`}`;
      const addresses = Array.from({ length: width / 8 }, (_, i) => address(segment, (offset + i) % 65536));
      const initialMemory = new Map(addresses.map((a, i) => [a, [0x34, 0x12][i]!]));
      const schedule: string[] = [], snapshots: { state: Cpu8088State; bytes: Map<number, number> }[] = [];
      let expected = structuredClone(before); const expectedMemory = new Map(initialMemory);
      const event = (name: string) => { schedule.push(name); snapshots.push({ state: structuredClone(expected), bytes: new Map(expectedMemory) }); };
      const readMemory = operation === "load" || operation === "exchangeMemory";
      if (readMemory) addresses.forEach(a => event(`read memory ${a}`));
      if (operation === "immediate") addresses.forEach(() => event("fetch"));
      else if (operation !== "load") event(`read ${field(width, r)}`);
      if (operation !== "load") {
        const source = operation === "immediate" ? 0xa55a : registerValue(before, width, r);
        addresses.forEach((a, i) => { const byte = Math.floor(source / 256 ** i) % 256; event(`write memory ${a} ${byte}`); expectedMemory.set(a, byte); });
      }
      if (readMemory) {
        if (width === 8) event(`read ${field(width, r)}`);
        event(`write ${field(width, r)}`); expected = replaceRegister(expected, width, r, width === 8 ? 0x34 : 0x1234);
      }
      for (let failAt = -1; failAt < schedule.length; failAt++) {
        const state = structuredClone(before), bytes = new Map(initialMemory), events: string[] = [], failure = Error("transfer effect failed");
        const effect = (name: string) => { events.push(name); if (events.length - 1 === failAt) throw failure; };
        let fetched = 0;
        const run = () => memory[key]!(observe(state, effect), segment, offset, {
          fetchByte() { effect("fetch"); return [0x5a, 0xa5][fetched++]!; },
          readByte(a) { effect(`read memory ${a}`); assert.ok(bytes.has(a)); return bytes.get(a)!; },
          writeByte(a, byte) { effect(`write memory ${a} ${byte}`); bytes.set(a, byte); },
        });
        if (failAt < 0) run(); else assert.throws(run, error => error === failure);
        assert.deepEqual(events, schedule.slice(0, failAt < 0 ? undefined : failAt + 1), key);
        assert.deepEqual(state, failAt < 0 ? expected : snapshots[failAt]!.state, `${key} at ${failAt}`);
        assert.deepEqual(bytes, failAt < 0 ? expectedMemory : snapshots[failAt]!.bytes, `${key} at ${failAt}`);
      }
    }
  }
});

test("resolved transfers retain captured addresses and source words but observe live byte halves and post-read registers", () => {
  for (const operation of ["load", "store", "exchangeMemory", "immediate"] as const) {
    const state = initialState({ ax: 0xbeef, ds: 0xffff }), events: number[] = [], written: number[] = [];
    memory[`${operation}_16${operation === "immediate" ? "" : "_0"}`]!(state, 0xffff, 0xffff, {
      fetchByte() { state.ds = 0; return 0x44; },
      readByte(a) { events.push(a); state.ds = 0; state.ax = 0xabcd; return a === 0xffef ? 0x34 : 0x12; },
      writeByte(a, byte) { events.push(a); written.push(byte); state.ds = 0; state.ax = 0x5555; },
    });
    const pair = [0xffef, 0xffff0];
    assert.deepEqual(events, operation === "exchangeMemory" ? [...pair, ...pair] : pair);
    assert.deepEqual(written, operation === "load" ? [] : operation === "store" ? [0xef, 0xbe] : operation === "exchangeMemory" ? [0xcd, 0xab] : [0x44, 0x44]);
    assert.equal(state.ax, operation === "load" || operation === "exchangeMemory" ? 0x1234 : 0x5555);
  }
  const state = initialState({ ax: 0x12ab });
  instructions.exchangeMemory_8_0(state, 0xffff, 0xf, {
    readByte() { state.ax = 0xcd34; return 0x55; }, writeByte(_address, byte) { assert.equal(byte, 0x34); state.ax = 0xef67; },
  });
  assert.equal(state.ax, 0xef55);
});

test("8088 transfer descriptions expose offset wrap before projection, ordered bytes, and preserved flags", () => {
  const text = describeInstruction(transfers8088.exchangeMemory_16_0!);
  assert.match(text, /segment:u16 := input\noffset:u16 := input/);
  assert.match(text, /projectAddress\(segment \* 16 \+ addWrap\(offset, 0001:u16\), 20 bits\)/);
  assert.match(text, /leftHigh:u8 := read memory[\s\S]*source "register AX"/);
  assert.match(text, /write memory[\s\S]*write AX:u16/);
  assert.ok(text.lastIndexOf("write memory") < text.indexOf("write AX:u16"));
  assert.match(text, /Flags preserved throughout: CF, PF, AF, ZF, SF, TF, IF, DF, OF\./);
});
