import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/8080.js";
import type { Cpu8080State } from "../../../../src/components/cpus/state/8080.js";

const families = [
  ["add", 0x80, 0xc6], ["adc", 0x88, 0xce], ["sub", 0x90, 0xd6], ["sbb", 0x98, 0xde],
  ["ana", 0xa0, 0xe6], ["xra", 0xa8, 0xee], ["ora", 0xb0, 0xf6], ["cmp", 0xb8, 0xfe],
] as const;
const sources = ["B", "C", "D", "E", "H", "L", "M", "A", "immediate"] as const;
// The independently specified ALU ranges all need at most these two reads.
const alu = Object.fromEntries(Object.entries(instructions).filter(([key]) => {
  const opcode = Number(key);
  return opcode >= 0x80 && opcode <= 0xbf || families.some(([, , immediate]) => opcode === immediate);
})) as Readonly<Record<number, (state: Cpu8080State, context: {
  fetchByte(): number; readByte(address: number): number;
}) => void>>;
function initialState(): Cpu8080State {
  return { a: 0x10, b: 0xff, c: 0xff, d: 0xff, e: 0xff, h: 0xff, l: 0xff, pc: 0xffff, sp: 0,
    flags: { s: false, z: false, p: false, ac: false, cy: true },
    halted: false, interruptEnabled: true, interruptDeferred: true };
}

// Arithmetic expectations use integer bounds and nibble arithmetic, independent of the generated ALU helpers.
function expected(operation: typeof families[number][0], left: number, right: number, incoming: boolean) {
  const addition = operation === "add" || operation === "adc", logical = ["ana", "xra", "ora"].includes(operation);
  const bit = Number((operation === "adc" || operation === "sbb") && incoming);
  const total = addition ? left + right + bit : left - right - bit;
  const result = logical ? { ana: left & right, xra: left ^ right, ora: left | right }[operation as "ana" | "xra" | "ora"]
    : (total + 256) % 256;
  const ac = addition ? left % 16 + right % 16 + bit >= 16 : logical
    ? operation === "ana" && (Math.floor(left / 8) % 2 === 1 || Math.floor(right / 8) % 2 === 1)
    : left % 16 >= right % 16 + bit;
  return { a: operation === "cmp" ? left : result, flags: { s: result >= 128, z: result === 0, ac,
    cy: !logical && (addition ? total >= 256 : total < 0), p: result.toString(2).replaceAll("0", "").length % 2 === 0 } };
}

test("8080 generated ALU bodies capture source, optional CY, then A; flags precede writeback and CMP never writes", () => {
  for (const [operation, base, immediate] of families) for (const source of sources) for (const incoming of [false, true]) {
    const state = initialState(), events: string[] = [];
    const carries = operation === "adc" || operation === "sbb", memory = source === "M", fetched = source === "immediate";
    const operands: number[] = [];
    let accumulatorReads = 0;
    const flags = { ...state.flags, cy: incoming };
    state.flags = new Proxy(flags, {
      get(target, key, receiver) {
        assert.ok(carries && key === "cy", "Only ADC/SBB read CY");
        events.push("read cy"); return Reflect.get(target, key, receiver);
      },
      set(target, key, value) { events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
    });
    const observed = new Proxy(state, {
      get(target, key, receiver) {
        if (["a", "b", "c", "d", "e", "h", "l"].includes(String(key))) events.push(`read ${String(key)}`);
        if (key === "a") {
          const left = source === "A" && accumulatorReads++ === 0 ? 0xff : 0x10;
          operands.push(left);
          // Detect a CY read incorrectly delayed until after the accumulator read.
          if (source !== "A" || accumulatorReads > 1) flags.cy = !incoming;
          return left;
        }
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value) { assert.equal(key, "a"); events.push("write a"); return Reflect.set(target, key, value); },
    });
    const context = {
      fetchByte() { assert.ok(fetched); events.push("fetch"); return 0xff; },
      readByte(address: number) { assert.ok(memory); assert.equal(address, 0xffff); events.push("memory"); return 0xff; },
    };
    const execute = source === "immediate" ? alu[immediate]! : alu[base + sources.indexOf(source)]!;
    execute(observed, context);
    const result = expected(operation, 0x10, 0xff, incoming);
    assert.deepEqual({ ...state, flags }, { ...initialState(), ...result }, `${operation} ${source}, CY=${incoming}`);
    assert.deepEqual(events, [
      ...(memory ? ["read h", "read l", "memory"] : fetched ? ["fetch"] : [`read ${source.toLowerCase()}`]),
      ...(carries ? ["read cy"] : []), "read a", "flag s", "flag z", "flag p", "flag cy", "flag ac",
      ...(operation === "cmp" ? [] : ["write a"]),
    ]);
    assert.deepEqual(operands, source === "A" ? [0xff, 0x10] : [0x10]);
  }
});

test("8080 generated memory and immediate ALU bodies stop on failed reads and use state changed by successful reads", () => {
  for (const [operation, base, immediate] of families) for (const memory of [false, true]) for (const fail of [false, true]) {
    const state = initialState(), before = structuredClone(state), oldFlags = state.flags;
    const events: string[] = [], failure = new Error("operand failure");
    const observed = new Proxy(state, {
      get(target, key, receiver) {
        if (key === "a") events.push("read a");
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value); },
    });
    const read = () => {
      events.push("operand");
      if (fail) throw failure;
      state.a = 0x80; state.flags = { s: true, z: true, p: true, ac: true, cy: false };
      return 0x81;
    };
    const execute = memory ? alu[base + 6]! : alu[immediate]!;
    const run = () => execute(observed, { fetchByte: read, readByte(address) { assert.equal(address, 0xffff); return read(); } });
    if (fail) assert.throws(run, error => error === failure);
    else run();
    assert.deepEqual(events, fail ? ["operand"] : ["operand", "read a", ...(operation === "cmp" ? [] : ["write a"])]);
    assert.deepEqual(state, fail ? before : { ...before, ...expected(operation, 0x80, 0x81, false) });
    assert.deepEqual(oldFlags, before.flags);
  }
});
