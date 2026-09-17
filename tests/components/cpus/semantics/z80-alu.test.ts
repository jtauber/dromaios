import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/z80.js";
import { initialState, expectedAlu, aluForms } from "../z80/helpers.js";

const families = ["add", "adc", "sub", "sbc", "and", "xor", "or", "cp"] as const;
const sources = ["B", "C", "D", "E", "H", "L", "M", "A", "Immediate", "Memory"] as const;

test("Z80 generated ALU bodies capture source, optional C, then A and apply flags before writeback", () => {
  for (const [index, operation] of families.entries()) for (const source of sources) for (const incoming of [false, true]) {
    const state = initialState({ a: 0x10, b: 0xff, c: 0xff, d: 0xff, e: 0xff, h: 0xff, l: 0xff });
    const before = structuredClone(state), events: string[] = [];
    const carries = operation === "adc" || operation === "sbc", flags = { ...state.flags, c: incoming };
    let readsOfA = 0;
    state.flags = new Proxy(flags, {
      get(target, key, receiver) {
        assert.ok(carries && key === "c", "Only ADC/SBC read incoming C");
        events.push("read carry"); return Reflect.get(target, key, receiver);
      },
      set(target, key, value) { events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
    });
    const observed = new Proxy(state, {
      get(target, key, receiver) {
        if (key === "flags") return Reflect.get(target, key, receiver);
        assert.ok(["a", "b", "c", "d", "e", "h", "l"].includes(String(key)), "No alternate-bank, pointer, or control-state reads");
        events.push(`read ${String(key)}`);
        if (key === "a") {
          if (source === "A" && readsOfA++ === 0) return 0xff;
          flags.c = !incoming; // Detect carry incorrectly sampled after A.
          return 0x10;
        }
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value) { assert.equal(key, "a"); events.push("write a"); return Reflect.set(target, key, value); },
    });
    const context = {
      fetchByte() { assert.equal(source, "Immediate"); events.push("fetch"); return 0xff; },
      readByte(address: number) {
        assert.ok(source === "M" || source === "Memory"); assert.equal(address, 0xffff);
        events.push("memory"); return 0xff;
      },
    };
    if (source === "Memory") instructions[`${operation}Memory`](observed, 0xffff, context);
    else instructions[`${operation}${source}`](observed, context);
    assert.deepEqual({ ...state, flags }, { ...before, ...expectedAlu(aluForms[index]!.name, 0x10, 0xff, incoming) });
    assert.deepEqual(events, [
      ...(source === "M" ? ["read h", "read l", "memory"] : source === "Memory" ? ["memory"]
        : source === "Immediate" ? ["fetch"] : [`read ${source.toLowerCase()}`]),
      ...(carries ? ["read carry"] : []), "read a", "flag s", "flag z", "flag h", "flag pv", "flag n", "flag c",
      ...(operation === "cp" ? [] : ["write a"]),
    ], `${operation} ${source}, C=${incoming}`);
  }
});

test("Z80 generated ALU bodies use state changed by successful reads and stop before arithmetic on failed reads", () => {
  for (const [index, operation] of families.entries()) for (const source of ["M", "Memory", "Immediate"] as const) for (const fail of [false, true]) {
    const state = initialState(), before = structuredClone(state), oldFlags = state.flags;
    const events: string[] = [], failure = new Error("operand failure");
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
      state.a = 0x80; state.flags = { s: true, z: true, h: true, pv: true, n: true, c: true };
      return 0x81;
    };
    const context = { fetchByte: read, readByte: read };
    const run = () => source === "Memory" ? instructions[`${operation}Memory`](observed, 0xffff, context)
      : instructions[`${operation}${source}`](observed, context);
    if (fail) assert.throws(run, error => error === failure);
    else run();
    if (fail) assert.deepEqual(events, ["operand"]);
    assert.deepEqual(state, fail ? before : { ...before, ...expectedAlu(aluForms[index]!.name, 0x80, 0x81, true) });
    assert.deepEqual(oldFlags, before.flags);
  }
});
