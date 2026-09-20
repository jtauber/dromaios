import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions as mos } from "../../../../src/components/cpus/generated/6502.js";
import { instructions as mosEntry } from "../../../../src/components/cpus/generated/6502-interrupts.js";
import { instructions as m6800 } from "../../../../src/components/cpus/generated/6800.js";
import { instructions as m6809 } from "../../../../src/components/cpus/generated/6809.js";
import { instructions as intel } from "../../../../src/components/cpus/generated/8080.js";
import { instructions as z80 } from "../../../../src/components/cpus/generated/z80.js";
import { instructions6502, instructions6800, instructions6809, instructions8080, instructionsZ80 } from "../../../../src/components/cpus/semantics/definitions.js";
import type { Cpu6502State } from "../../../../src/components/cpus/state/6502.js";
import type { Cpu6800State } from "../../../../src/components/cpus/state/6800.js";
import type { Cpu6809State } from "../../../../src/components/cpus/state/6809.js";
import type { Cpu8080State } from "../../../../src/components/cpus/state/8080.js";
import type { CpuZ80State } from "../../../../src/components/cpus/state/z80.js";
import type { InstructionDefinition } from "../../../../src/components/cpus/semantics/model.js";
import { initialState as initialZ80 } from "../z80/helpers.js";

interface Context {
  fetchByte(): number;
  readByte(address: number): number;
  writeByte(address: number, value: number): void;
  deferInterrupt(scope: "irq"): void;
  notifyReti(): void;
}
type Body<State> = (state: State, context: Context) => void;
interface Case<State> { name: string; actual: Body<State>; reference: Body<State> }
const byte = (n: number) => (n + 256) % 256, word = (n: number) => (n + 65536) % 65536;
// Test-owned layouts and physical schedules. No production stack, status, or semantic helper supplies expectations.
const mosBits = { n: 7, v: 6, d: 3, i: 2, z: 1, c: 0 }, m6800Bits = { h: 5, i: 4, n: 3, z: 2, v: 1, c: 0 };
const m6809Bits = { e: 7, f: 6, h: 5, i: 4, n: 3, z: 2, v: 1, c: 0 };
function pack<Flags extends Record<string, boolean>>(flags: Flags, layout: Record<keyof Flags, number>, fixed: number) {
  let result = fixed; for (const field of Object.keys(layout) as (keyof Flags)[]) if (flags[field]) result += 2 ** layout[field]; return result;
}
function unpack<Layout extends Record<string, number>>(value: number, layout: Layout): { [Key in keyof Layout]: boolean } {
  return Object.fromEntries(Object.entries(layout).map(([field, bit]) => [field, Math.floor(value / 2 ** bit) % 2 === 1])) as { [Key in keyof Layout]: boolean };
}
function enter6502(s: Cpu6502State, c: Context, vector: number, software: boolean) {
  const push = (value: number) => { c.writeByte(0x100 + s.sp, value); s.sp = byte(s.sp - 1); };
  push(Math.floor(s.pc / 256)); push(s.pc % 256); push(pack(s.flags, mosBits, software ? 0x30 : 0x20));
  s.flags.i = true; const low = c.readByte(vector), high = c.readByte(vector + 1); s.pc = low + high * 256;
}
const mosCases: Case<Cpu6502State>[] = [
  { name: "BRK", actual: mos[0], reference(s, c) { c.fetchByte(); enter6502(s, c, 0xfffe, true); } },
  { name: "RTI", actual: mos[0x40], reference(s, c) {
    const pop = () => { s.sp = byte(s.sp + 1); return c.readByte(0x100 + s.sp); };
    s.flags = unpack(pop(), mosBits); const low = pop(), high = pop(); s.pc = low + high * 256;
  } },
  ...[0xfffa, 0xfffe].map(vector => ({ name: "external " + vector,
    actual: (s: Cpu6502State, c: Context) => mosEntry.enter(s, vector, c), reference: (s: Cpu6502State, c: Context) => enter6502(s, c, vector, false) })),
];
function save6800(s: Cpu6800State, c: Context) {
  const push = (value: number) => { c.writeByte(s.sp, value); s.sp = word(s.sp - 1); };
  const pushWord = (value: number) => { push(value % 256); push(Math.floor(value / 256)); };
  pushWord(s.pc); pushWord(s.x); push(s.a); push(s.b); push(pack(s.flags, m6800Bits, 0xc0));
}
function enter6800(s: Cpu6800State, c: Context, vector: number) {
  if (!s.waiting) save6800(s, c); s.waiting = false; s.flags.i = true;
  const high = c.readByte(vector), low = c.readByte(vector + 1); s.pc = high * 256 + low;
}
const m6800Cases: Case<Cpu6800State>[] = [
  { name: "SWI", actual: m6800.swi, reference(s, c) { enter6800(s, c, 0xfffa); } },
  { name: "WAI", actual: m6800.wai, reference(s, c) { save6800(s, c); s.waiting = true; } },
  { name: "RTI", actual: m6800.rti, reference(s, c) {
    const pop = () => { s.sp = word(s.sp + 1); return c.readByte(s.sp); };
    const popWord = () => { const high = pop(); return high * 256 + pop(); };
    s.flags = unpack(pop(), m6800Bits); s.b = pop(); s.a = pop(); s.x = popWord(); s.pc = popWord();
  } },
  ...[0xfff8, 0xfffc].map(vector => ({ name: "external " + vector,
    actual: (s: Cpu6800State, c: Context) => m6800.enterInterrupt(s, vector, c), reference: (s: Cpu6800State, c: Context) => enter6800(s, c, vector) })),
];
function save6809(s: Cpu6809State, c: Context) {
  s.flags.e = true;
  const push = (value: number) => { s.s = word(s.s - 1); c.writeByte(s.s, value); };
  const pushWord = (value: number) => { push(value % 256); push(Math.floor(value / 256)); };
  pushWord(s.pc); pushWord(s.u); pushWord(s.y); pushWord(s.x); push(s.dp); push(s.b); push(s.a); push(pack(s.flags, m6809Bits, 0));
}
const m6809Cases: Case<Cpu6809State>[] = [
  ...([["swi", 0xfffa, 0x50], ["swi2", 0xfff4, 0], ["swi3", 0xfff2, 0]] as const).map(([name, vector, mask]) => ({
    name: name.toUpperCase(), actual: m6809[name], reference(s: Cpu6809State, c: Context) {
      if (s.waitMode !== "cwai") save6809(s, c);
      s.flags = unpack(pack(s.flags, m6809Bits, 0) | mask, m6809Bits); s.waitMode = "none";
      const high = c.readByte(vector), low = c.readByte(vector + 1); s.pc = high * 256 + low;
    },
  })),
  { name: "SYNC", actual: m6809.sync, reference(s) { s.waitMode = "sync"; } },
  { name: "CWAI", actual: m6809.cwai, reference(s, c) { s.flags = unpack(pack(s.flags, m6809Bits, 0) & c.fetchByte(), m6809Bits); save6809(s, c); s.waitMode = "cwai"; } },
  { name: "RTI", actual: m6809.rti, reference(s, c) {
    const pop = () => { const contents = c.readByte(s.s); s.s = word(s.s + 1); return contents; };
    const popWord = () => { const high = pop(); return high * 256 + pop(); };
    s.flags = unpack(pop(), m6809Bits);
    if (s.flags.e) { s.a = pop(); s.b = pop(); s.dp = pop(); s.x = popWord(); s.y = popWord(); s.u = popWord(); }
    s.pc = popWord(); s.nmiArmed = true;
  } },
];
const intelCases: Case<Cpu8080State>[] = [
  { name: "DI", actual: intel[0xf3], reference(s) { s.interruptEnabled = false; } },
  { name: "EI", actual: intel[0xfb], reference(s, c) { s.interruptEnabled = true; c.deferInterrupt("irq"); } },
];
const z80Cases: Case<CpuZ80State>[] = [
  { name: "DI", actual: z80.di, reference(s) { s.iff1 = s.iff2 = false; } },
  { name: "EI", actual: z80.ei, reference(s, c) { s.iff1 = s.iff2 = true; c.deferInterrupt("irq"); } },
  ...([0, 1, 2] as const).map(mode => ({ name: "IM " + mode, actual: z80[`im${mode}`], reference(s: CpuZ80State) { s.im = mode; } })),
  ...([false, true] as const).map(notify => ({ name: notify ? "RETI" : "RETN", actual: notify ? z80.reti : z80.retn,
    reference(s: CpuZ80State, c: Context) {
      const low = c.readByte(s.sp); s.sp = word(s.sp + 1); const high = c.readByte(s.sp); s.sp = word(s.sp + 1); s.pc = low + high * 256;
      if (s.iff1 !== s.iff2) c.deferInterrupt("irq"); s.iff1 = s.iff2; if (notify) c.notifyReti();
    },
  })),
];

test("twenty documented interrupt/control forms and two external entry helpers are defined", () => {
  assert.deepEqual([instructions6502[0]!.name, instructions6502[0x40]!.name], ["BRK", "RTI"]);
  const inventories: readonly [Readonly<Record<string, InstructionDefinition | undefined>>, readonly string[], readonly string[]][] = [
    [instructions6800, ["swi", "wai", "rti"], ["SWI", "WAI", "RTI"]],
    [instructions6809, ["swi", "swi2", "swi3", "sync", "cwai", "rti"], ["SWI", "SWI2", "SWI3", "SYNC", "CWAI", "RTI"]],
    [instructions8080, [String(0xf3), String(0xfb)], ["DI", "EI"]],
    [instructionsZ80, ["di", "ei", "im0", "im1", "im2", "retn", "reti"], ["DI", "EI", "IM 0", "IM 1", "IM 2", "RETN", "RETI"]],
  ];
  for (const [definitions, keys, names] of inventories) assert.deepEqual(keys.map(k => definitions[k]!.name), names);
  assert.equal(Object.keys(instructions6502).length, 151);
  assert.equal(Object.keys(instructions8080).length, 244);
  assert.equal(Object.keys(instructionsZ80).length, 607);
  assert.equal("pullFrame" in m6809, false, "RTI replaces the old partial-return helper");
});

function observe<State extends { flags: object }>(before: State, data: number, failAt: number, mutate: (state: State) => void) {
  const state = structuredClone(before), originalFlags = state.flags, memory = new Map<number, number>(), events: unknown[][] = [];
  const failure = Error("injected effect failure");
  const effect = (...event: unknown[]) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
  const observed = new Proxy(state, {
    get(target, key, receiver) {
      if (key === "flags") return new Proxy(target.flags, {
        get(target, key, receiver) { const contents = Reflect.get(target, key, receiver); effect("read flag", key, contents); return contents; },
        set(target, key, contents) { effect("write flag", key, contents); return Reflect.set(target, key, contents); },
      });
      const contents = Reflect.get(target, key, receiver); effect("read", key, contents); return contents;
    },
    set(target, key, contents) { effect("write", key, structuredClone(contents)); return Reflect.set(target, key, contents); },
  });
  const context: Context = {
    fetchByte() { effect("fetch"); mutate(state); return data; },
    readByte(address) { effect("read memory", address); mutate(state); return memory.get(address) ?? (address % 2 ? 255 - data : data); },
    writeByte(address, contents) { effect("write memory", address, contents); mutate(state); memory.set(address, contents); },
    deferInterrupt(scope) { effect("defer", scope); mutate(state); }, notifyReti() { effect("notify"); mutate(state); },
  };
  return (body: Body<State>) => {
    let failed = false;
    try { body(observed, context); } catch (e) { if (e !== failure) throw e; failed = true; }
    return { state, memory, events, failed, replacedFlags: state.flags !== originalFlags };
  };
}
function compare<State extends { flags: object }>(cases: readonly Case<State>[], states: readonly State[], mutate: (state: State) => void) {
  for (const c of cases) for (const state of states) for (const data of [0, 0x7f, 0x80, 0xff]) for (const change of [() => {}, mutate]) {
    const complete = observe(state, data, -1, change)(c.reference);
    assert.deepEqual(observe(state, data, -1, change)(c.actual), complete, c.name);
    for (let failAt = 0; failAt < complete.events.length; failAt++) assert.deepEqual(observe(state, data, failAt, change)(c.actual),
      observe(state, data, failAt, change)(c.reference), `${c.name}, failed effect ${failAt}`);
  }
}

test("6502 frames preserve live PC byte reads, status timing, wrapping, and partial failures", () => {
  compare(mosCases, [0, 0xff].flatMap(sp => [0, 255].map(flags => ({ a: 1, x: 2, y: 3, pc: 0xabcd, sp, flags: unpack(flags, mosBits) }))),
    s => { s.pc = word(s.pc + 1); s.sp = byte(s.sp + 1); s.flags.i = !s.flags.i; s.flags.d = !s.flags.d; });
});

test("6800 full frames retain each completed field and reuse WAI frames without a second push", () => {
  compare(m6800Cases, [0, 0xffff].flatMap(sp => [false, true].map(waiting => ({ a: 1, b: 2, x: 0x3456, pc: 0xabcd, sp, waiting, flags: unpack(sp % 256, m6800Bits) }))),
    s => { s.pc = word(s.pc + 1); s.sp = word(s.sp + 1); s.x = word(s.x + 0x101); s.a = byte(s.a + 1); s.b = byte(s.b + 1); s.flags.i = !s.flags.i; });
});

test("6809 software entries and full/short returns preserve CWAI, E selection, NMI arming, and partial failures", () => {
  compare(m6809Cases, [0, 0xffff].flatMap(s => (["none", "sync", "cwai"] as const).map(waitMode => ({ a: 1, b: 2, dp: 3, x: 0x4567, y: 0x6789, u: 0x89ab, s,
    pc: 0xabcd, waitMode, nmiArmed: false, flags: unpack(s % 256, m6809Bits) }))),
    s => { s.s = word(s.s + 1); s.pc = word(s.pc + 1); s.u = word(s.u + 1); s.a = byte(s.a + 1); s.flags.i = !s.flags.i; s.flags.e = !s.flags.e; });
});

test("8080 and Z80 controls preserve latch write order, mode choices, return commit, and retirement requests", () => {
  compare(intelCases, [false, true].map(enabled => ({ a: 1, b: 2, c: 3, d: 4, e: 5, h: 6, l: 7, pc: 0, sp: 0xffff,
    flags: { s: true, z: false, ac: true, p: false, cy: true }, halted: false, interruptEnabled: enabled, interruptDeferred: !enabled })),
    s => { s.interruptEnabled = !s.interruptEnabled; });
  compare(z80Cases, [0, 0xffff].flatMap(sp => [false, true].flatMap(iff1 => [false, true].map(iff2 => initialZ80({ sp, iff1, iff2 })))),
    s => { s.sp = word(s.sp + 1); s.iff1 = !s.iff1; s.iff2 = !s.iff2; });
});
