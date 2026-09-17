import assert from "node:assert/strict";
import { test } from "node:test";
import { exchangeForms, wordChanges, wordState } from "../../../helpers/intel-words.js";

for (const cpu of ["8080", "z80"] as const) {
  test(`${cpu} generated stack exchanges capture the register and SP once and retain each failed access boundary`, () => {
    for (const { fields, execute } of exchangeForms[cpu].filter(form => form.stack)) for (const sp of [0, 0xffff]) {
      for (const original of [0, 0x00ff, 0xff00, 0xffff, 0x1234]) for (const loaded of [original, original ^ 0xffff]) {
        for (const set of [false, true]) for (let failAt = -1; failAt < 4; failAt++) {
          const state = { ...wordState(set), ...wordChanges(fields, original), sp }, expected = structuredClone(state);
          const next = (sp + 1) % 65536, memory = new Map([[sp, loaded % 256], [next, Math.floor(loaded / 256)]]);
          const events: string[] = [], failure = new Error("exchange access failure");
          const accesses = [
            { kind: "read", address: sp, value: loaded % 256 }, { kind: "read", address: next, value: Math.floor(loaded / 256) },
            { kind: "write", address: next, value: Math.floor(original / 256) }, { kind: "write", address: sp, value: original % 256 },
          ];
          let attempts = 0;
          const observed = new Proxy(state, {
            get(target, key, receiver) {
              assert.ok(key === "sp" || fields.some(field => field === key), "No flag, bank, or unrelated register reads");
              events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver);
            },
            set(target, key, value) {
              assert.ok(fields.some(field => field === key), "Only the exchanged register may be written");
              events.push(`write ${String(key)}`); return Reflect.set(target, key, value);
            },
          });
          const access = (kind: string, address: number, value: number) => {
            assert.deepEqual({ kind, address, value }, accesses[attempts]);
            events.push(`${kind} memory`);
            if (attempts++ === failAt) throw failure;
            if (kind === "write") memory.set(address, value);
            // Bus callbacks can change live state: later writes must use captured bytes and addresses,
            // while untouched flags must retain their current storage rather than a saved copy.
            const changes = { ...wordChanges(fields, 0x9abc), sp: 0x4321, flags: wordState(!set).flags };
            Object.assign(state, changes); Object.assign(expected, structuredClone(changes));
            return value;
          };
          const run = () => execute(observed, {
            fetchByte() { assert.fail("An exchange has no immediate operand"); },
            readByte(address) { return access("read", address, memory.get(address)!); },
            writeByte(address, value) { access("write", address, value); },
          });
          if (failAt < 0) run(); else assert.throws(run, error => error === failure);
          const count = failAt < 0 ? 4 : failAt + 1;
          assert.deepEqual(events, [...fields.map(field => `read ${field}`), "read sp",
            ...accesses.slice(0, count).map(({ kind }) => `${kind} memory`),
            ...(failAt < 0 ? fields.map(field => `write ${field}`) : [])]);
          if (failAt < 0) Object.assign(expected, wordChanges(fields, loaded));
          assert.deepEqual(state, expected);
          assert.equal(memory.get(sp), failAt < 0 ? original % 256 : loaded % 256);
          assert.equal(memory.get(next), failAt < 0 || failAt === 3 ? Math.floor(original / 256) : Math.floor(loaded / 256));
          assert.equal(attempts, count);
        }
      }
    }
  });

  test(`${cpu} generated DE/HL exchange swaps high bytes before low bytes without accessing flags or memory`, () => {
    const execute = exchangeForms[cpu].find(form => !form.stack)!.execute;
    for (const de of [0, 0x00ff, 0xff00, 0xffff, 0x1234]) for (const hl of [de, de ^ 0xffff, 0x5678]) {
      const state = { ...wordState(), ...wordChanges(["d", "e"], de), ...wordChanges(["h", "l"], hl) };
      const before = structuredClone(state), events: string[] = [];
      const observed = new Proxy(state, {
        get(target, key, receiver) {
          assert.ok(["d", "e", "h", "l"].includes(String(key))); events.push(`read ${String(key)}`);
          return Reflect.get(target, key, receiver);
        },
        set(target, key, value) {
          assert.ok(["d", "e", "h", "l"].includes(String(key))); events.push(`write ${String(key)}`);
          return Reflect.set(target, key, value);
        },
      });
      execute(observed, {
        fetchByte() { assert.fail("No operand fetch"); }, readByte() { assert.fail("No memory read"); }, writeByte() { assert.fail("No memory write"); },
      });
      assert.deepEqual(events, ["read h", "read d", "write d", "write h", "read l", "read e", "write e", "write l"]);
      assert.deepEqual(state, { ...before, d: before.h, e: before.l, h: before.d, l: before.e });
    }
  });
}
