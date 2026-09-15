import assert from "node:assert/strict";
import { test } from "node:test";
import { modifyByte } from "../../../src/components/cpus/memory-operations.js";

for (const [name, writeback, originalWrite] of [
  ["ordinary", "result", false], ["NMOS", "original-and-result", true],
] as const) {
  test(`${name} byte modification fixes access order, reads once, and retains unchanged writes`, () => {
    const address = 0x12345678;
    for (const original of [0, 0x80, 0xff]) for (const result of [0, original]) {
      let stored = original;
      const effects: unknown[] = [];
      const memory = {
        readByte: (at: number) => { effects.push(["read", at, stored]); return stored; },
        writeByte: (at: number, value: number) => { effects.push(["write", at, value]); stored = value; },
      };
      const transform = (value: number) => { effects.push(["transform", value]); return result; };
      assert.equal(modifyByte(address, transform, memory, writeback), result);
      assert.deepEqual(effects, [["read", address, original], ...(originalWrite ? [["write", address, original]] : []),
        ["transform", original], ["write", address, result]]);
      assert.equal(stored, result);
    }
  });

  test(`${name} byte modification propagates every failing effect without rollback or later calls`, () => {
    // Entries describe attempts; failure occurs before the attempted effect changes memory or carry.
    const order = ["read", ...(originalWrite ? ["write"] : []), "transform", "write"];
    const fault = new Error("injected failure");
    for (let failAt = 0; failAt < order.length; failAt++) {
      const attempts: string[] = [];
      let stored = 0x80, carry = false;
      const attempt = (kind: string) => {
        attempts.push(kind);
        if (attempts.length - 1 === failAt) throw fault;
      };
      const memory = {
        readByte: () => { attempt("read"); return stored; },
        writeByte: (_address: number, value: number) => { attempt("write"); stored = value; },
      };
      assert.throws(() => modifyByte(0x1000, () => { attempt("transform"); carry = true; return 0; }, memory, writeback), error => error === fault);
      assert.deepEqual(attempts, order.slice(0, failAt + 1));
      assert.equal(stored, 0x80);
      assert.equal(carry, failAt > order.indexOf("transform"));
    }
  });
}
