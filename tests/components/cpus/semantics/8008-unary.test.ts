import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/8008.js";
import type { Cpu8008StoredState } from "../../../../src/components/cpus/state/8008.js";

function initialState(): Cpu8008StoredState {
  return { a: 0x81, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0xe6, l: 0x77,
    flags: { s: true, z: false, p: true, c: false },
    addressStack: [0, 1, 2, 3, 4, 5, 6, 0x3fff], stackIndex: 7, halted: true };
}

test("8008 generated adjustments read only their register, preserve C without reading it, and apply S/Z/P before writeback", () => {
  for (const register of ["b", "c", "d", "e", "h", "l"] as const) for (const operation of ["in", "dc"] as const) {
    for (const original of [0, 0x7f, 0x80, 0xff]) for (const carry of [false, true]) {
      const state = { ...initialState(), [register]: original }, events: string[] = [];
      state.flags.c = carry;
      const before = structuredClone(state), flags = state.flags;
      state.flags = new Proxy(flags, {
        get() { assert.fail("Adjustments do not read flags"); },
        set(target, key, value) { assert.notEqual(key, "c"); events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
      });
      const observed = new Proxy(state, {
        get(target, key, receiver) {
          if (key !== "flags") { assert.equal(key, register); events.push(`read ${register}`); }
          return Reflect.get(target, key, receiver);
        },
        set(target, key, value) { assert.equal(key, register); events.push(`write ${register}`); return Reflect.set(target, key, value); },
      });
      instructions[`${operation}${register}`](observed);
      const result = (original + (operation === "in" ? 1 : 255)) % 256;
      assert.deepEqual({ ...state, flags }, { ...before, [register]: result,
        flags: { s: result >= 128, z: result === 0, p: result.toString(2).replaceAll("0", "").length % 2 === 0, c: carry } });
      assert.deepEqual(events, [`read ${register}`, "flag s", "flag z", "flag p", `write ${register}`]);
    }
  }
});

test("8008 generated rotates capture A before incoming C, then write A before replacing only C", () => {
  for (const operation of ["rlc", "rrc", "ral", "rar"] as const) for (const a of [0, 1, 0x7f, 0x80, 0xff]) {
    for (const carry of [false, true]) {
      const state = { ...initialState(), a }, events: string[] = [];
      state.flags.c = carry;
      const before = structuredClone(state), flags = state.flags;
      const throughCarry = operation === "ral" || operation === "rar", left = operation === "rlc" || operation === "ral";
      state.flags = new Proxy(flags, {
        get(target, key, receiver) {
          assert.ok(throughCarry); assert.equal(key, "c"); events.push("read c");
          state.a = 0x55; // A has already been captured, so this must not affect the result or outgoing C.
          return Reflect.get(target, key, receiver);
        },
        set(target, key, value) { assert.equal(key, "c"); events.push("flag c"); return Reflect.set(target, key, value); },
      });
      const observed = new Proxy(state, {
        get(target, key, receiver) {
          if (key !== "flags") { assert.equal(key, "a"); events.push("read a"); }
          return Reflect.get(target, key, receiver);
        },
        set(target, key, value) {
          assert.equal(key, "a"); events.push("write a"); flags.c = !carry;
          return Reflect.set(target, key, value);
        },
      });
      instructions[operation](observed);
      const binary = a.toString(2).padStart(8, "0"), outgoing = binary[left ? 0 : 7]!;
      const incoming = throughCarry ? String(Number(carry)) : outgoing;
      const result = Number.parseInt(left ? binary.slice(1) + incoming : incoming + binary.slice(0, 7), 2);
      assert.deepEqual({ ...state, flags }, { ...before, a: result, flags: { ...before.flags, c: outgoing === "1" } });
      assert.deepEqual(events, ["read a", ...(throughCarry ? ["read c"] : []), "write a", "flag c"]);
    }
  }
});
