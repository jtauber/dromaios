import assert from "node:assert/strict";
import { test } from "node:test";
import { bodiesZ80 as instructions } from "../../../helpers/z80-bodies.js";
import { initialState, expectedCb, flagPattern } from "../z80/helpers.js";

const operations = ["rlc", "rrc", "rl", "rr", "sla", "sra", "srl"] as const;
const registers = [["B", "b"], ["C", "c"], ["D", "d"], ["E", "e"], ["H", "h"], ["L", "l"], ["A", "a"]] as const;

test("Z80 generated register shifts capture the operand before C and apply all flags before writeback", () => {
  for (const operation of operations) for (const [suffix, register] of registers) {
    for (const value of [0, 1, 0x7f, 0x80, 0xff]) for (const carry of [false, true]) {
      const state = initialState({ [register]: value, flags: { ...flagPattern(63), c: carry } });
      const before = structuredClone(state), flags = state.flags, events: string[] = [];
      const throughCarry = operation === "rl" || operation === "rr";
      state.flags = new Proxy(flags, {
        get(target, key, receiver) {
          assert.ok(throughCarry); assert.equal(key, "c"); events.push("read c");
          state[register] = 0x55; // The operand is already captured, including when it is H, L, or A.
          return Reflect.get(target, key, receiver);
        },
        set(target, key, value) { events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
      });
      const observed = new Proxy(state, {
        get(target, key, receiver) {
          if (key !== "flags") { assert.equal(key, register); events.push(`read ${register}`); }
          return Reflect.get(target, key, receiver);
        },
        set(target, key, value) { assert.equal(key, register); events.push(`write ${register}`); return Reflect.set(target, key, value); },
      });
      instructions[`${operation}${suffix}`](observed);
      const expected = expectedCb(operation.toUpperCase(), 0, value, before.flags);
      assert.deepEqual({ ...state, flags }, { ...before, [register]: expected.value, flags: expected.flags });
      assert.deepEqual(events, [`read ${register}`, ...(throughCarry ? ["read c"] : []),
        "flag s", "flag z", "flag h", "flag pv", "flag n", "flag c", `write ${register}`]);
    }
  }
});

test("Z80 generated memory shifts use current carry after reading, retain one address, and retain calculated flags on write failure", () => {
  for (const operation of operations) for (const carry of [false, true]) for (const value of [0, 0x81, 0xff]) {
    for (const address of [0, 0xffff]) for (const failAt of ["none", "read", "write"]) {
      const state = initialState({ flags: { ...flagPattern(0), c: !carry } }), before = structuredClone(state), oldFlags = state.flags;
      const events: string[] = [], failure = new Error("memory shift failure");
      const currentFlags = { ...flagPattern(63), c: carry }, expected = expectedCb(operation.toUpperCase(), 0, value, currentFlags);
      const observed = new Proxy(state, {
        get(target, key, receiver) { assert.equal(key, "flags", "No pointer, alternate-bank, or control-state reads"); return Reflect.get(target, key, receiver); },
        set() { assert.fail("No register writes or replacement of the current flag storage"); },
      });
      const run = () => instructions[`${operation}Memory`](observed, address, {
        readByte(actual) {
          assert.equal(actual, address); events.push("read");
          if (failAt === "read") throw failure;
          state.h = state.l = 0x55; state.ix = state.iy = 0x5555;
          state.flags = new Proxy(currentFlags, {
            get(target, key, receiver) {
              assert.ok(operation === "rl" || operation === "rr"); assert.equal(key, "c"); events.push("read c");
              return Reflect.get(target, key, receiver);
            },
            set(target, key, value) { events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
          });
          return value;
        },
        writeByte(actual, result) {
          assert.equal(actual, address); assert.equal(result, expected.value); assert.deepEqual(currentFlags, expected.flags);
          events.push("write"); if (failAt === "write") throw failure;
        },
      });
      if (failAt === "none") run(); else assert.throws(run, error => error === failure);
      assert.deepEqual(events, failAt === "read" ? ["read"] : ["read", ...(operation === "rl" || operation === "rr" ? ["read c"] : []),
        "flag s", "flag z", "flag h", "flag pv", "flag n", "flag c", "write"]);
      assert.deepEqual({ ...state, flags: failAt === "read" ? oldFlags : currentFlags }, failAt === "read" ? before
        : { ...before, h: 0x55, l: 0x55, ix: 0x5555, iy: 0x5555, flags: expected.flags });
      assert.deepEqual(oldFlags, before.flags);
    }
  }
});

test("Z80 generated accumulator rotates preserve S/Z/PV and write A before C and N/H", () => {
  for (const [operation, cb] of [["rlca", "RLC"], ["rrca", "RRC"], ["rla", "RL"], ["rra", "RR"]] as const) {
    for (const a of [0, 1, 0x7f, 0x80, 0xff]) for (const bits of [0, 21, 42, 63]) {
      const state = initialState({ a, flags: flagPattern(bits) }), before = structuredClone(state), flags = state.flags, events: string[] = [];
      const throughCarry = operation === "rla" || operation === "rra";
      state.flags = new Proxy(flags, {
        get(target, key, receiver) {
          assert.ok(throughCarry); assert.equal(key, "c"); events.push("read c");
          state.a = 0x55; return Reflect.get(target, key, receiver);
        },
        set(target, key, value) { events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
      });
      const observed = new Proxy(state, {
        get(target, key, receiver) {
          if (key !== "flags") { assert.equal(key, "a"); events.push("read a"); }
          return Reflect.get(target, key, receiver);
        },
        set(target, key, value) { assert.equal(key, "a"); events.push("write a"); flags.c = !flags.c; return Reflect.set(target, key, value); },
      });
      instructions[operation](observed);
      const expected = expectedCb(cb, 0, a, before.flags);
      assert.deepEqual({ ...state, flags }, { ...before, a: expected.value, flags: { ...before.flags, c: expected.flags.c, h: false, n: false } });
      assert.deepEqual(events, ["read a", ...(throughCarry ? ["read c"] : []), "write a", "flag c", "flag n", "flag h"]);
    }
  }
});
