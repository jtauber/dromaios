import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions as intel } from "../../../../src/components/cpus/generated/8080.js";
import { bodiesZ80 as zilog } from "../../../helpers/z80-bodies.js";
import { accumulatorState, accumulatorTransfers } from "../../../helpers/intel-accumulator-transfers.js";

for (const [name, instructions] of [["8080", intel], ["Z80", zilog]] as const) {
  test(`${name} accumulator transfers capture the address before A and stop at each failed access without accessing flags`, () => {
    for (const { opcode, pair, operation } of accumulatorTransfers) for (const address of [0, 0xffff, 0x1234]) {
      for (const byte of [0, 0x7f, 0x80, 0xff]) for (let bits = 0; bits < 64; bits++) {
        const fetches = pair === null ? 2 : 0, accesses = fetches + 1;
        for (let failAt = -1; failAt < accesses; failAt++) {
          const state = { ...accumulatorState(bits), a: byte,
            ...(pair === null ? {} : { [pair[0]]: Math.floor(address / 256), [pair[1]]: address % 256 }) };
          const expected = structuredClone(state), events: string[] = [], written: { address: number; value: number }[] = [];
          const failure = new Error("accumulator transfer failure");
          let attempts = 0, fetched = 0;
          const attempt = (event: string) => { events.push(event); if (attempts++ === failAt) throw failure; };
          const change = (a: number) => {
            state.a = expected.a = a;
            state.flags = accumulatorState(bits ^ 63).flags; expected.flags = { ...state.flags };
          };
          const observed = new Proxy(state, {
            get(target, key, receiver) {
              assert.ok(pair?.some(field => field === key) || operation === "store" && key === "a", "Only the selected pair and store source may be read");
              events.push(`read ${String(key)}`); const contents = Reflect.get(target, key, receiver);
              // The store must read A only after capturing both pair bytes.
              if (pair && key === pair[1]) change(byte ^ 0xff);
              if (pair && key === "a") {
                state[pair[0]] = expected[pair[0]] = 0x56;
                state[pair[1]] = expected[pair[1]] = 0x78;
              }
              return contents;
            },
            set(target, key, contents) {
              assert.equal(operation, "load"); assert.equal(key, "a"); events.push("write a");
              return Reflect.set(target, key, contents);
            },
          });
          const run = () => instructions[opcode](observed, {
            fetchByte() {
              assert.equal(pair, null); attempt("fetch");
              change(fetched === 0 ? byte : byte ^ 0xff);
              return fetched++ === 0 ? address % 256 : Math.floor(address / 256);
            },
            readByte(actual) {
              assert.equal(operation, "load"); assert.equal(actual, address); attempt("read memory");
              change(0x42); return byte;
            },
            writeByte(actual, contents) {
              assert.equal(operation, "store"); assert.equal(actual, address); assert.equal(contents, byte ^ 0xff);
              attempt("write memory"); written.push({ address: actual, value: contents }); change(0x42);
            },
          });
          if (failAt < 0) run(); else assert.throws(run, error => error === failure);
          const fullEvents = [...(pair === null ? ["fetch", "fetch"] : pair.map(field => `read ${field}`)),
            ...(operation === "store" ? ["read a", "write memory"] : ["read memory", "write a"])];
          let access = 0;
          const end = failAt < 0 ? fullEvents.length : fullEvents.findIndex(event => ["fetch", "read memory", "write memory"].includes(event) && access++ === failAt) + 1;
          assert.deepEqual(events, fullEvents.slice(0, end));
          if (failAt < 0 && operation === "load") expected.a = byte;
          assert.deepEqual(state, expected);
          assert.deepEqual(written, failAt < 0 && operation === "store" ? [{ address, value: byte ^ 0xff }] : []);
          assert.equal(attempts, failAt < 0 ? accesses : failAt + 1);
        }
      }
    }
  });
}
