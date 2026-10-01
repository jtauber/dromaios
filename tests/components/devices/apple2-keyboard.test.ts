import assert from "node:assert/strict";
import { test } from "node:test";
import { Apple2Keyboard } from "../../../src/components/devices/generated/apple2-keyboard.js";

test("Apple II keyboard aliases sample all seven-bit characters without consuming them", () => {
  const keyboard = new Apple2Keyboard();
  assert.deepEqual(keyboard.snapshot(), { key: 0, strobe: false });
  for (let byte = 0; byte < 128; byte++) {
    assert.equal(keyboard.offer(byte), true);
    for (let address = 0; address < 16; address++) {
      assert.equal(keyboard.read(address), byte + 128);
      assert.equal(keyboard.write(address, 0xff), "bus-error");
    }
    assert.equal(keyboard.offer(byte ^ 0x7f), false);
    assert.deepEqual(keyboard.snapshot(), { key: byte, strobe: true });
    const address = 16 + byte % 16;
    if (byte < 64) assert.equal(keyboard.read(address), 0);
    else keyboard.write(address, 0xff);
    assert.deepEqual(keyboard.snapshot(), { key: byte, strobe: false });
    assert.equal(keyboard.read(byte % 16), byte);
  }
});

test("keyboard reset, snapshots, and invalid host input preserve the latch", () => {
  const keyboard = new Apple2Keyboard();
  for (let byte = 128; byte < 256; byte++) assert.equal(keyboard.offer(byte), false);
  assert.deepEqual(keyboard.snapshot(), { key: 0, strobe: false });
  keyboard.offer(0x41);
  const saved = keyboard.snapshot(), restored = new Apple2Keyboard(saved);
  keyboard.reset();
  assert.deepEqual(keyboard.snapshot(), saved);
  keyboard.write(0x10, 0);
  assert.deepEqual(restored.snapshot(), saved);
  assert.equal(restored.read(0), 0xc1);
  for (const value of [-1, 256, 1.5, NaN, Infinity]) {
    assert.throws(() => restored.offer(value), RangeError);
    assert.throws(() => restored.write(0x10, value), RangeError);
    assert.throws(() => restored.read(value), RangeError);
  }
  assert.deepEqual(restored.snapshot(), saved);
  assert.throws(() => restored.read(32), RangeError);
  assert.throws(() => new Apple2Keyboard({ key: 128, strobe: false }), /Invalid/);
  assert.throws(() => new Apple2Keyboard({ key: 1, strobe: 1 } as never));
});
