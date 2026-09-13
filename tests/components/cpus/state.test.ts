import assert from "node:assert/strict";
import { test } from "node:test";
import { array, boolean, choices, copyState, defineState, flag, group, readState, unsigned } from "../../../src/components/cpus/state.js";

test("state descriptions validate unsigned widths independently of CPU-specific register names", () => {
  for (const [bits, maximum] of [[1, 1], [3, 7], [8, 255], [14, 16383], [16, 65535],
    [24, 16777215], [32, 4294967295], [53, Number.MAX_SAFE_INTEGER]] as const) {
    const description = defineState({ register: unsigned(bits) });
    assert.equal(description.register.maximum, maximum);
    for (const value of [0, maximum]) assert.deepEqual(readState(description, { register: value }), { register: value });
    for (const value of [-1, maximum + 1, 0.5, NaN, Infinity, -Infinity, "0", true, null, undefined]) {
      assert.throws(() => readState(description, { register: value }), RangeError);
    }
  }
  for (const bits of [0, -1, 54, 1.5, NaN, Infinity]) assert.throws(() => unsigned(bits), RangeError);
});

test("state choices require membership, including gaps, and flags and latches require Booleans", () => {
  const description = defineState({ mode: choices(0, 2, 5), flags: group({ ready: flag }), active: boolean });
  for (const mode of [0, 2, 5]) {
    for (const bit of [false, true]) {
      const state = { mode, flags: { ready: bit }, active: bit };
      assert.deepEqual(readState(description, state), state);
    }
  }
  for (const mode of [-1, 1, 3, 4, 6, 0.5, NaN, "2", null, undefined]) {
    assert.throws(() => readState(description, { mode, flags: { ready: true }, active: false }), {
      name: "RangeError", message: "mode must be one of 0, 2, 5.",
    });
  }
  for (const value of [0, 1, "false", null, undefined]) {
    assert.throws(() => readState(description, { mode: 2, flags: { ready: value }, active: false }), {
      name: "TypeError", message: "flags.ready must be a boolean.",
    });
    assert.throws(() => readState(description, { mode: 2, flags: { ready: true }, active: value }), {
      name: "TypeError", message: "active must be a boolean.",
    });
  }
  for (const values of [[], [0, 0], [-1], [0.5], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1], Array(2)]) {
    assert.throws(() => Reflect.apply(choices, undefined, values), RangeError);
  }
});

test("fixed state arrays check every slot, reject holes, and report nested paths", () => {
  const description = defineState({ bank: group({ addresses: array(3, unsigned(14)) }) });
  assert.deepEqual(readState(description, { bank: { addresses: [0, 123, 16383] } }), { bank: { addresses: [0, 123, 16383] } });
  for (const values of [[], [0, 1], [0, 1, 2, 3], null, {}, "000", new Uint16Array(3)]) {
    assert.throws(() => readState(description, { bank: { addresses: values } }), {
      name: "TypeError", message: "bank.addresses must be an array of exactly 3 values.",
    });
  }
  for (let index = 0; index < 3; index++) {
    for (const value of [-1, 16384, NaN, undefined]) {
      const values = [0, 1, 2];
      Reflect.set(values, index, value);
      assert.throws(() => readState(description, { bank: { addresses: values } }), {
        name: "RangeError", message: `bank.addresses[${index}] must be an integer from 0 to 16383.`,
      });
    }
    const sparse = [0, 1, 2];
    Reflect.deleteProperty(sparse, index);
    assert.throws(() => readState(description, { bank: { addresses: sparse } }), RangeError);
  }
  for (const length of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => array(length, unsigned(8)), RangeError);
});

test("state copying reads only declared fields once, including inherited getters and physical array slots", () => {
  const description = defineState({ a: unsigned(8), flags: group({ c: flag }), slots: array(2, unsigned(14)) });
  const calls: string[] = [];
  const slots = [0, 0];
  for (const [index, value] of [12, 345].entries()) {
    Object.defineProperty(slots, index, { get: () => { calls.push(`slots[${index}]`); return value; } });
  }
  Object.defineProperty(slots, Symbol.iterator, { get: () => { throw new Error("Do not use a caller's iterator"); } });
  const flags = Object.create({ get c() { calls.push("flags.c"); return true; } });
  const source = Object.create({ get a() { calls.push("a"); return 42; } });
  Object.defineProperty(source, "flags", { get: () => { calls.push("flags"); return flags; } });
  Object.defineProperty(source, "slots", { get: () => { calls.push("slots"); return slots; } });
  for (const object of [source, flags, slots]) {
    Object.defineProperty(object, "metadata", { enumerable: true, get: () => { throw new Error("Metadata must be ignored"); } });
  }
  const first = readState(description, source);
  assert.deepEqual(first, { a: 42, flags: { c: true }, slots: [12, 345] });
  assert.deepEqual(calls, ["a", "flags", "flags.c", "slots", "slots[0]", "slots[1]"]);
  const second = copyState(description, first);
  first.a = 99;
  first.flags.c = false;
  first.slots[0] = 0;
  assert.deepEqual(second, { a: 42, flags: { c: true }, slots: [12, 345] });
  assert.equal(calls.length, 6);
});

test("state groups copy independently even when caller banks alias or contain references back to their parent", () => {
  const bank = { a: unsigned(8), flags: group({ c: flag }) };
  const description = defineState({ ...bank, alternate: group(bank) });
  const source = { a: 7, flags: { c: true } };
  Reflect.set(source, "alternate", source);
  const first = readState(description, source);
  const second = copyState(description, first);
  first.a = 0;
  first.flags.c = false;
  first.alternate.a = 1;
  assert.equal(first.alternate.flags.c, true);
  assert.deepEqual(second, { a: 7, flags: { c: true }, alternate: { a: 7, flags: { c: true } } });
  assert.deepEqual(source.flags, { c: true });
});

test("missing state and groups fail without inventing defaults, and field names retain ordinary object semantics", () => {
  const description = defineState({ a: unsigned(8), bank: group({ flags: group({ c: flag }) }) });
  for (const value of [null, undefined, 0, true, "state"]) assert.throws(() => readState(description, value), TypeError);
  assert.throws(() => readState(description, {}), RangeError);
  assert.throws(() => readState(description, { a: 0 }), TypeError);
  assert.throws(() => readState(description, { a: 0, bank: { flags: {} } }), TypeError);
  const names = defineState({ ["__proto__"]: unsigned(8), constructor: unsigned(16) });
  const result = readState(names, { ["__proto__"]: 12, constructor: 345 });
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.deepEqual(Object.keys(result), ["__proto__", "constructor"]);
  assert.equal(result.__proto__, 12);
  assert.equal(result.constructor, 345);
});

test("published state descriptions are immutable and own field maps and choice arrays", () => {
  const values: [0, 2, 5] = [0, 2, 5];
  const bankFields = { a: unsigned(8) };
  const fields = { flags: group({ c: flag }), halted: boolean, bank: group(bankFields),
    addresses: array(2, unsigned(14)), mode: choices(...values) };
  const description = defineState(fields);
  bankFields.a = unsigned(16);
  fields.halted = { kind: "boolean" };
  Reflect.set(values, 0, 1);
  assert.equal(description.bank.fields.a.maximum, 255);
  assert.deepEqual(description.mode.values, [0, 2, 5]);
  assert.strictEqual(description.halted, boolean);
  for (const object of [description, description.flags, description.flags.fields, flag, boolean,
    description.bank.fields.a, description.addresses, description.addresses.element, description.mode, description.mode.values]) {
    assert.equal(Object.isFrozen(object), true);
    assert.equal(Reflect.set(object, "extra", 1), false);
  }
});
