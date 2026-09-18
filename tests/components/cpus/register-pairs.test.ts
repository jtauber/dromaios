import assert from "node:assert/strict";
import { test } from "node:test";
import { pairViews, readRegisterPair } from "../../../src/components/cpus/register-pairs.js";

test("register pairs read every word without changing bytes and derive detached views", () => {
  const bytes = new DataView(new ArrayBuffer(2));
  for (const [pair, high, low] of [["bc", "b", "c"], ["de", "d", "e"], ["hl", "h", "l"]] as const) {
    for (let value = 0; value < 65536; value++) {
      const before = { a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77 };
      bytes.setUint16(0, value, false);
      const bank = { ...before, [high]: bytes.getUint8(0), [low]: bytes.getUint8(1) }, saved = { ...bank };
      assert.equal(readRegisterPair(bank, pair), value);
      const views = pairViews(bank);
      assert.equal(views[pair], value);
      assert.deepEqual(bank, saved);
      bank[high] = bank[low] = 0;
      assert.equal(views[pair], value);
    }
  }
});
