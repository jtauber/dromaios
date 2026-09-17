import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/8008.js";
import type { Cpu8008State } from "../../../../src/components/cpus/state/8008.js";

const families = ["ad", "ac", "su", "sb", "nd", "xr", "or", "cp"] as const;
const sources = ["A", "B", "C", "D", "E", "H", "L", "M", "immediate"] as const;
function initialState(): Cpu8008State {
  return { a: 0x10, b: 0xff, c: 0xff, d: 0xff, e: 0xff, h: 0xff, l: 0xff,
    flags: { s: false, z: true, p: false, c: true },
    addressStack: [0, 1, 2, 3, 4, 5, 6, 0x3fff], stackIndex: 7, halted: true };
}

// Integer bounds and a binary-digit count are independent of generated arithmetic and parity helpers.
function expected(operation: typeof families[number], left: number, right: number, incoming: boolean) {
  const bit = Number((operation === "ac" || operation === "sb") && incoming);
  const total = operation === "ad" || operation === "ac" ? left + right + bit
    : operation === "nd" ? left & right : operation === "xr" ? left ^ right : operation === "or" ? left | right
    : left - right - bit;
  const result = ((total % 256) + 256) % 256;
  return { a: operation === "cp" ? left : result,
    flags: { s: result >= 128, z: result === 0, p: result.toString(2).replaceAll("0", "").length % 2 === 0, c: total < 0 || total > 255 } };
}

test("8008 generated ALU bodies read source, optional C, then A; memory masks H:L and compare never writes", () => {
  for (const operation of families) for (const source of sources) for (const incoming of [false, true]) {
    for (const high of source === "M" ? [0x3f, 0x7f, 0xbf, 0xff] : [0xff]) {
      const state = { ...initialState(), h: high }, before = structuredClone(state), events: string[] = [];
      const carries = operation === "ac" || operation === "sb", flags = { ...state.flags, c: incoming };
      let readsOfA = 0;
      state.flags = new Proxy(flags, {
        get(target, key, receiver) {
          assert.ok(carries && key === "c", "Only AC/SB read incoming C");
          events.push("read carry"); return Reflect.get(target, key, receiver);
        },
        set(target, key, value) { events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
      });
      const observed = new Proxy(state, {
        get(target, key, receiver) {
          if (key === "flags") return Reflect.get(target, key, receiver);
          assert.ok(["a", "b", "c", "d", "e", "h", "l"].includes(String(key)), "No address-stack, selector, or STOPPED access");
          events.push(`read ${String(key)}`);
          if (key === "a") {
            if (source === "A" && readsOfA++ === 0) return 0xff;
            flags.c = !incoming; // A late carry read must not change the captured input.
            return 0x10;
          }
          return Reflect.get(target, key, receiver);
        },
        set(target, key, value) { assert.equal(key, "a"); events.push("write a"); return Reflect.set(target, key, value); },
      });
      const execute = source === "immediate" ? instructions[`${operation}i`] : instructions[`${operation}${source}`];
      execute(observed, {
        fetchByte() { assert.equal(source, "immediate"); events.push("fetch"); return 0xff; },
        readByte(address) { assert.equal(source, "M"); assert.equal(address, 0x3fff); events.push("memory"); return 0xff; },
      });
      assert.deepEqual({ ...state, flags }, { ...before, ...expected(operation, 0x10, 0xff, incoming) });
      assert.deepEqual(events, [
        ...(source === "M" ? ["read h", "read l", "memory"] : source === "immediate" ? ["fetch"] : [`read ${source.toLowerCase()}`]),
        ...(carries ? ["read carry"] : []), "read a", "flag s", "flag z", "flag p", "flag c",
        ...(operation === "cp" ? [] : ["write a"]),
      ]);
    }
  }
});

test("8008 generated ALU bodies stop at failed operands and use current A and flags after successful reads", () => {
  for (const operation of families) for (const memory of [false, true]) for (const fail of [false, true]) {
    const state = initialState(), before = structuredClone(state), oldFlags = state.flags, events: string[] = [];
    const failure = new Error("operand failure");
    const observed = new Proxy(state, {
      get(target, key, receiver) {
        if (key === "a" || key === "flags") events.push(`read ${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value); },
    });
    const read = () => {
      events.push("operand");
      if (fail) throw failure;
      state.a = 0x80; state.flags = { s: true, z: false, p: true, c: false };
      return 0x81;
    };
    const execute = memory ? instructions[`${operation}M`] : instructions[`${operation}i`];
    const run = () => execute(observed, { fetchByte: read, readByte(address) { assert.equal(address, 0x3fff); return read(); } });
    if (fail) assert.throws(run, error => error === failure);
    else run();
    if (fail) assert.deepEqual(events, ["operand"]);
    assert.deepEqual(state, fail ? before : { ...before, ...expected(operation, 0x80, 0x81, false) });
    assert.deepEqual(oldFlags, before.flags);
  }
});
