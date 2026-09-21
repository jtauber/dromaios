import assert from "node:assert/strict";
import { test } from "node:test";
import { instructionsZ80, chapterZ80 } from "../../../../src/components/cpus/semantics/definitions.js";
import { wordChanges, wordForms, wordState } from "../../../helpers/intel-words.js";

test("Intel word transfers use seven 8080 bodies and 23 Z80 opcode bodies for all 30 documented forms", () => {
  assert.equal(wordForms["8080"].length, 7); assert.equal(wordForms.z80.length, 23);
  assert.equal(new Set(wordForms["8080"].map(form => form.execute)).size, 7);
  assert.equal(new Set(wordForms.z80.map(form => form.execute)).size, 23);
  const names = Object.values({ ...instructionsZ80, ...chapterZ80 }).map(definition => definition.name);
  for (const name of ["LD HL,(nn)", "LD (nn),HL"]) assert.equal(names.filter(item => item === name).length, 2);
});

for (const cpu of ["8080", "z80"] as const) {
  test(`${cpu} generated word transfers retain read/write order, captured addresses and bytes, and partial-failure effects`, () => {
    for (const { fields, operation, execute } of wordForms[cpu]) for (const address of [0, 0xffff]) {
      for (const word of [0, 0x00ff, 0xff00, 0xffff, 0x1234]) for (const set of [false, true]) {
        const accesses = operation === "copy" ? 0 : operation === "immediate" ? 2 : 4;
        for (let failAt = -1; failAt < accesses; failAt++) {
          const state = { ...wordState(set), ...wordChanges(fields, word) }, before = structuredClone(state);
          const events: string[] = [], written: { address: number; value: number }[] = [];
          const failure = new Error("word access failure");
          let attempts = 0, fetched = 0, reads = 0, expected = structuredClone(before);
          const changeSource = (value: number) => {
            Object.assign(state, wordChanges(fields, value)); Object.assign(expected, wordChanges(fields, value));
          };
          const attempt = (event: string) => { events.push(event); if (attempts++ === failAt) throw failure; };
          const observed = new Proxy(state, {
            get(target, key, receiver) {
              assert.ok((operation === "store" || operation === "copy") && fields.some(field => field === key), "No destination, flag, bank, or control-state reads");
              events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver);
            },
            set(target, key, value) {
              assert.ok(operation === "copy" ? key === "sp" : operation !== "store" && fields.some(field => field === key));
              events.push(`write ${String(key)}`); return Reflect.set(target, key, value);
            },
          });
          const run = () => execute(observed, {
            fetchByte() {
              attempt("fetch"); const value = operation === "immediate" ? word : address;
              const byte = fetched++ === 0 ? value % 256 : Math.floor(value / 256);
              // The store must capture its register after both address bytes have been fetched.
              if (operation === "store" && fetched === 2) changeSource(word ^ 0xffff);
              return byte;
            },
            readByte(actual) {
              assert.equal(operation, "load"); assert.equal(actual, (address + reads) % 65536);
              attempt("read memory"); changeSource(0x5678);
              return reads++ === 0 ? word % 256 : Math.floor(word / 256);
            },
            writeByte(actual, value) {
              assert.equal(operation, "store"); assert.equal(actual, (address + written.length) % 65536);
              attempt("write memory"); written.push({ address: actual, value });
              // Neither the high source byte nor the destination address may be recomputed now.
              changeSource(0x5678);
            },
          });
          if (failAt < 0) run(); else assert.throws(run, error => error === failure);
          const registerWrites = (operation === "copy" ? ["sp"] : fields).map(field => `write ${field}`);
          const registerReads = fields.map(field => `read ${field}`);
          const fullEvents = operation === "copy" ? [...registerReads, ...registerWrites]
            : operation === "store" ? ["fetch", "fetch", ...registerReads, "write memory", "write memory"]
            : ["fetch", "fetch", ...(operation === "load" ? ["read memory", "read memory"] : []), ...registerWrites];
          let eventEnd = fullEvents.length, access = 0;
          if (failAt >= 0) eventEnd = fullEvents.findIndex(event => ["fetch", "read memory", "write memory"].includes(event) && access++ === failAt) + 1;
          assert.deepEqual(events, fullEvents.slice(0, eventEnd));
          if (failAt < 0 && operation !== "store") Object.assign(expected, wordChanges(operation === "copy" ? ["sp"] : fields, word));
          assert.deepEqual(state, expected);
          const stored = word ^ 0xffff, count = operation !== "store" ? 0 : failAt < 0 ? 2 : Math.max(0, failAt - 2);
          assert.deepEqual(written, [{ address, value: stored % 256 }, { address: (address + 1) % 65536, value: Math.floor(stored / 256) }].slice(0, count));
          assert.equal(attempts, failAt < 0 ? accesses : failAt + 1);
        }
      }
    }
  });
}
