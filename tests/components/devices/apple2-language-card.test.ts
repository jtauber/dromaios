import assert from "node:assert/strict";
import { test } from "node:test";
import { Apple2LanguageCard } from "../../../src/components/devices/generated/apple2-language-card.js";

test("Language Card controls match the hardware table in both directions from every latch state", () => {
  // Sather Table 5.4, explicitly listed by local address, including A2 aliases.
  const controls = [
    [true, true, false], [true, false, true], [true, false, false], [true, true, true],
    [true, true, false], [true, false, true], [true, false, false], [true, true, true],
    [false, true, false], [false, false, true], [false, false, false], [false, true, true],
    [false, true, false], [false, false, true], [false, false, false], [false, true, true],
  ] as const; // bank2, ramRead, odd
  for (const ram_read of [false, true]) for (const ram_write of [false, true]) {
    for (const bank2 of [false, true]) for (const prewrite of [false, true]) {
      const before = { ram_read, ram_write, bank2, prewrite };
      for (const [address, [bank, read, odd]] of controls.entries()) for (const direction of ["read", "write"] as const) {
        const card = new Apple2LanguageCard(before);
        if (direction === "read") assert.equal(card.read(address), 0);
        else card.write(address, 0xa5);
        const armed = odd && direction === "read";
        assert.deepEqual(card.snapshot(), { bank2: bank, ram_read: read,
          ram_write: odd && (ram_write || (armed && prewrite)), prewrite: armed });
      }
    }
  }
});

test("Language Card sequences distinguish reads from writes and survive inspection and reset", () => {
  const card = new Apple2LanguageCard();
  assert.deepEqual(card.snapshot(), { ram_read: false, ram_write: true, bank2: true, prewrite: false });
  card.read(2); // Protect, then make only one enable read.
  card.read(1);
  const saved = card.snapshot(), restored = new Apple2LanguageCard(saved);
  assert.equal(card.ramRead(), false); assert.equal(card.ramWrite(), false); assert.equal(card.bank2(), true);
  card.reset(); assert.deepEqual(card.snapshot(), saved);
  restored.read(15); // Different bank/mode/alias still supplies the second read.
  assert.equal(restored.ramWrite(), true);
  assert.equal(restored.bank2(), false);
  assert.deepEqual(card.snapshot(), saved);
  card.write(1, 0); card.write(1, 255); card.read(3);
  assert.equal(card.ramWrite(), false, "Odd writes cancelled the pending read");
  card.read(3); assert.equal(card.ramWrite(), true);
  card.write(9, 0);
  assert.deepEqual(card.snapshot(), { ram_read: false, ram_write: true, bank2: false, prewrite: false });
  card.write(0, 0); assert.equal(card.ramWrite(), false);
});

test("Language Card invalid host arguments leave all latches intact", () => {
  const card = new Apple2LanguageCard(), saved = card.snapshot();
  for (const address of [-1, 16, 256, 1.5, NaN, Infinity]) {
    assert.throws(() => card.read(address), RangeError);
    assert.throws(() => card.write(address, 0), RangeError);
  }
  for (const byte of [-1, 256, 1.5, NaN, Infinity]) assert.throws(() => card.write(0, byte), RangeError);
  assert.deepEqual(card.snapshot(), saved);
  assert.throws(() => new Apple2LanguageCard({ ...saved, prewrite: 1 } as never));
});
