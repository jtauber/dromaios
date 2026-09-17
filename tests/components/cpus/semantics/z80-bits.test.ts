import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/z80.js";
import { initialState, expectedCb, flagPattern } from "../z80/helpers.js";

const operations = ["bit", "res", "set"] as const;
const bits = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const registers = [["B", "b"], ["C", "c"], ["D", "d"], ["E", "e"], ["H", "h"], ["L", "l"], ["A", "a"]] as const;

test("Z80 generated bit operations read one register, BIT never writes it, and RES/SET never access flags", () => {
  for (const operation of operations) for (const bit of bits) for (const [suffix, register] of registers) {
    for (const value of [0, 0x55, 0xaa, 0xff]) for (const pattern of [0, 63]) {
      const state = initialState({ [register]: value, flags: flagPattern(pattern) });
      const before = structuredClone(state), flags = state.flags, events: string[] = [];
      state.flags = new Proxy(flags, {
        get() { assert.fail("No incoming flag reads, including preserved C"); },
        set(target, key, value) { assert.notEqual(key, "c"); events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
      });
      const observed = new Proxy(state, {
        get(target, key, receiver) {
          if (key === "flags") assert.equal(operation, "bit");
          else { assert.equal(key, register); events.push(`read ${register}`); }
          return Reflect.get(target, key, receiver);
        },
        set(target, key, value) {
          assert.notEqual(operation, "bit"); assert.equal(key, register); events.push(`write ${register}`);
          return Reflect.set(target, key, value);
        },
      });
      instructions[`${operation}${bit}${suffix}`](observed);
      const expected = expectedCb(operation.toUpperCase(), bit, value, before.flags);
      assert.deepEqual({ ...state, flags }, { ...before, [register]: expected.value, flags: expected.flags });
      assert.deepEqual(events, [`read ${register}`, ...(operation === "bit"
        ? ["flag s", "flag z", "flag h", "flag pv", "flag n"] : [`write ${register}`])]);
    }
  }
});

test("Z80 generated memory bit operations retain one address, current flag storage, and exact read/write failure effects", () => {
  for (const operation of operations) for (const bit of bits) for (const address of [0, 0xffff]) for (const value of [0, 0xff]) {
    for (const failAt of operation === "bit" ? ["none", "read"] : ["none", "read", "write"]) {
      const state = initialState(), before = structuredClone(state), oldFlags = state.flags;
      const currentFlags = flagPattern(value === 0 ? 63 : 0), expected = expectedCb(operation.toUpperCase(), bit, value, { ...currentFlags });
      const events: string[] = [], failure = new Error("bit access failure");
      const observed = new Proxy(state, {
        get(target, key, receiver) {
          assert.equal(operation, "bit", "RES/SET do not access state for resolved memory"); assert.equal(key, "flags");
          return Reflect.get(target, key, receiver);
        },
        set() { assert.fail("No register writes or flag-storage replacement"); },
      });
      const run = () => instructions[`${operation}${bit}Memory`](observed, address, {
        readByte(actual) {
          assert.equal(actual, address); events.push("read");
          if (failAt === "read") throw failure;
          state.h = state.l = 0x55; state.ix = state.iy = 0x5555;
          state.flags = new Proxy(currentFlags, {
            get() { assert.fail("No incoming flag reads"); },
            set(target, key, value) { assert.notEqual(key, "c"); events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
          });
          return value;
        },
        writeByte(actual, result) {
          assert.notEqual(operation, "bit"); assert.equal(actual, address); assert.equal(result, expected.value);
          assert.deepEqual(currentFlags, expected.flags); events.push("write");
          if (failAt === "write") throw failure;
        },
      });
      if (failAt === "none") run(); else assert.throws(run, error => error === failure);
      assert.deepEqual(events, failAt === "read" ? ["read"] : ["read", ...(operation === "bit"
        ? ["flag s", "flag z", "flag h", "flag pv", "flag n"] : ["write"])]);
      assert.deepEqual({ ...state, flags: failAt === "read" ? oldFlags : currentFlags }, failAt === "read" ? before
        : { ...before, h: 0x55, l: 0x55, ix: 0x5555, iy: 0x5555, flags: expected.flags });
      assert.deepEqual(oldFlags, before.flags);
    }
  }
});
