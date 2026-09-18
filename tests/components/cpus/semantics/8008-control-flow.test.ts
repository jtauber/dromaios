import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/8008.js";
import { instructions8008 } from "../../../../src/components/cpus/semantics/definitions.js";
import type { Cpu8008Flags, Cpu8008StoredState } from "../../../../src/components/cpus/state/8008.js";
import type { ByteInstructionContext } from "../../../../src/components/cpus/instruction-context.js";
import type { InstructionDefinition } from "../../../../src/components/cpus/semantics/model.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";

interface Form { opcode: number; operation: "jump" | "call" | "return" | "halt"; flag?: keyof Cpu8008Flags; set?: boolean; vector?: number }
// Independent native encodings, including every documented don't-care alias.
const forms: readonly Form[] = [
  ...[
    { flag: "c", set: false, jump: 0x40, call: 0x42, ret: 0x03 },
    { flag: "z", set: false, jump: 0x48, call: 0x4a, ret: 0x0b },
    { flag: "s", set: false, jump: 0x50, call: 0x52, ret: 0x13 },
    { flag: "p", set: false, jump: 0x58, call: 0x5a, ret: 0x1b },
    { flag: "c", set: true, jump: 0x60, call: 0x62, ret: 0x23 },
    { flag: "z", set: true, jump: 0x68, call: 0x6a, ret: 0x2b },
    { flag: "s", set: true, jump: 0x70, call: 0x72, ret: 0x33 },
    { flag: "p", set: true, jump: 0x78, call: 0x7a, ret: 0x3b },
  ].flatMap(({ flag, set, jump, call, ret }) => [
    { opcode: jump, operation: "jump", flag, set }, { opcode: call, operation: "call", flag, set },
    { opcode: ret, operation: "return", flag, set },
  ] as Form[]),
  ...[0x44, 0x4c, 0x54, 0x5c, 0x64, 0x6c, 0x74, 0x7c].map(opcode => ({ opcode, operation: "jump" as const })),
  ...[0x46, 0x4e, 0x56, 0x5e, 0x66, 0x6e, 0x76, 0x7e].map(opcode => ({ opcode, operation: "call" as const })),
  ...[0x07, 0x0f, 0x17, 0x1f, 0x27, 0x2f, 0x37, 0x3f].map(opcode => ({ opcode, operation: "return" as const })),
  ...[0x05, 0x0d, 0x15, 0x1d, 0x25, 0x2d, 0x35, 0x3d].map((opcode, index) => ({ opcode, operation: "call" as const, vector: index * 8 })),
  ...[0x00, 0x01, 0xff].map(opcode => ({ opcode, operation: "halt" as const })),
];
const definitions: Readonly<Record<number, InstructionDefinition>> = instructions8008;
const execute: Readonly<Record<number, (state: Cpu8008StoredState, instruction: ByteInstructionContext) => void>> = instructions;
const noAccess: ByteInstructionContext = {
  fetchByte() { assert.fail("Unexpected fetch"); }, readByte() { assert.fail("Unexpected data read"); }, writeByte() { assert.fail("Unexpected data write"); },
};
function initialState(slot = 7, bits = 0): Cpu8008StoredState {
  return { a: 0x81, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0xff, l: 0xee,
    flags: { c: Boolean(bits & 1), z: Boolean(bits & 2), s: Boolean(bits & 4), p: Boolean(bits & 8) },
    addressStack: [0x111, 0x222, 0x333, 0x444, 0x555, 0x666, 0x777, 0x3fff], stackIndex: slot, halted: Boolean(bits & 8) };
}

test("8008 migration contains all 59 control forms and exactly 218 ordinary forms", () => {
  assert.equal(forms.length, 59);
  assert.equal(new Set(forms.map(form => form.opcode)).size, 59);
  assert.equal(Object.keys(instructions8008).length, 218);
  const migrated = Object.keys(instructions8008).filter(key => /^\d+$/.test(key)).map(Number);
  // Numeric keys also cover the 71 byte transfers. ALU/unary bodies retain named keys.
  const transfers = [...Array.from({ length: 63 }, (_, index) => 0xc0 + index), 0x06, 0x0e, 0x16, 0x1e, 0x26, 0x2e, 0x36, 0x3e];
  assert.deepEqual(migrated.sort((a, b) => a - b), [...transfers, ...forms.map(form => form.opcode)].sort((a, b) => a - b));
});

test("8008 generated control bodies preserve every physical slot except a taken target, for all selectors and flag patterns", () => {
  for (const form of forms) for (let slot = 0; slot < 8; slot++) for (let bits = 0; bits < 16; bits++) {
    for (const target of [0, 0x3fff, 0x9234, 0xffff]) {
      const state = initialState(slot, bits), expected = structuredClone(state);
      const operands = (form.operation === "jump" || form.operation === "call") && form.vector === undefined;
      let fetched = 0;
      execute[form.opcode]!(state, { ...noAccess, fetchByte() {
        assert.ok(operands && fetched < 2); return fetched++ === 0 ? target % 256 : Math.floor(target / 256);
      } });
      const taken = form.flag === undefined || expected.flags[form.flag] === form.set;
      if (taken) {
        if (form.operation === "call") expected.stackIndex = (slot + 1) % 8;
        if (form.operation === "return") expected.stackIndex = (slot + 7) % 8;
        if (form.operation === "call" || form.operation === "jump") expected.addressStack[expected.stackIndex] = form.vector ?? target % 16384;
        if (form.operation === "halt") expected.halted = true;
      }
      assert.equal(fetched, operands ? 2 : 0);
      assert.deepEqual(state, expected, `opcode=${form.opcode}, slot=${slot}, flags=${bits}, target=${target}`);
    }
  }
});

test("8008 fetches precede condition and selector reads; failed fetches and untaken paths have no stack effects", () => {
  for (const form of forms) for (const taken of [false, true]) {
    const operands = (form.operation === "jump" || form.operation === "call") && form.vector === undefined;
    for (let failAt = -1; failAt < (operands ? 2 : 0); failAt++) {
      const state = initialState(), expected = structuredClone(state), events: string[] = [], failure = new Error("fetch failure");
      // The successful second fetch changes both flags and selector. They must be read afterwards.
      if (form.flag !== undefined) state.flags[form.flag] = expected.flags[form.flag] = operands ? !taken === form.set : taken === form.set;
      const slots = state.addressStack, flags = state.flags;
      state.addressStack = new Proxy(slots, {
        get() { assert.fail("Control bodies never read address slots"); },
        set(target, key, value) { events.push(`slot ${String(key)}=${value}`); return Reflect.set(target, key, value); },
      });
      state.flags = new Proxy(flags, {
        get(target, key, receiver) { assert.equal(key, form.flag); events.push(`flag ${String(key)}`); return Reflect.get(target, key, receiver); },
        set() { assert.fail("Flags are preserved"); },
      });
      const observed = new Proxy(state, {
        get(target, key, receiver) {
          assert.ok(["flags", "stackIndex", "addressStack"].includes(String(key)));
          if (key === "stackIndex") events.push("selector");
          return Reflect.get(target, key, receiver);
        },
        set(target, key, value) {
          assert.ok(key === "stackIndex" || key === "halted"); events.push(`${String(key)}=${value}`); return Reflect.set(target, key, value);
        },
      });
      let fetched = 0;
      const run = () => execute[form.opcode]!(observed, { ...noAccess, fetchByte() {
        const index = fetched++; events.push(`fetch ${index}`);
        if (index === failAt) throw failure;
        // Represent already completed fetch effects without granting the body any fetch policy.
        slots[7] = expected.addressStack[7] = index;
        if (index === 1) {
          state.stackIndex = expected.stackIndex = 3;
          if (form.flag !== undefined) flags[form.flag] = expected.flags[form.flag] = taken === form.set;
        }
        return index === 0 ? 0x34 : 0xd2;
      } });
      if (failAt < 0) run(); else assert.throws(run, error => error === failure);
      const expectedEvents = operands ? ["fetch 0", "fetch 1"].slice(0, failAt < 0 ? 2 : failAt + 1) : [];
      if (failAt < 0) {
        if (form.flag !== undefined) expectedEvents.push(`flag ${form.flag}`);
        if (form.flag === undefined || taken) {
          if (form.operation === "halt") { expected.halted = true; expectedEvents.push("halted=true"); }
          else {
            expectedEvents.push("selector");
            if (form.operation !== "jump") {
              expected.stackIndex = (expected.stackIndex + (form.operation === "call" ? 1 : 7)) % 8;
              expectedEvents.push(`stackIndex=${expected.stackIndex}`);
            }
            if (form.operation !== "return") {
              const target = form.vector ?? 0x1234;
              expected.addressStack[expected.stackIndex] = target;
              expectedEvents.push(`slot ${expected.stackIndex}=${target}`);
            }
          }
        }
      }
      assert.deepEqual(events, expectedEvents, `opcode=${form.opcode}, taken=${taken}, failure=${failAt}`);
      assert.deepEqual({ ...state, flags, addressStack: slots }, expected);
    }
  }
});

test("8008 calls commit the selector before a target write and returns never touch the array", () => {
  const state = initialState(), slots = state.addressStack, failure = new Error("target write failure");
  state.addressStack = new Proxy(slots, { set() { assert.equal(state.stackIndex, 0); throw failure; } });
  assert.throws(() => execute[0x05]!(state, noAccess), error => error === failure);
  assert.equal(state.stackIndex, 0);
  assert.deepEqual(slots, initialState().addressStack);
  Object.defineProperty(state, "addressStack", { get() { assert.fail("Return does not access the array"); } });
  execute[0x07]!(state, noAccess);
  assert.equal(state.stackIndex, 7);
});

test("8008 control explanations expose physical slots, narrow conversion, preserved flags, and fetch ownership", () => {
  const call = describeInstruction(definitions[0x46]!);
  assert.match(call, /fetch byte[\s\S]*fetch byte[\s\S]*low14\(concatHighLow\(high, low\)\)/);
  assert.match(call, /next := low3\(addWrap\(zeroExtend8\(slot\), 01:u8\)\)/);
  assert.match(call, /write STACKINDEX:u3 := next\nwrite ADDRESSSTACK\[next\]:u14 := target/);
  const ret = describeInstruction(definitions[0x03]!);
  assert.match(ret, /when not\(condition\) \{/);
  assert.doesNotMatch(ret, /:= read ADDRESSSTACK|write ADDRESSSTACK|fetch byte|read memory|write memory/);
  assert.match(ret, /externally supplied bytes leave it unchanged/);
  assert.match(call, /Flags preserved throughout: S, Z, P, C/);
});
