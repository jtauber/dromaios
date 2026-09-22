import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/8088.js";
import { compileResolved, addressing8088 } from "../../../helpers/8088-resolved.js";
import { instructions as strings } from "../../../../src/components/cpus/generated/8088-strings.js";
import { strings as strings8088, instructions as instructions8088 } from "../../../../src/components/cpus/semantics/generated/8088.js";
import type { Cpu8088State, Cpu8088Flags } from "../../../../src/components/cpus/semantics/generated/state/8088.js";
import { address, aluResult, flags, initialState, words } from "../8088/helpers.js";

const addressing = await compileResolved(addressing8088);

type Context = { fetchByte(): number; readByte(address: number): number; writeByte(address: number, byte: number): void; deferInterrupt(scope: "intr" | "all"): void };
type Body = (state: Cpu8088State, context: Context) => void;
type InputBody = (state: Cpu8088State, input: number, context: Context) => void;
type AddressBody = (state: Cpu8088State, segment: number, offset: number, context: Context) => void;
interface Case { key: string; execute: Body; reference: Body }
const generatedAddressing: Readonly<Record<string, Body | InputBody | AddressBody>> = addressing;
const stringOpcodes = { move: 0xa4, compare: 0xa6, store: 0xaa, load: 0xac, scan: 0xae } as const;
const generatedStrings: Readonly<Partial<Record<number, (state: Cpu8088State, overridden: number, segment: number, repeatMode: number, startIP: number, context: Context) => void>>> = strings;
const wrap = (n: number) => (n + 65536) % 65536;
const segment = 0xffff, offset = 0xffff, startIP = 0xfffc;
const flagBits = { cf: 0, pf: 2, af: 4, zf: 6, sf: 7, tf: 8, if: 9, df: 10, of: 11 } as const;
const readWord = (context: Context, s: number, o: number) => context.readByte(address(s, o)) + 256 * context.readByte(address(s, o + 1));
const writeWord = (context: Context, s: number, o: number, n: number) => {
  context.writeByte(address(s, o), n % 256); context.writeByte(address(s, o + 1), Math.floor(n / 256));
};

const addressCases: Case[] = [];
for (const seg of ["es", "cs", "ss", "ds"] as const) for (const r of [...words.keys(), "memory"] as const) for (const load of [false, true]) {
  if (load && seg === "cs") continue;
  const key = `segment_${load ? "load" : "store"}_${seg}_${r}`;
  addressCases.push({ key, execute: (state, context) => r === "memory"
    ? (generatedAddressing[key] as AddressBody)(state, segment, offset, context) : (generatedAddressing[key] as Body)(state, context),
  reference(state, context) {
    if (load) { state[seg] = r === "memory" ? readWord(context, segment, offset) : state[words[r]!]; context.deferInterrupt("all"); }
    else { const contents = state[seg]; if (r === "memory") writeWord(context, segment, offset, contents); else state[words[r]!] = contents; }
  } });
}
for (const [r, register] of words.entries()) {
  addressCases.push({ key: `LEA_${r}`, execute: (state, context) => (generatedAddressing[`LEA_${r}`] as InputBody)(state, offset, context),
    reference(state) { state[register] = offset; } });
  for (const seg of ["es", "ds"] as const) {
    const key = `${seg === "es" ? "LES" : "LDS"}_${r}`;
    addressCases.push({ key, execute: (state, context) => (generatedAddressing[key] as AddressBody)(state, segment, offset, context),
      reference(state, context) {
        const targetOffset = readWord(context, segment, offset), targetSegment = readWord(context, segment, wrap(offset + 2));
        state[register] = targetOffset; state[seg] = targetSegment;
      } });
  }
}
for (const override of [false, true]) {
  const key = "XLAT" + (override ? "_override" : "");
  addressCases.push({ key, execute: (state, context) => override ? (generatedAddressing.XLAT_override as InputBody)(state, segment, context) : (generatedAddressing.XLAT as Body)(state, context),
    reference(state, context) {
      const index = wrap(state.bx + state.ax % 256), contents = context.readByte(address(override ? segment : state.ds, index));
      state.ax = Math.floor(state.ax / 256) * 256 + contents;
    } });
}
const controls: Case[] = [
  ...([false, true] as const).map(enabled => ({ key: enabled ? "STI" : "CLI",
    execute: ((state, context) => enabled ? instructions[0xfb](state, context) : instructions[0xfa](state)) as Body,
    reference: ((state, context) => { if (enabled && !state.flags.if) context.deferInterrupt("intr"); state.flags.if = enabled; }) as Body })),
  { key: "IRET", execute: (state, context) => instructions[0xcf](state, context), reference(state, context) {
    const pop = () => { const n = readWord(context, state.ss, state.sp); state.sp = wrap(state.sp + 2); return n; };
    const ip = pop(), cs = pop(); state.ip = ip; state.cs = cs; state.sp = wrap(state.sp);
    const status = pop(), next = flags(0);
    for (const field of Object.keys(flagBits) as (keyof Cpu8088Flags)[]) next[field] = Boolean(Math.floor(status / 2 ** flagBits[field]) % 2);
    if (!state.flags.if && next.if) context.deferInterrupt("intr"); state.flags = next;
  } },
];
const stringCases: Case[] = [];
for (const operation of ["move", "compare", "store", "load", "scan"] as const) for (const width of [8, 16] as const) {
  const compares = operation === "compare" || operation === "scan";
  for (const repeat of ["once", "repe", "repne"] as const) for (const override of [false, true]) {
    if (repeat === "repne" && !compares) continue;
    const key = `${operation}_${width}${repeat === "once" ? "" : "_" + repeat}${override ? "_override" : ""}`;
    stringCases.push({ key, execute(state, context) {
      generatedStrings[stringOpcodes[operation] + Number(width === 16)]!(state, Number(override), override ? segment : 0,
        repeat === "once" ? 0 : repeat === "repe" ? 1 : 2, startIP, context);
    }, reference(state, context) {
      if (repeat !== "once" && state.cx === 0) return;
      const sourceSegment = override ? segment : state.ds, sourceOffset = state.si, destSegment = state.es, destOffset = state.di;
      const read = (s: number, o: number) => width === 8 ? context.readByte(address(s, o)) : readWord(context, s, o);
      const write = (n: number) => width === 8 ? context.writeByte(address(destSegment, destOffset), n) : writeWord(context, destSegment, destOffset, n);
      if (operation === "move") write(read(sourceSegment, sourceOffset));
      else if (operation === "store") write(state.ax % 2 ** width);
      else if (operation === "load") {
        const contents = read(sourceSegment, sourceOffset);
        state.ax = width === 8 ? Math.floor(state.ax / 256) * 256 + contents : contents;
      } else {
        const left = operation === "compare" ? read(sourceSegment, sourceOffset) : state.ax % 2 ** width;
        const right = read(destSegment, destOffset), result = aluResult("SUB", width, left, right, flags(0));
        for (const field of ["cf", "af", "of", "zf", "sf", "pf"] as const) state.flags[field] = result.flags[field];
      }
      const delta = (state.flags.df ? -1 : 1) * width / 8;
      if (operation === "move" || operation === "compare" || operation === "load") state.si = wrap(state.si + delta);
      if (operation !== "load") state.di = wrap(state.di + delta);
      if (repeat !== "once") {
        state.cx = wrap(state.cx - 1);
        if (state.cx !== 0 && (!compares || state.flags.zf === (repeat === "repe"))) state.ip = startIP;
      }
    } });
  }
}

test("8088 addressing, string, and remaining interrupt-control definitions have the exact independent inventory", () => {
  assert.equal(addressCases.length, 89); assert.equal(stringCases.length, 48);
  assert.deepEqual(Object.keys(addressing).sort(), addressCases.map(c => c.key).sort());
  assert.deepEqual(Object.keys(addressing8088).sort(), Object.keys(addressing).sort());
  assert.deepEqual(Object.keys(strings).map(Number), [0xa4, 0xa5, 0xa6, 0xa7, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf]);
  assert.deepEqual(Object.keys(strings8088).sort(), Object.keys(strings).sort());
  assert.deepEqual([0xcf, 0xfa, 0xfb].map(opcode => instructions8088[opcode]!.name), ["IRET", "CLI", "STI"]);
});

type Event = readonly [name: string, value?: number | boolean | Cpu8088Flags];
function recorded(before: Cpu8088State, initial: Map<number, number>, failAt = -1, mutate?: (state: Cpu8088State, event: Event) => void) {
  const state = structuredClone(before), bytes = new Map(initial), deferred: string[] = [], events: Event[] = [];
  const snapshots: { state: Cpu8088State; bytes: Map<number, number>; deferred: string[] }[] = [], failure = Error("effect failed");
  const effect = (event: Event) => {
    snapshots.push({ state: structuredClone(state), bytes: new Map(bytes), deferred: [...deferred] }); events.push(event);
    if (events.length - 1 === failAt) throw failure;
  };
  const viewed = new Proxy(state, {
    get(target, field, receiver) {
      if (field === "flags") return new Proxy(target.flags, {
        get(target, field, receiver) { effect(["read flag " + String(field)]); return Reflect.get(target, field, receiver); },
        set(target, field, value) { effect(["write flag " + String(field), value]); return Reflect.set(target, field, value); },
      });
      effect(["read " + String(field)]); return Reflect.get(target, field, receiver);
    },
    set(target, field, value) { effect(["write " + String(field), value]); return Reflect.set(target, field, value); },
  });
  const context: Context = {
    fetchByte() { assert.fail("Resolved bodies cannot fetch instruction bytes"); },
    readByte(a) { const event: Event = ["read memory " + a]; effect(event); assert.ok(bytes.has(a)); const n = bytes.get(a)!; mutate?.(state, event); return n; },
    writeByte(a, byte) { const event: Event = ["write memory " + a, byte]; effect(event); bytes.set(a, byte); mutate?.(state, event); },
    deferInterrupt(scope) { effect(["defer " + scope]); deferred.push(scope); },
  };
  return { state, bytes, deferred, events, snapshots, failure, viewed, context };
}
function memory(before: Cpu8088State) {
  const bytes = new Map<number, number>();
  for (const [s, o] of [[segment, offset], [before.ds, before.si], [before.es, before.di], [before.ss, before.sp], [segment, wrap(before.bx + before.ax % 256)], [before.ds, wrap(before.bx + before.ax % 256)]]) {
    [0x34, 0x12, 0xef, 0xbe, 0x02, 0x02].forEach((n, i) => bytes.set(address(s!, o! + i), n));
  }
  return bytes;
}

test("all 140 new 8088 bodies preserve exact effect order and completed state at every possible failure", () => {
  for (const form of [...addressCases, ...controls, ...stringCases]) for (const bits of [0, 511]) for (const cx of [0, 1, 2]) {
    const before = initialState({ ds: 0xffff, es: 0xffff, ss: 0xffff, sp: 0xffff, si: 0xffff, di: 0,
      bx: 0xfff0, ax: 0xab20, cx, flags: flags(bits), interruptDeferred: true, recognitionDeferred: true });
    const bytes = memory(before), oracle = recorded(before, bytes);
    form.reference(oracle.viewed, oracle.context);
    for (let failAt = -1; failAt < oracle.events.length; failAt++) {
      const actual = recorded(before, bytes, failAt), oldFlags = actual.state.flags;
      const run = () => form.execute(actual.viewed, actual.context);
      if (failAt < 0) run(); else assert.throws(run, error => error === actual.failure);
      const label = [form.key, bits, cx, failAt].join(":");
      assert.deepEqual(actual.events, oracle.events.slice(0, failAt < 0 ? undefined : failAt + 1), label);
      assert.deepEqual({ state: actual.state, bytes: actual.bytes, deferred: actual.deferred },
        failAt < 0 ? { state: oracle.state, bytes: oracle.bytes, deferred: oracle.deferred } : oracle.snapshots[failAt], label);
      assert.equal(actual.state.flags === oldFlags, form.key !== "IRET" || failAt >= 0);
    }
  }
});

test("new 8088 bodies retain captured addresses and sources while later stages observe callback state changes", () => {
  for (const form of [...addressCases, ...controls, ...stringCases]) {
    const before = initialState({ cx: 3, si: 0xffff, di: 0, ss: 0xffff, sp: 0xffff, ds: segment, es: segment, flags: flags(0) });
    const bytes = memory(before);
    const mutate = (state: Cpu8088State) => {
      state.ds = 0x1111; state.es = 0x2222; state.ax = 0xa5fe; state.si = 0x300; state.di = 0x400; state.cx = 7; state.flags.df = true; state.flags.if = true;
    };
    const oracle = recorded(before, bytes, -1, mutate), actual = recorded(before, bytes, -1, mutate);
    form.reference(oracle.viewed, oracle.context); form.execute(actual.viewed, actual.context);
    assert.deepEqual(actual.events, oracle.events, form.key);
    assert.deepEqual({ state: actual.state, bytes: actual.bytes, deferred: actual.deferred },
      { state: oracle.state, bytes: oracle.bytes, deferred: oracle.deferred }, form.key);
  }
});

test("string zero counts, all incoming flags, and equal/unequal comparison results retain repeat and flag rules", () => {
  for (const form of stringCases) for (let bits = 0; bits < 512; bits++) for (const equal of [false, true]) {
    const before = initialState({ cx: bits % 3, si: 0xffff, di: 0xf, ds: segment, es: segment, ax: 0x1234, flags: flags(bits) });
    const bytes = memory(before);
    [equal ? 0x34 : 0x35, 0x12].forEach((n, i) => bytes.set(address(before.es, before.di + i), n));
    const oracle = recorded(before, bytes), actual = recorded(before, bytes);
    form.reference(oracle.viewed, oracle.context); form.execute(actual.viewed, actual.context);
    assert.deepEqual(actual.events, oracle.events, form.key);
    assert.deepEqual(actual.state, oracle.state, form.key); assert.deepEqual(actual.bytes, oracle.bytes, form.key);
  }
});
