import assert from "node:assert/strict";
import { test } from "node:test";
import { pairViews, readRegisterPair, writeRegisterPair } from "../../../src/components/cpus/register-pairs.js";

test("register pairs cover every word, replace exactly two bytes, and derive detached views", () => {
  const bytes = new DataView(new ArrayBuffer(2));
  for (const [pair, high, low] of [["bc", "b", "c"], ["de", "d", "e"], ["hl", "h", "l"]] as const) {
    for (let value = 0; value < 65536; value++) {
      const before = { a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77 };
      const bank = { ...before };
      bytes.setUint16(0, value, false);
      writeRegisterPair(bank, pair, value);
      assert.deepEqual(bank, { ...before, [high]: bytes.getUint8(0), [low]: bytes.getUint8(1) });
      assert.equal(readRegisterPair(bank, pair), value);
      const views = pairViews(bank);
      assert.equal(views[pair], value);
      bank[high] = bank[low] = 0;
      assert.equal(views[pair], value);
    }
  }
});
