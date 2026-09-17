import assert from "node:assert/strict";
import { test } from "node:test";
import { arithmeticChanges, arithmeticForms, wordChanges, wordState } from "../../../helpers/intel-words.js";
import { flagPattern } from "../z80/helpers.js";

test("Intel word arithmetic has twelve 8080 and 32 Z80 complete bodies, with distinct native encodings", () => {
  for (const [name, count] of [["8080", 12], ["z80", 32]] as const) {
    assert.equal(arithmeticForms[name].length, count);
    assert.equal(new Set(arithmeticForms[name].map(form => form.bytes.join(","))).size, count);
    assert.equal(new Set(arithmeticForms[name].map(form => form.execute)).size, count);
  }
});

const boundaries = [0, 1, 0x0f, 0xff, 0xfff, 0x1000, 0x7fff, 0x8000, 0xfffe, 0xffff];
for (const name of ["8080", "z80"] as const) {
  test(`${name} word arithmetic preserves ordered captures, writes before flags, and applies its native word flag rules`, () => {
    for (const form of arithmeticForms[name]) for (const left of boundaries) for (const right of boundaries) for (let bits = 0; bits < 64; bits++) {
      const state = { ...wordState(), ...wordChanges(form.destination, left), ...(form.source ? wordChanges(form.source, right) : {}),
        flags: { ...flagPattern(bits), cy: Boolean(bits & 4), ac: Boolean(bits & 8), p: Boolean(bits & 16) } };
      const before = structuredClone(state), expected = { ...before, ...arithmeticChanges(name, form, before) }, events: string[] = [];
      const flags = new Proxy(state.flags, {
        get(target, key, receiver) { events.push(`read flag ${String(key)}`); return Reflect.get(target, key, receiver); },
        set(target, key, value) { events.push(`write flag ${String(key)}`); return Reflect.set(target, key, value); },
      });
      const observed = new Proxy(state, {
        get(target, key, receiver) {
          if (key === "flags") return flags;
          events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver);
        },
        set(target, key, value) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value); },
      });
      form.execute(observed);
      const withCarry = form.operation === "adc" || form.operation === "sbc";
      const updated = !form.source ? [] : name === "8080" ? ["cy"] : withCarry ? ["s", "z", "h", "pv", "n", "c"] : ["h", "c", "n"];
      assert.deepEqual(events, [
        ...(form.source ?? []).map(field => `read ${field}`), ...form.destination.map(field => `read ${field}`),
        ...(withCarry ? ["read flag c"] : []), ...form.destination.map(field => `write ${field}`), ...updated.map(flag => `write flag ${flag}`),
      ]);
      assert.deepEqual(state, expected, `${name} ${form.bytes.join(",")}, left=${left}, right=${right}, flags=${bits}`);
    }
  });
}
