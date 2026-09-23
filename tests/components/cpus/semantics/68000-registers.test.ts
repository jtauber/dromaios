import { initialState } from "../../../helpers/68000-state.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/68000.js";
import * as quickModule from "../../../../src/components/cpus/generated/68000-immediate.js";
import { selectFamily } from "../../../helpers/68000-families.js";
const quickFamily = selectFamily(quickModule, "moveQuick");
const { instructions: quick, opcodeInstructions: quickEntries } = quickFamily;
import { instructions68000, quick68000 } from "../../../helpers/68000-families.js";
import { instructionSet } from "../../../../src/components/cpus/semantics/builders.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { cpu68000StateDescription } from "../../../../src/components/cpus/semantics/generated/state/68000.js";
import { cpuSymbols, literal, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import type { Cpu68000State } from "../../../../src/components/cpus/semantics/generated/state/68000.js";

const data = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
const address = ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"] as const;
type Register = typeof data[number] | typeof address[number];
type StoredRegister = Exclude<Register, "a7"> | "usp" | "ssp";
type Flags = Cpu68000State["flags"];
interface Form { readonly name: string; readonly kind: "move" | "extend" | "swap" | "exchange"; readonly size: number; readonly source: Register; readonly destination: Register }

// Literal operation-word rows, independently enumerated from the instruction formats.
const moveRows = [
  { size: 8, bases: [0x1000, 0x1200, 0x1400, 0x1600, 0x1800, 0x1a00, 0x1c00, 0x1e00], destinations: data, sources: data },
  { size: 16, bases: [0x3000, 0x3200, 0x3400, 0x3600, 0x3800, 0x3a00, 0x3c00, 0x3e00], destinations: data, sources: [...data, ...address] },
  { size: 32, bases: [0x2000, 0x2200, 0x2400, 0x2600, 0x2800, 0x2a00, 0x2c00, 0x2e00], destinations: data, sources: [...data, ...address] },
  { size: 16, bases: [0x3040, 0x3240, 0x3440, 0x3640, 0x3840, 0x3a40, 0x3c40, 0x3e40], destinations: address, sources: [...data, ...address] },
  { size: 32, bases: [0x2040, 0x2240, 0x2440, 0x2640, 0x2840, 0x2a40, 0x2c40, 0x2e40], destinations: address, sources: [...data, ...address] },
] as const;
const exchangeRows = [
  { bases: [0xc140, 0xc340, 0xc540, 0xc740, 0xc940, 0xcb40, 0xcd40, 0xcf40], left: data, right: data },
  { bases: [0xc148, 0xc348, 0xc548, 0xc748, 0xc948, 0xcb48, 0xcd48, 0xcf48], left: address, right: address },
  { bases: [0xc188, 0xc388, 0xc588, 0xc788, 0xc988, 0xcb88, 0xcd88, 0xcf88], left: data, right: address },
] as const;
const suffix: Readonly<Record<number, string>> = { 8: "B", 16: "W", 32: "L" };
const forms = new Map<number, Form>();
for (const row of moveRows) row.bases.forEach((base, d) => row.sources.forEach((source, s) => {
  const destination = row.destinations[d]!;
  forms.set(base + s, { kind: "move", size: row.size, source, destination,
    name: `${destination.startsWith("a") ? "MOVEA" : "MOVE"}.${suffix[row.size]} ${source.toUpperCase()},${destination.toUpperCase()}` });
}));
for (const row of exchangeRows) row.bases.forEach((base, d) => row.right.forEach((destination, r) => {
  const source = row.left[d]!;
  forms.set(base + r, { kind: "exchange", size: 32, source, destination, name: `EXG ${source.toUpperCase()},${destination.toUpperCase()}` });
}));
for (const [base, kind, size, mnemonic] of [[0x4840, "swap", 32, "SWAP"], [0x4880, "extend", 16, "EXT.W"], [0x48c0, "extend", 32, "EXT.L"]] as const) {
  data.forEach((register, code) => forms.set(base + code, { kind, size, source: register, destination: register, name: `${mnemonic} ${register.toUpperCase()}` }));
}
const bodies: Readonly<Record<number, (state: Cpu68000State) => void>> = instructions;
const quickOpcodes: Readonly<Record<number, (state: Cpu68000State, immediate: number) => void>> = quickEntries;


const stored = (state: Cpu68000State, name: Register): StoredRegister => name === "a7" ? state.flags.s ? "ssp" : "usp" : name;
const signed = (value: number, bits: number) => value < 2 ** (bits - 1) ? value : value - 2 ** bits;
const unsignedLong = (value: number) => value < 0 ? value + 4294967296 : value;
function resultFlags(state: Cpu68000State, value: number, size: number): void {
  state.flags.n = value >= 2 ** (size - 1); state.flags.z = value === 0; state.flags.v = false; state.flags.c = false;
}

// Imperative reference uses arithmetic ranges rather than generated bitwise formulas.
function reference(state: Cpu68000State, form: Form): void {
  const source = stored(state, form.source);
  if (form.kind === "exchange") {
    const destination = stored(state, form.destination), left = state[source], right = state[destination];
    state[source] = right; state[destination] = left;
    return;
  }
  const original = state[source];
  if (form.kind === "swap") {
    const result = original % 65536 * 65536 + Math.floor(original / 65536);
    resultFlags(state, result, 32); state[source] = result;
  } else if (form.kind === "extend") {
    const from = form.size / 2, result = signed(original % 2 ** from, from);
    state[source] = form.size === 16 ? Math.floor(original / 65536) * 65536 + (result < 0 ? result + 65536 : result) : unsignedLong(result);
    resultFlags(state, result < 0 ? result + 2 ** form.size : result, form.size);
  } else {
    const result = original % 2 ** form.size, destination = stored(state, form.destination);
    if (form.destination.startsWith("a")) state[destination] = form.size === 16 ? unsignedLong(signed(result, 16)) : result;
    else {
      state[destination] = form.size === 32 ? result : Math.floor(state[destination] / 2 ** form.size) * 2 ** form.size + result;
      resultFlags(state, result, form.size);
    }
  }
}

test("68000 definitions contain exactly 792 register operation words plus eight parameterized MOVEQ forms", () => {
  assert.equal(forms.size, 792);
  const names = Object.fromEntries([...forms].map(([opcode, form]) => [opcode, form.name]));
  assert.deepEqual(Object.fromEntries(Object.entries(instructions68000).map(([opcode, definition]) => [opcode, definition.name])), names);
  assert.deepEqual(Object.keys(instructions), Object.keys(names));
  assert.deepEqual(Object.keys(quick), data.map(register => `MOVEQ #n,${register.toUpperCase()}`));
  assert.equal(Object.keys(quickOpcodes).length, 2048);
  assert.deepEqual(Object.values(quick68000).map(definition => definition.name), data.map(register => `MOVEQ #n,${register.toUpperCase()}`));
  assert.equal(forms.size + Object.keys(quick).length, 800); // Immediate byte values do not multiply coverage.
  const probe = instructions68000[0x1000]!;
  assert.throws(() => instructionSet([[0x1000, probe]]), /255/);
  assert.throws(() => instructionSet([[0x1000, probe], [0x1000, probe]], 16), /Duplicate opcode/);
  assert.throws(() => instructionSet([[0x10000, probe]], 16), /65535/);
});

test("every register form preserves independent width, bank, alias, and flag expectations", () => {
  const samples = [0, 1, 0x7f, 0x80, 0xff, 0x100, 0x7fff, 0x8000, 0xffff, 0x10000, 0x7fffffff, 0x80000000, 0xffffffff];
  for (const [opcode, form] of forms) for (let flags = 0; flags < 128; flags++) for (const sample of samples) {
    const state = initialState(flags);
    state[stored(state, form.source)] = sample;
    const expected = structuredClone(state), oldFlags = state.flags;
    reference(expected, form); bodies[opcode]!(state);
    assert.deepEqual(state, expected, `${form.name}, ${sample}, flags=${flags}`);
    assert.equal(state.flags, oldFlags, "Do not replace the flags object");
  }
});

test("MOVEQ covers every immediate byte, destination, and incoming flag pattern", () => {
  for (const [code, register] of data.entries()) for (let immediate = 0; immediate < 256; immediate++) for (let bits = 0; bits < 128; bits++) {
    const state = initialState(bits), expected = structuredClone(state);
    expected[register] = unsignedLong(signed(immediate, 8)); resultFlags(expected, expected[register], 32);
    quickOpcodes[0x7000 + code * 512 + immediate]!(state, immediate);
    assert.deepEqual(state, expected);
  }
});

interface Observation { readonly event: string; readonly value: number | boolean }
function observe(state: Cpu68000State, events: Observation[], failAt: number, failure: Error,
  mutate?: (state: Cpu68000State, event: string) => void): Cpu68000State {
  const effect = (event: string, value: number | boolean): void => {
    events.push({ event, value });
    if (events.length - 1 === failAt) throw failure;
    mutate?.(state, event);
  };
  const flags = new Proxy(state.flags, {
    get(target, key: keyof Flags) { const value = target[key]; effect(`read flag ${key}`, value); return value; },
    set(target, key: keyof Flags, value: boolean) { effect(`write flag ${key}`, value); target[key] = value; return true; },
  });
  return new Proxy(state, {
    get(target, key: keyof Cpu68000State) {
      if (key === "flags") return flags;
      const value = target[key];
      assert.equal(typeof value, "number", `Unexpected state read ${key}`);
      effect(`read ${key}`, value as number); return value;
    },
    set(target, key: StoredRegister, value: number) { effect(`write ${key}`, value); target[key] = value; return true; },
  });
}

test("all 800 bodies retain exact register/flag effect order and stop at every failed effect", () => {
  const cases = [...forms].map(([opcode, form]) => ({ name: form.name, run: bodies[opcode]!, expected: (state: Cpu68000State) => reference(state, form) }));
  cases.push(...data.map((register, code) => ({ name: `MOVEQ ${register}`, run: (state: Cpu68000State) => quickOpcodes[0x7080 + code * 512]!(state, 0x80),
    expected: (state: Cpu68000State) => { state[register] = 0xffffff80; resultFlags(state, 0xffffff80, 32); } })));
  for (const entry of cases) for (const bits of [0, 127]) {
    const schedule: Observation[] = [], failure = new Error("failed state effect");
    entry.expected(observe(initialState(bits), schedule, -1, failure));
    for (let failAt = -1; failAt < schedule.length; failAt++) {
      const state = initialState(bits), expected = structuredClone(state), actualEvents: Observation[] = [], expectedEvents: Observation[] = [];
      const actualRun = () => entry.run(observe(state, actualEvents, failAt, failure));
      const expectedRun = () => entry.expected(observe(expected, expectedEvents, failAt, failure));
      if (failAt < 0) { actualRun(); expectedRun(); }
      else { assert.throws(actualRun, error => error === failure, entry.name); assert.throws(expectedRun, error => error === failure); }
      assert.deepEqual(actualEvents, expectedEvents, entry.name); assert.deepEqual(state, expected, entry.name);
    }
  }
});

test("partial writes retain live upper bits, EXT retains its captured upper word, and A7 resolves at the specified stage", () => {
  const mutate = (state: Cpu68000State, event: string) => {
    if (event.startsWith("read ") && !event.includes("flag")) {
      state.d0 = 0xaabb8001; state.d1 = 0xccddffff; state.usp = 0x12345678; state.ssp = 0x87654321;
      state.flags.s = !state.flags.s;
    }
  };
  for (const opcode of [0x1000, 0x1200, 0x3000, 0x300f, 0x3e40, 0x3e4f, 0x2e4f, 0x4880, 0x48c0, 0x4840, 0xc148, 0xcf4f, 0xc18f]) {
    for (const bits of [0, 127]) {
      const state = initialState(bits), expected = structuredClone(state), actualEvents: Observation[] = [], expectedEvents: Observation[] = [], failure = new Error();
      bodies[opcode]!(observe(state, actualEvents, -1, failure, mutate));
      reference(observe(expected, expectedEvents, -1, failure, mutate), forms.get(opcode)!);
      assert.deepEqual(state, expected); assert.deepEqual(actualEvents, expectedEvents);
    }
  }
});

test("68000 declarations and explanations expose stored widths, flag preservation, and conditional A7 access", () => {
  const cpu = cpuSymbols("68000", cpu68000StateDescription), definition = instructions68000[0x3e4f]!;
  assert.throws(() => defineInstruction({ ...definition, steps: [writeRegister(cpu.register("d0"), literal(16, 0xffff))] }), /expected 32-bit value/);
  // @ts-expect-error A7 is a derived view, not a stored register.
  assert.throws(() => cpu.register("a7"), /stored register/);
  const description = describeInstruction(definition);
  assert.match(description, /read S/); assert.match(description, /read SSP/); assert.match(description, /read USP/);
  assert.match(description, /signExtend32/);
  assert.match(description, /Flags preserved throughout: X, N, Z, V, C, T, S\./);
});
