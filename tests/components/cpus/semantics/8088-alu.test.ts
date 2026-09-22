import assert from "node:assert/strict";
import { test } from "node:test";
import { probes } from "../../../helpers/8088-operands.js";
import { operandInstructions as operandInstructions8088 } from "../../../../src/components/cpus/semantics/generated/8088.js";
import { actions as definitions } from "../../../../src/components/cpus/semantics/generated/8088.js";
import { cpu8088StateDescription } from "../../../../src/components/cpus/semantics/generated/state/8088.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import type { Cpu8088State } from "../../../../src/components/cpus/semantics/generated/state/8088.js";
import { address, aluResult, byteMoves, flags, initialState, registerValue, replaceRegister, words } from "../8088/helpers.js";
import type { AluName } from "../8088/helpers.js";

type Context = { fetchByte(): number; readByte(address: number): number; writeByte(address: number, value: number): void };
type Case = { key: string; operation: AluName; width: 8 | 16; destination: number | "memory"; source: number | "memory" | "immediate" | "signed" };
const operations: readonly AluName[] = ["ADD", "OR", "ADC", "SBB", "AND", "SUB", "XOR", "CMP", "TEST"];
const cases: Case[] = [];
for (const width of [8, 16] as const) for (const operation of operations) {
  const add = (destination: Case["destination"], source: Case["source"], ...parts: (number | string)[]) =>
    cases.push({ key: [operation, ...parts].join("_"), operation, width, destination, source });
  for (let d = 0; d < 8; d++) for (let s = 0; s < 8; s++) add(d, s, width, d, s);
  for (let r = 0; r < 8; r++) {
    add("memory", r, "toMemory", width, r);
    if (operation !== "TEST") add(r, "memory", "fromMemory", width, r);
  }
  for (const destination of [0, 1, 2, 3, 4, 5, 6, 7, "memory"] as const) {
    add(destination, "immediate", "immediate", width, destination);
    if (width === 16 && ["ADD", "ADC", "SBB", "SUB", "CMP"].includes(operation)) add(destination, "signed", "signed", width, destination);
  }
}

// Probe arguments are raw ModR/M register selectors or a captured logical pointer.
function run(form: Case, state: Cpu8088State, segment: number, offset: number, context: Partial<Context>) {
  const { operation, width, destination, source } = form;
  const mode = source === "immediate" || source === "signed" ? source : "operand";
  const unexpected = () => { throw Error("Unexpected capability"); };
  return probes[`${operation}_${width}_${mode}`](state, destination === "memory" ? 0 : 0xc0 + destination,
    typeof source === "number" ? 0xc0 + source : 0, segment * 65536 + offset,
    { fetchByte: unexpected, readByte: unexpected, writeByte: unexpected, ...context });
}
const formNamed = (key: string) => { const form = cases.find(form => form.key === key); assert.ok(form); return form; };
const field = (width: 8 | 16, selector: number) => width === 8 ? byteMoves[selector]![1] : words[selector]!;

function observed(state: Cpu8088State, effect: (name: string) => void): Cpu8088State {
  return new Proxy(state, {
    get(target, key, receiver) {
      if (key === "flags") return new Proxy(target.flags, {
        get(target, key, receiver) { effect("read flag " + String(key)); return Reflect.get(target, key, receiver); },
        set(target, key, contents) { effect("write flag " + String(key)); return Reflect.set(target, key, contents); },
      });
      effect("read " + String(key)); return Reflect.get(target, key, receiver);
    },
    set(target, key, contents) { effect("write " + String(key)); return Reflect.set(target, key, contents); },
  });
}

test("8088 chapter ALU probes retain the 1631 resolved operand cases without unused TEST directions or signed logic", () => {
  assert.equal(cases.length, 1631);
  const keys = cases.map(form => form.key).sort();
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(Object.keys(probes).filter(key => !key.startsWith("fetchAndStore")).length, 41);
});

test("every 8088 ALU body preserves capture/flag/write order and precisely completed effects at every failure", () => {
  for (const form of cases) for (const bits of [0, 511]) {
    const { operation, width, destination, source } = form;
    const before = initialState({ flags: flags(bits) }), segment = 0xffff, offset = bits ? 0xffff : 0xf;
    const addresses = Array.from({ length: width / 8 }, (_, i) => address(segment, offset + i));
    const initialMemory = new Map(addresses.map((a, i) => [a, [0x34, 0x12][i]!]));
    const immediate = source === "signed" ? [0x80] : [0x27, 0x80].slice(0, width / 8);
    const left = destination === "memory" ? (width === 8 ? 0x34 : 0x1234) : registerValue(before, width, destination);
    const right = typeof source === "number" ? registerValue(before, width, source) : source === "memory" ? (width === 8 ? 0x34 : 0x1234)
      : source === "signed" ? 0xff80 : width === 8 ? 0x27 : 0x8027;
    const result = aluResult(operation, width, left, right, before.flags);
    const logical = ["OR", "AND", "XOR", "TEST"].includes(operation);
    const order = logical ? ["of", "cf", "af", "zf", "sf", "pf"] as const : ["cf", "af", "of", "zf", "sf", "pf"] as const;
    const events: string[] = [], snapshots: { state: Cpu8088State; bytes: Map<number, number> }[] = [];
    let expected = structuredClone(before); const expectedMemory = new Map(initialMemory);
    const event = (name: string) => { events.push(name); snapshots.push({ state: structuredClone(expected), bytes: new Map(expectedMemory) }); };
    const read = (operand: Case["source"]) => {
      if (typeof operand === "number") event("read " + field(width, operand));
      else if (operand === "memory") addresses.forEach(a => event("read memory " + a));
      else immediate.forEach(() => event("fetch"));
    };
    read(source); read(destination);
    if (operation === "ADC" || operation === "SBB") event("read flag cf");
    for (const flag of order) { event("write flag " + flag); expected.flags[flag] = result.flags[flag]; }
    if (operation !== "CMP" && operation !== "TEST") {
      if (destination === "memory") addresses.forEach((a, i) => {
        const byte = Math.floor(result.result / 256 ** i) % 256;
        event("write memory " + a + " " + byte); expectedMemory.set(a, byte);
      });
      else {
        if (width === 8) event("read " + field(width, destination));
        event("write " + field(width, destination)); expected = replaceRegister(expected, width, destination, result.result);
      }
    }
    for (let failAt = -1; failAt < events.length; failAt++) {
      const state = structuredClone(before), bytes = new Map(initialMemory), actual: string[] = [], failure = Error("effect failed");
      const flagsObject = state.flags;
      const effect = (name: string) => { actual.push(name); if (actual.length - 1 === failAt) throw failure; };
      let fetched = 0;
      const invoke = () => run(form, observed(state, effect), segment, offset, {
        fetchByte() { effect("fetch"); assert.ok(fetched < immediate.length); return immediate[fetched++]!; },
        readByte(a) { effect("read memory " + a); assert.ok(bytes.has(a)); return bytes.get(a)!; },
        writeByte(a, byte) { effect("write memory " + a + " " + byte); bytes.set(a, byte); },
      });
      if (failAt < 0) invoke(); else assert.throws(invoke, error => error === failure);
      assert.deepEqual(actual, events.slice(0, failAt < 0 ? undefined : failAt + 1), form.key);
      assert.deepEqual(state, failAt < 0 ? expected : snapshots[failAt]!.state, form.key);
      assert.deepEqual(bytes, failAt < 0 ? expectedMemory : snapshots[failAt]!.bytes, form.key);
      assert.equal(state.flags, flagsObject);
    }
  }
});

test("8088 ALU captures the source before memory reads, carry after both operands, and fixed addresses across callbacks", () => {
  const state = initialState({ ax: 0x1234, ds: 0xffff, flags: flags(0) }), oldFlags = state.flags;
  const accesses: number[] = [], writes: number[] = [];
  run(formNamed("ADC_toMemory_16_0"), state, 0xffff, 0xffff, {
    readByte(a) {
      accesses.push(a); state.ax = 0xaaaa; state.ds = 0;
      state.flags = flags(511); // Both the carry capture and later updates must observe the replacement.
      return a === 0xffef ? 0xff : 0x7f;
    },
    writeByte(a, byte) { accesses.push(a); writes.push(byte); state.ax = 0xbbbb; state.ds = 0x1234; state.flags.cf = false; },
  });
  const expected = aluResult("ADC", 16, 0x7fff, 0x1234, flags(511));
  assert.deepEqual(accesses, [0xffef, 0xffff0, 0xffef, 0xffff0]);
  assert.deepEqual(writes, [expected.result % 256, Math.floor(expected.result / 256)]);
  assert.deepEqual(state.flags, { ...expected.flags, cf: false }); assert.deepEqual(oldFlags, flags(0));

  state.ax = 1; state.flags = flags(0);
  run(formNamed("SBB_fromMemory_16_0"), state, 0xffff, 0xf, {
    readByte(a) { state.ax = 0x8000; state.flags.cf = true; return a === 0xfffff ? 0xff : 0x7f; },
  });
  assert.equal(state.ax, 0);
  assert.deepEqual(state.flags, aluResult("SBB", 16, 0x8000, 0x7fff, { ...flags(0), cf: true }).flags);
});

test("8088 immediate bodies finish fetching before destination reads and byte writes preserve the live other half after flags", () => {
  const state = initialState({ ax: 0x1234, flags: flags(0) });
  run(formNamed("ADC_immediate_8_4"), observed(state, name => {
    if (name === "write flag pf") state.ax = 0xa5ee;
  }), 0, 0, { fetchByte() { state.ax = 0x7f55; state.flags.cf = true; return 0; } });
  assert.equal(state.ax, 0x80ee);
  assert.deepEqual(state.flags, aluResult("ADC", 8, 0x7f, 0, { ...flags(0), cf: true }).flags);

  const bytes = new Map([[0xfffff, 0xff], [0, 0x7f]]), effects: string[] = [];
  run(formNamed("ADD_signed_16_memory"), state, 0xffff, 0xf, {
    fetchByte() { effects.push("fetch"); bytes.set(0, 0); return 0x80; },
    readByte(a) { effects.push("read"); return bytes.get(a)!; },
    writeByte(a, byte) { effects.push("write"); bytes.set(a, byte); },
  });
  assert.deepEqual(effects, ["fetch", "read", "read", "write", "write"]);
  assert.deepEqual([...bytes.values()], [0x7f, 0]);
});

test("8088 ALU explanations show sign extension, source/destination/carry order, flag timing, and read-only comparisons", () => {
  const describe = (action: typeof definitions.adcRM16) => describeInstruction({ ...action,
    cpu: { name: "8088", state: cpu8088StateDescription }, explanation: "Resolved arithmetic." });
  const text = describe(definitions.adcRM16);
  assert.match(describeInstruction(operandInstructions8088[0x83]!), /signExtend16\(immediate\)/);
  assert.ok(text.lastIndexOf("read memory") < text.indexOf("read CF"));
  assert.ok(text.indexOf("PF :=") < text.indexOf("write memory"));
  assert.match(text, /Flags preserved throughout: TF, IF, DF\./);
  for (const action of [definitions.cmpRM16, definitions.testRM16]) {
    const comparison = describe(action);
    assert.match(comparison, /read memory/); assert.doesNotMatch(comparison, /write memory/);
  }
});
