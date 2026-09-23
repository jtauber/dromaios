import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { instructions as i8008 } from "../../../../src/components/cpus/generated/8008.js";
import { instructions as i8080 } from "../../../../src/components/cpus/generated/8080.js";
import { instructions as i8088 } from "../../../../src/components/cpus/generated/8088.js";
import { bodiesZ80 as iz80 } from "../../../helpers/z80-bodies.js";
import { instructions as instructions8008 } from "../../../../src/components/cpus/semantics/generated/8008.js";
import { instructions as instructions8080 } from "../../../../src/components/cpus/semantics/generated/8080.js";
import { instructions as instructions8088 } from "../../../../src/components/cpus/semantics/generated/8088.js";
import { instructions as instructionsZ80 } from "../../../../src/components/cpus/semantics/generated/z80.js";
import type { Cpu8008StoredState } from "../../../../src/components/cpus/semantics/generated/state/8008.js";
import type { Cpu8080State } from "../../../../src/components/cpus/semantics/generated/state/8080.js";
import { cpu8088StateDescription } from "../../../../src/components/cpus/semantics/generated/state/8088.js";
import type { Cpu8088State } from "../../../../src/components/cpus/semantics/generated/state/8088.js";
import type { CpuZ80State } from "../../../../src/components/cpus/semantics/generated/state/z80.js";
import { initialState as state8088 } from "../8088/helpers.js";
import { initialState as stateZ80 } from "../z80/helpers.js";
import { capture, cpuSymbols, flagLiteral, literal, readPort, readSource, value, when, writePort } from "../../../../src/components/cpus/semantics/model.js";
import type { InstructionDefinition, Statement } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";

interface Context {
  fetchByte(): number;
  readByte(address: number): number;
  writeByte(address: number, value: number): void;
  readPort(port: number): number;
  writePort(port: number, value: number): void;
}
type Body<State> = (state: State, context: Context) => void;
interface Case<State> { key: string; execute: Body<State>; reference: Body<State> }
const parity = (n: number) => [...n.toString(2)].filter(bit => bit === "1").length % 2 === 0;
const byte = (n: number) => (n + 256) % 256;
const word = (n: number) => (n + 65536) % 65536;

// Test-owned imperative schedules: neither encodings nor expectations come from definition builders.
const native8008: Readonly<Record<number, Body<Cpu8008StoredState>>> = i8008;
const small: Case<Cpu8008StoredState>[] = Array.from({ length: 32 }, (_, port) => ({
  key: String(0x41 + port * 2), execute: native8008[0x41 + port * 2]!,
  reference(state, context) { if (port < 8) state.a = context.readPort(port); else context.writePort(port, state.a); },
}));
const intel: Case<Cpu8080State>[] = [
  { key: String(0xdb), execute: i8080[0xdb], reference(s, c) { s.a = c.readPort(c.fetchByte()); } },
  { key: String(0xd3), execute: i8080[0xd3], reference(s, c) { c.writePort(c.fetchByte(), s.a); } },
];
const x86: Case<Cpu8088State>[] = ([
  [0xe4, false, false, false], [0xe5, false, false, true], [0xe6, true, false, false], [0xe7, true, false, true],
  [0xec, false, true, false], [0xed, false, true, true], [0xee, true, true, false], [0xef, true, true, true],
] as const).map(([opcode, output, dx, wide]) => ({
  key: String(opcode), execute: i8088[opcode],
  reference(s, c) {
    const port = dx ? s.dx : c.fetchByte();
    if (output) {
      const contents = wide ? s.ax : s.ax % 256;
      c.writePort(port, contents % 256); if (wide) c.writePort(word(port + 1), Math.floor(contents / 256));
    } else {
      const low = c.readPort(port), contents = wide ? low + c.readPort(word(port + 1)) * 256 : low;
      s.ax = wide ? contents : Math.floor(s.ax / 256) * 256 + contents;
    }
  },
}));
const z80: Case<CpuZ80State>[] = [
  { key: String(0xdb), execute: iz80.input, reference(s, c) { s.a = c.readPort(s.a * 256 + c.fetchByte()); } },
  { key: String(0xd3), execute: iz80.output, reference(s, c) { c.writePort(s.a * 256 + c.fetchByte(), s.a); } },
  ...([["b", "B", 0], ["c", "C", 1], ["d", "D", 2], ["e", "E", 3], ["h", "H", 4], ["l", "L", 5], ["a", "A", 7]] as const).flatMap(([register, suffix, code]) => [false, true].map(output => ({
    key: String(0xed40 + code * 8 + (output ? 1 : 0)),
    execute: iz80[`${output ? "output" : "input"}${suffix}`]!,
    reference(s: CpuZ80State, c: Context) {
      const port = s.b * 256 + s.c;
      if (output) c.writePort(port, s[register]);
      else {
        const contents = c.readPort(port), carry = s.flags.c;
        s.flags = { s: contents >= 128, z: contents === 0, h: false, pv: parity(contents), n: false, c: carry };
        s[register] = contents;
      }
    },
  }))),
];
const blocks = [
  ["ini", 1, false, false, 0xeda2], ["ind", -1, false, false, 0xedaa], ["inir", 1, false, true, 0xedb2], ["indr", -1, false, true, 0xedba],
  ["outi", 1, true, false, 0xeda3], ["outd", -1, true, false, 0xedab], ["otir", 1, true, true, 0xedb3], ["otdr", -1, true, true, 0xedbb],
] as const;
for (const [key, delta, output, repeat, opcode] of blocks) z80.push({ key: String(opcode), execute: iz80[key], reference(s, c) {
  const address = s.h * 256 + s.l, contents = output ? c.readByte(address) : c.readPort(s.b * 256 + s.c);
  s.b = byte(s.b - 1);
  if (output) c.writePort(s.b * 256 + s.c, contents); else c.writeByte(address, contents);
  const next = word(address + delta); s.h = Math.floor(next / 256); s.l = next % 256;
  const sum = contents + (output ? s.l : byte(s.c + delta)), result = s.b, parityCounter = s.b;
  s.flags = { s: result >= 128, z: result === 0, h: sum >= 256,
    pv: parity(sum % 8) === parity(parityCounter), n: contents >= 128, c: sum >= 256 };
  if (repeat && s.b !== 0) {
    s.pc = word(s.pc - 2);
    const count = s.b, flags = s.flags;
    let adjusted = count;
    if (flags.c) { adjusted += flags.n ? -1 : 1; flags.h = count % 16 === (flags.n ? 0 : 15); }
    flags.pv = flags.pv === parity(byte(adjusted) % 8);
  }
} });

function portDefinitions(definitions: Readonly<Record<string, InstructionDefinition>>) {
  return Object.keys(definitions).filter(key => /"kind":"(?:read|write)-port"/.test(JSON.stringify(definitions[key]))).sort();
}
test("exactly 66 complete port forms enter the executable definition inventory", () => {
  for (const [cases, definitions, count] of [[small, instructions8008, 32], [intel, instructions8080, 2],
    [z80, instructionsZ80, 24], [x86, instructions8088, 8]] as const) {
    assert.equal(cases.length, count);
    assert.deepEqual(cases.map(c => c.key).sort(), portDefinitions(definitions));
  }
});

// Observe every state/flag and bus effect, and inject failures before any chosen effect.
// Callback mutations make captured-versus-live reads distinguishable even when the final value agrees.
function observe<State extends { flags: object }>(before: State, input: number, failAt: number, mutate: (state: State) => void) {
  const state = structuredClone(before), originalFlags = state.flags, events: unknown[][] = [], memory = new Map<number, number>();
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
    fetchByte() { effect("fetch"); mutate(state); return 0xff; },
    readByte(address) { effect("read memory", address); mutate(state); return input; },
    writeByte(address, contents) { effect("write memory", address, contents); mutate(state); memory.set(address, contents); },
    readPort(port) { effect("input", port); mutate(state); return input; },
    writePort(port, contents) { effect("output", port, contents); mutate(state); },
  };
  function run(body: Body<State>) {
    let failed = false;
    try { body(observed, context); } catch (error) { if (error !== failure) throw error; failed = true; }
    return { state, events, memory, failed, replacedFlags: state.flags !== originalFlags };
  }
  return { run };
}
function compare<State extends { flags: object }>(cases: readonly Case<State>[], states: readonly State[], mutate: (state: State) => void) {
  for (const c of cases) for (const before of states) for (const input of [0, 1, 0x7f, 0x80, 0xff]) for (const change of [() => {}, mutate]) {
    const expected = observe(before, input, -1, change).run(c.reference);
    assert.deepEqual(observe(before, input, -1, change).run(c.execute), expected, c.key);
    for (let failAt = 0; failAt < expected.events.length; failAt++) {
      assert.deepEqual(observe(before, input, failAt, change).run(c.execute), observe(before, input, failAt, change).run(c.reference), `${c.key}: effect ${failAt}`);
    }
  }
}

test("8008 and 8080 port definitions preserve capture order, flags, and every failed effect", () => {
  const before: Cpu8008StoredState = { a: 0x81, b: 2, c: 3, d: 4, e: 5, h: 6, l: 7,
    flags: { s: true, z: false, p: true, c: false }, addressStack: [0, 1, 2, 3, 4, 5, 6, 0x3fff], stackIndex: 7, halted: false };
  compare(small, [before, { ...before, a: 0xff }], s => { s.a = 0x42; s.flags.c = !s.flags.c; });
  const state: Cpu8080State = { a: 0x81, b: 2, c: 3, d: 4, e: 5, h: 6, l: 7, pc: 0xffff, sp: 0,
    flags: { s: true, z: false, ac: true, p: false, cy: true }, interruptEnabled: true, interruptDeferred: false, halted: false };
  compare(intel, [state], s => { s.a = 0x42; s.flags.cy = !s.flags.cy; });
});

test("8088 port definitions capture DX and output words, preserve live AH on byte input, and commit only complete input", () => {
  compare(x86, [state8088({ dx: 0xffff, ax: 0x8123 }), state8088({ dx: 0, ax: 0xffff })],
    s => { s.dx = 0x4242; s.ax = 0xabcd; s.flags.cf = !s.flags.cf; });
});

test("Z80 port definitions preserve old addresses, live flags, block decrement/write order, and repeat corrections", () => {
  compare(z80, [0, 1, 2, 0x10, 0x80, 0xff].flatMap(b => [stateZ80({ b, c: 0xff, h: 0xff, l: 0xff, pc: 0 }),
    stateZ80({ b, c: 0, h: 0, l: 0, pc: 0xffff })]), s => { s.a = 0x42; s.b = 0x11; s.c = 0xfe; s.h = 0x12; s.l = 0x34; s.flags.c = !s.flags.c; });
});

test("port effects validate word addresses, byte values, captures, scopes, descriptions, and separate capabilities", async () => {
  const cpu = cpuSymbols("8088", cpu8088StateDescription);
  const define = (steps: readonly Statement[]) => defineInstruction({ cpu: cpu.declaration, name: "ports", explanation: "Port effect probe.", steps });
  for (const steps of [
    [readPort("byte", literal(8, 0))], [readPort("byte", literal(32, 0))], [writePort(literal(16, 0), literal(16, 0))],
    [writePort(literal(8, 0), literal(8, 0))], [readPort("byte", value("missing"))],
    [readPort("byte", literal(16, 0)), capture("byte", literal(8, 0))],
    [when(flagLiteral(true), [readPort("byte", literal(16, 0))]), capture("copy", value("byte"))],
  ]) assert.throws(() => define(steps));
  const input = define([readSource("contents", { name: "port byte", type: 8, steps: [readPort("byte", literal(16, 0xffff))], result: value("byte") }),
    writePort(literal(16, 0), value("contents"))]);
  const description = describeInstruction(input);
  assert.match(description, /read port\[FFFF:u16\]/); assert.match(description, /write port\[0000:u16\]/); assert.doesNotMatch(description, /read memory/);
  const source = generateInstructions("8088", { input: define([readPort("byte", literal(16, 0))]), output: input });
  assert.match(source, /Pick<ByteInstructionContext & BytePorts, "readPort">/);
  assert.match(source, /Pick<ByteInstructionContext & BytePorts, "readPort" \| "writePort">/);
  const compiled: { instructions: { output: Body<Cpu8088State> } } = await import("data:text/javascript," + encodeURIComponent(stripTypeScriptTypes(source)));
  const state = state8088(), events: unknown[] = [];
  compiled.instructions.output(state, { readPort(port) { events.push(["in", port]); return 0xab; }, writePort(port, value) { events.push(["out", port, value]); },
    fetchByte() { assert.fail(); }, readByte() { assert.fail(); }, writeByte() { assert.fail(); } });
  assert.deepEqual(events, [["in", 0xffff], ["out", 0, 0xab]]); assert.deepEqual(state, state8088());
});
