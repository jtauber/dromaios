import assert from "node:assert/strict";
import { test } from "node:test";
import { XtKeyboard } from "../../site/interactive/xt-keyboard.js";
import { createXtSession } from "../../site/interactive/xt-session.js";
import { decodeXtCheckpoint, encodeXtCheckpoint } from "../../site/interactive/xt-checkpoint.js";

function drain(keyboard: XtKeyboard, caps = false) {
  const bytes: number[] = [];
  while (keyboard.queuedBytes || keyboard.pasteRemaining) {
    keyboard.beforeStep(byte => { bytes.push(byte); return true; }, () => caps);
    keyboard.afterStep(500_000, false);
  }
  return bytes;
}

test("XT focus loss releases held keys once and receiver backpressure preserves their order", () => {
  const keys = new XtKeyboard();
  keys.down("ShiftLeft"); keys.down("KeyR"); keys.down("KeyR");
  keys.beforeStep(() => true, () => false);
  keys.beforeStep(byte => { assert.equal(byte, 0x13); return false; }, () => false);
  keys.releaseHeld(); keys.up("KeyR");
  assert.deepEqual(drain(keys), [0x13, 0xaa, 0x93]);
  keys.down("ControlRight"); keys.down("ControlLeft"); keys.up("ControlRight");
  keys.down("NumpadEnter"); keys.releaseHeld();
  assert.deepEqual(drain(keys), [0x1d, 0x1c, 0x9d, 0x9c]);
});

test("XT paste retains emulated delays, Shift and pending bytes across a checkpoint", () => {
  const keys = new XtKeyboard();
  keys.paste("A+\r\nb");
  keys.beforeStep(byte => { assert.equal(byte, 0x2a); return true; }, () => false);
  const state = keys.snapshot(), restored = new XtKeyboard(state);
  assert.deepEqual(state.bytes, [0x1e, 0x9e, 0xaa]); assert.equal(state.paste, "+\nb");
  for (const current of [keys, restored]) {
    for (const expected of state.bytes) current.beforeStep(byte => { assert.equal(byte, expected); return true; }, () => false);
    current.afterStep(state.delay - 1, false);
    current.beforeStep(() => assert.fail("The next character arrived early"), () => false);
    current.afterStep(1, false);
    assert.deepEqual(drain(current), [0x2a, 0x0d, 0x8d, 0xaa, 0x1c, 0x9c, 0x30, 0xb0]);
  }
  keys.paste("aA"); assert.deepEqual(drain(keys, true), [0x2a, 0x1e, 0x9e, 0xaa, 0x1e, 0x9e]);
});

test("a qualifying XT keyboard reset discards outstanding chord releases and paste", () => {
  const keys = new XtKeyboard(); keys.chord(["ControlLeft", "AltLeft", "Delete"]); keys.paste("RUN\n");
  for (const make of [0x1d, 0x38, 0x53]) keys.beforeStep(byte => { assert.equal(byte, make); return true; }, () => false);
  assert.deepEqual(keys.snapshot().bytes, [0xd3, 0xb8, 0x9d]);
  keys.afterStep(1, true);
  assert.deepEqual(keys.snapshot(), new XtKeyboard().snapshot());
});

test("XT session restore validates the keyboard, memory and ROM identities before replacing live hardware", () => {
  const session = createXtSession();
  assert.throws(() => session.step(), /Load the BIOS/);
  session.machine.ram.write(0x98765, 0xdf); session.machine.video.write(0x3fff, 0xe2);
  session.keyboard.paste("PRINT 2+3\n");
  const live = session.machine, saved = session.snapshot(), text = encodeXtCheckpoint(saved);
  assert.ok(text.length < 1_000_000);
  const decoded = decodeXtCheckpoint(text);
  assert.throws(() => session.restore({ ...decoded, keyboard: { ...decoded.keyboard, bytes: [512] } }), /keyboard/);
  assert.throws(() => session.restore({ ...decoded, hardware: { ...decoded.hardware, basic: "unavailable" } }), /identity/);
  assert.throws(() => decodeXtCheckpoint(JSON.stringify({ ...JSON.parse(text), hardware: { ram: "" } })), /memory size/);
  assert.equal(session.machine, live); assert.deepEqual(session.snapshot(), saved);
  session.powerOn(); session.restore(decoded); assert.deepEqual(session.snapshot(), saved);
});

test("a rejected paste or excessive input leaves the XT keyboard usable", () => {
  const keys = new XtKeyboard(); keys.down("ShiftLeft"); const before = keys.snapshot();
  for (const text of ["é", "x".repeat(4097)]) {
    assert.throws(() => keys.paste(text), /Paste up to/); assert.deepEqual(keys.snapshot(), before);
  }
  keys.releaseHeld();
  while (keys.queuedBytes < 510) { keys.down("KeyX"); keys.up("KeyX"); }
  keys.down("KeyA"); assert.throws(() => keys.down("KeyB"), /queue full/);
  keys.releaseHeld(); assert.deepEqual(drain(keys).slice(-2), [0x1e, 0x9e]);
});
