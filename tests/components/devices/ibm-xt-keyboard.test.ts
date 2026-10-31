import assert from "node:assert/strict";
import { test } from "node:test";
import { IbmXtKeyboard } from "../../../src/components/devices/generated/ibm-xt-keyboard.js";

test("each scan-code byte remains readable until receiver clear, without being overwritten", () => {
  const keyboard = new IbmXtKeyboard();
  assert.equal(keyboard.offer(0x1e), false); assert.equal(keyboard.data(), 0xff);
  keyboard.setControl(true, false);
  for (let byte = 0; byte < 256; byte++) {
    assert.equal(keyboard.offer(byte), true); assert.equal(keyboard.irq(), true);
    const before = keyboard.snapshot();
    assert.equal(keyboard.read(0), byte); assert.equal(keyboard.data(), byte);
    assert.equal(keyboard.offer(byte ^ 0xff), false);
    assert.deepEqual(keyboard.snapshot(), before);
    keyboard.setControl(false, false); // Holding clock low does not clear a received byte.
    assert.equal(keyboard.data(), byte); assert.equal(keyboard.irq(), true);
    keyboard.setControl(true, true);
    assert.equal(keyboard.irq(), false); assert.equal(keyboard.data(), 0xff);
    keyboard.setControl(true, false); assert.equal(keyboard.data(), 0);
  }
});

test("clock-low intervals qualify reset without treating every clock transition as a reset", () => {
  const keyboard = new IbmXtKeyboard();
  keyboard.setControl(false, false); assert.equal(keyboard.offer(0x1e), false);
  keyboard.advanceMicroseconds(19999); keyboard.setControl(true, false);
  assert.equal(keyboard.irq(), false);
  keyboard.setControl(false, false); keyboard.advanceMicroseconds(10000);
  const saved = keyboard.snapshot(), restored = new IbmXtKeyboard(saved);
  restored.advanceMicroseconds(9999); restored.advanceMicroseconds(1);
  restored.setControl(true, true); // The response waits while PB7 holds receiver clear.
  assert.equal(restored.irq(), false); assert.equal(restored.snapshot().self_test_pending, true);
  const pending = new IbmXtKeyboard(restored.snapshot());
  pending.setControl(true, false);
  assert.equal(pending.irq(), false); assert.equal(pending.offer(0x1e), false);
  pending.advanceMicroseconds(7999); assert.equal(pending.irq(), false);
  const delayed = new IbmXtKeyboard(pending.snapshot());
  pending.advanceMicroseconds(1); delayed.advanceMicroseconds(1);
  assert.deepEqual(delayed.snapshot(), pending.snapshot());
  assert.equal(pending.data(), 0xaa); assert.equal(pending.irq(), true);
  assert.equal(pending.snapshot().self_test_pending, false);
  assert.equal(pending.offer(0x1e), false);
  pending.setControl(true, true); pending.setControl(true, false);
  assert.equal(pending.offer(0x1e), true);
  assert.deepEqual(keyboard.snapshot(), saved);
});

test("reset intervals saturate and restoration rejects contradictory keyboard state", () => {
  const keyboard = new IbmXtKeyboard(); keyboard.setControl(false, false);
  keyboard.advanceMicroseconds(0xffffffff); assert.equal(keyboard.snapshot().low_us, 20000);
  keyboard.setControl(true, false); keyboard.advanceMicroseconds(0xffffffff);
  assert.equal(keyboard.data(), 0xaa);
  const before = keyboard.snapshot();
  for (const value of [-1, NaN, 0.5, 0x100000000]) assert.throws(() => keyboard.advanceMicroseconds(value), RangeError);
  assert.throws(() => keyboard.setControl(false, 0 as never), TypeError);
  assert.throws(() => keyboard.offer(256), RangeError);
  assert.deepEqual(keyboard.snapshot(), before);
  for (const invalid of [{ clear: true }, { full: false }, { low_us: 1 }, { low_us: 20001 },
    { self_test_us: 8001 }, { self_test_us: 1 }]) {
    assert.throws(() => new IbmXtKeyboard({ ...before, ...invalid }), /Invalid/);
  }
  keyboard.reset(); assert.equal(keyboard.irq(), false); assert.equal(keyboard.data(), 0);
  assert.equal(keyboard.snapshot().clock_high, true);
});

test("self-test time advances independently of receiver inhibition, while inspection never advances it", () => {
  const keyboard = new IbmXtKeyboard();
  keyboard.setControl(false, true); keyboard.advanceMicroseconds(20000); keyboard.setControl(true, true);
  keyboard.advanceMicroseconds(3000); const saved = keyboard.snapshot();
  for (let i = 0; i < 100; i++) { keyboard.read(0); keyboard.data(); keyboard.irq(); keyboard.snapshot(); }
  keyboard.advanceMicroseconds(0); assert.deepEqual(keyboard.snapshot(), saved);
  keyboard.advanceMicroseconds(5000); assert.equal(keyboard.irq(), false);
  assert.equal(keyboard.snapshot().self_test_us, 0); assert.equal(keyboard.snapshot().self_test_pending, true);
  const restored = new IbmXtKeyboard(keyboard.snapshot());
  restored.setControl(true, false); assert.equal(restored.data(), 0xaa); assert.equal(restored.irq(), true);
  keyboard.setControl(false, false); keyboard.advanceMicroseconds(1);
  assert.equal(keyboard.irq(), false); // Clock inhibition also holds an expired response.
  keyboard.setControl(true, false); assert.equal(keyboard.data(), 0xaa);
});

test("a new qualifying keyboard reset restarts the delay, and board reset cancels the response", () => {
  const keyboard = new IbmXtKeyboard();
  keyboard.setControl(false, true); keyboard.advanceMicroseconds(20000); keyboard.setControl(true, true);
  keyboard.advanceMicroseconds(4000); keyboard.setControl(false, true); keyboard.advanceMicroseconds(20000);
  keyboard.setControl(true, false); assert.equal(keyboard.snapshot().self_test_us, 8000);
  keyboard.advanceMicroseconds(7999); assert.equal(keyboard.irq(), false);
  keyboard.reset(); keyboard.advanceMicroseconds(1000000);
  assert.equal(keyboard.irq(), false); assert.equal(keyboard.snapshot().self_test_us, 0);
  assert.equal(keyboard.snapshot().self_test_pending, false);
  assert.equal(keyboard.offer(0x1e), true);
});
