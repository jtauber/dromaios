import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/8088.js";
import { compileResolved, arithmetic8088 } from "../../../helpers/8088-resolved.js";
import { instructions8088 } from "../../../../src/components/cpus/semantics/definitions.js";
import type { Cpu8088State } from "../../../../src/components/cpus/semantics/generated/state/8088.js";
import { address, byteMoves, flags, initialState, words } from "../8088/helpers.js";

const arithmetic = await compileResolved(arithmetic8088);

type Context = { fetchByte(): number; readByte(address: number): number; writeByte(address: number, value: number): void };
type Outcome = "opcode" | "unsupported" | "divide-error" | void;
type Body = (state: Cpu8088State, context: Context) => Outcome;
type MemoryBody = (state: Cpu8088State, segment: number, offset: number, context: Context) => Outcome;
interface Case { key: string; execute: Body; reference: Body }
const bodies: Readonly<Record<string, Body | MemoryBody>> = arithmetic;
const numeric: Readonly<Partial<Record<number, Body>>> = {
  0x27: instructions[0x27], 0x2f: instructions[0x2f], 0x37: instructions[0x37], 0x3f: instructions[0x3f], 0xd4: instructions[0xd4], 0xd5: instructions[0xd5],
};
const segment = 0xffff, offset = 0xffff;
const cases: Case[] = [];
const decimalOpcodes = { 0x27: "DAA", 0x2f: "DAS", 0x37: "AAA", 0x3f: "AAS", 0xd4: "AAM", 0xd5: "AAD" };
const wrap = (n: number, bits: number) => Number(BigInt.asUintN(bits, BigInt(n)));
const signed = (n: number, bits: number) => BigInt.asIntN(bits, BigInt(n));
function resultFlags(state: Cpu8088State, value: number, width: number) {
  state.flags.zf = value === 0; state.flags.sf = value >= 2 ** (width - 1);
  state.flags.pf = (value % 256).toString(2).replaceAll("0", "").length % 2 === 0;
}

// Test-owned encodings and imperative schedules; no definition or source helper supplies the oracle.
for (const width of [8, 16] as const) for (const target of [...words.keys(), "memory"] as const) {
  const read = (state: Cpu8088State, context: Context) => {
    if (target === "memory") { const low = context.readByte(address(segment, offset)); return width === 8 ? low : low + context.readByte(address(segment, offset + 1)) * 256; }
    if (width === 16) return state[words[target]!];
    const [, word, half] = byteMoves[target]!;
    return half === "low" ? state[word] % 256 : Math.floor(state[word] / 256);
  };
  const write = (state: Cpu8088State, context: Context, value: number) => {
    if (target === "memory") { context.writeByte(address(segment, offset), value % 256); if (width === 16) context.writeByte(address(segment, offset + 1), Math.floor(value / 256)); }
    else if (width === 16) state[words[target]!] = value;
    else { const [, word, half] = byteMoves[target]!; state[word] = half === "low" ? Math.floor(state[word] / 256) * 256 + value : state[word] % 256 + value * 256; }
  };
  const add = (key: string, reference: Body) => cases.push({ key, reference, execute: (state, context) =>
    target === "memory" ? (bodies[key] as MemoryBody)(state, segment, offset, context) : (bodies[key] as Body)(state, context) });
  for (const [selector, operation] of [[0, "ROL"], [1, "ROR"], [2, "RCL"], [3, "RCR"], [4, "SHL"], [5, "SHR"], [7, "SAR"]] as const) for (const cl of [false, true]) {
    add(["shift", selector, cl ? "cl" : "one", width, target].join("_"), (state, context) => {
      const count = cl ? state.cx % 256 : 1, original = read(state, context);
      let bits = original.toString(2).padStart(width, "0");
      for (let i = 0; i < count; i++) {
        const left = ["ROL", "RCL", "SHL"].includes(operation), outgoing = left ? bits[0]! : bits.at(-1)!;
        const incoming = operation === "RCL" || operation === "RCR" ? state.flags.cf ? "1" : "0"
          : operation === "ROL" || operation === "ROR" ? outgoing : operation === "SAR" ? bits[0]! : "0";
        bits = left ? bits.slice(1) + incoming : incoming + bits.slice(0, -1);
        state.flags.cf = outgoing === "1";
      }
      const result = parseInt(bits, 2);
      if (count === 1) state.flags.of = (original >= 2 ** (width - 1)) !== (result >= 2 ** (width - 1));
      if (count > 0 && selector >= 4) { resultFlags(state, result, width); state.flags.af = false; }
      write(state, context, result);
    });
  }
  for (const operation of ["MUL", "IMUL", "DIV", "IDIV"] as const) add([operation, width, target].join("_"), (state, context) => {
    const operand = read(state, context), isSigned = operation.startsWith("I"), modulus = 2 ** width;
    const right = isSigned ? signed(operand, width) : BigInt(operand);
    if (operation === "MUL" || operation === "IMUL") {
      const accumulator = state.ax % modulus, left = isSigned ? signed(accumulator, width) : BigInt(accumulator), product = left * right;
      state.ax = Number(BigInt.asUintN(16, product));
      if (width === 16) state.dx = Number(BigInt.asUintN(16, product >> 16n));
      const overflow = isSigned ? BigInt.asIntN(width, product) !== product : product >= BigInt(modulus);
      state.flags.of = overflow; state.flags.cf = overflow;
    } else {
      const raw = width === 8 ? state.ax : state.dx * 65536 + state.ax, left = isSigned ? signed(raw, width * 2) : BigInt(raw);
      if (right === 0n) return "divide-error";
      const quotient = left / right, remainder = left % right;
      if (isSigned ? quotient <= BigInt(-modulus / 2) || quotient >= BigInt(modulus / 2) : quotient >= BigInt(modulus)) return "divide-error";
      const q = Number(BigInt.asUintN(width, quotient)), r = Number(BigInt.asUintN(width, remainder));
      state.ax = width === 8 ? r * 256 + q : q; if (width === 16) state.dx = r;
    }
  });
}
const decimals: Case[] = Object.entries(decimalOpcodes).map(([key, name]) => ({ key: name, execute: numeric[Number(key)]!, reference(state, context) {
  const subtracting = name === "DAS" || name === "AAS";
  if (name === "AAM" || name === "AAD") {
    if (context.fetchByte() !== 10) return "opcode";
    const low = state.ax % 256;
    state.ax = name === "AAD" ? (Math.floor(state.ax / 256) * 10 + low) % 256 : Math.floor(low / 10) * 256 + low % 10;
    resultFlags(state, state.ax % 256, 8);
  } else if (name === "AAA" || name === "AAS") {
    const low = state.ax % 256, high = Math.floor(state.ax / 256), adjust = low % 16 > 9 || state.flags.af, delta = adjust ? subtracting ? -1 : 1 : 0;
    state.ax = wrap(high + delta, 8) * 256 + wrap(low + delta * 6, 4);
    state.flags.cf = adjust; state.flags.af = adjust;
  } else {
    const original = state.ax % 256, low = original % 16 > 9 || state.flags.af;
    const high = original > (state.flags.af ? 159 : 153) || state.flags.cf;
    const adjustment = (low ? 6 : 0) + (high ? 96 : 0), result = wrap(original + (subtracting ? -adjustment : adjustment), 8);
    state.flags.af = low; state.flags.cf = high;
    state.ax = Math.floor(state.ax / 256) * 256 + result;
    resultFlags(state, result, 8);
  }
} }));

test("8088 chapter probes cover 324 resolved arithmetic operands and six decimal opcodes", () => {
  assert.equal(cases.length, 324);
  assert.deepEqual(Object.keys(arithmetic).sort(), cases.map(c => c.key).sort());
  assert.deepEqual(Object.keys(arithmetic8088).sort(), Object.keys(arithmetic).sort());
  assert.deepEqual(Object.fromEntries(Object.keys(decimalOpcodes).map(key => [key, instructions8088[key]!.name])), decimalOpcodes);
});

type Event = readonly [name: string, value?: number | boolean];
function observe(before: Cpu8088State, failAt = -1, changeOnRead = false, radix = 10) {
  const state = structuredClone(before), bytes = new Map([[address(segment, offset), 0x81], [address(segment, offset + 1), 0xff]]);
  const events: Event[] = [], partial: { state: Cpu8088State; bytes: Map<number, number> }[] = [], failure = Error("failed effect");
  const effect = (event: Event) => { partial.push({ state: structuredClone(state), bytes: new Map(bytes) }); events.push(event); if (events.length - 1 === failAt) throw failure; };
  const observed = new Proxy(state, {
    get(target, key, receiver) {
      if (key === "flags") return new Proxy(target.flags, {
        get(target, key, receiver) { effect(["read flag " + String(key)]); return Reflect.get(target, key, receiver); },
        set(target, key, value) { effect(["write flag " + String(key), value]); return Reflect.set(target, key, value); },
      });
      effect(["read " + String(key)]); return Reflect.get(target, key, receiver);
    },
    set(target, key, value) { effect(["write " + String(key), value]); return Reflect.set(target, key, value); },
  });
  const context: Context = {
    fetchByte() { effect(["fetch"]); if (changeOnRead) state.ax = 0x9a9e; return radix; },
    readByte(a) {
      effect(["read memory", a]); assert.ok(bytes.has(a));
      if (changeOnRead) { state.ax = 0x8001; state.dx = 0; state.cx = 0xffff; state.flags.cf = !state.flags.cf; }
      return bytes.get(a)!;
    },
    writeByte(a, byte) { effect(["write memory " + a, byte]); bytes.set(a, byte); },
  };
  return { state, bytes, observed, events, partial, failure, context };
}

test("every new 8088 arithmetic body preserves exact effect order, rejection, and each failed-effect prefix", () => {
  for (const form of [...cases, ...decimals]) for (const bits of [0, 511]) for (const count of [0, 1, 2, 9]) {
    const before = initialState({ ax: 0x009e, dx: 0, cx: 0xaa00 + count, flags: flags(bits) }), expected = observe(before);
    const outcome = form.reference(expected.observed, expected.context);
    for (let failAt = -1; failAt < expected.events.length; failAt++) {
      const actual = observe(before, failAt), originalFlags = actual.state.flags;
      const run = () => form.execute(actual.observed, actual.context), label = [form.key, bits, count, failAt].join(":");
      if (failAt < 0) assert.equal(run(), outcome, label); else assert.throws(run, error => error === actual.failure, label);
      const after = failAt < 0 ? expected : expected.partial[failAt]!;
      assert.deepEqual(actual.events, expected.events.slice(0, failAt < 0 ? undefined : failAt + 1), label);
      assert.deepEqual(actual.state, after.state, label); assert.deepEqual(actual.bytes, after.bytes, label);
      assert.equal(actual.state.flags, originalFlags, label);
    }
  }
});

test("arithmetic captures live operands at their specified stages, including CL before mutating memory reads", () => {
  for (const form of [...cases, ...decimals]) for (const count of [0, 1, 255]) {
    const before = initialState({ ax: 0x9a9e, dx: 0xffff, cx: count, flags: flags(511) });
    const actual = observe(before, -1, true), expected = observe(before, -1, true);
    assert.equal(form.execute(actual.observed, actual.context), form.reference(expected.observed, expected.context), form.key);
    assert.deepEqual(actual.events, expected.events, form.key); assert.deepEqual(actual.state, expected.state, form.key);
    assert.deepEqual(actual.bytes, expected.bytes, form.key);
  }
});

test("decimal bodies exhaust byte and flag inputs, and radix bodies reject before register effects", () => {
  for (const form of decimals) for (let bits = 0; bits < 512; bits++) for (let al = 0; al < 256; al++) {
    const before = initialState({ ax: (bits % 256) * 256 + al, flags: flags(bits) }), actual = structuredClone(before), expected = structuredClone(before);
    const context = { fetchByte: () => 10, readByte: () => assert.fail(), writeByte: () => assert.fail() };
    assert.equal(form.execute(actual, context), form.reference(expected, context));
    assert.deepEqual(actual, expected, form.key);
  }
  for (const opcode of [0xd4, 0xd5]) for (let radix = 0; radix < 256; radix++) {
    if (radix === 10) continue;
    const actual = observe(initialState(), -1, false, radix);
    assert.equal(numeric[opcode]!(actual.observed, actual.context), "opcode");
    assert.deepEqual(actual.events, [["fetch"]]); assert.deepEqual(actual.state, initialState());
  }
});
