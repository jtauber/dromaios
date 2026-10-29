import assert from "node:assert/strict";
import { test } from "node:test";
import { cocoScreenKey, cocoTextInput } from "../../site/interactive/coco-input.js";
import { createCocoKeyboardTransport } from "../../site/interactive/coco-keyboard-transport.js";
import { CocoPias } from "../../src/machines/6809/coco/pias.js";

const key = (key: string, extra = {}) => cocoScreenKey({ key, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...extra });
function advance(transport: ReturnType<typeof createCocoKeyboardTransport>, count: number): void {
  for (let i = 0; i < count; i++) { transport.beforeStep(); transport.afterStep(); }
}

test("CoCo input translates text and host editing keys into physical matrix chords", () => {
  assert.deepEqual(cocoTextInput("a=@2+3\r\n"), [["A"], ["Shift", "-"], ["@"], ["2"], ["Shift", ";"], ["3"], ["Enter"]]);
  assert.deepEqual(cocoTextInput("!\"#$%&'()*+<=>?"), [..."123456789:;,-./"].map(k => ["Shift", k]));
  assert.deepEqual(cocoTextInput(" :;,./-"), [["Space"], [":"], [";"], [","], ["."], ["/"], ["-"]]);
  for (const text of ["one\ntwo", "é", "ß", "[", "\t", "\x00"]) assert.throws(() => cocoTextInput(text));
  for (const [host, physical] of [["Enter", "Enter"], ["Escape", "Break"], ["Backspace", "ArrowLeft"], ["Home", "Clear"], ["ArrowUp", "ArrowUp"]]) {
    assert.deepEqual(key(host!), [physical]);
  }
  assert.deepEqual(key("c", { ctrlKey: true }), ["Break"]);
  for (const extra of [{ metaKey: true }, { altKey: true }, { isComposing: true }]) assert.equal(key("c", extra), undefined);
  assert.equal(key("v", { ctrlKey: true }), undefined); assert.equal(key("Shift"), undefined);
});

test("keyboard delivery holds complete chords and inserts a release phase between repeated keys", () => {
  const pias = new CocoPias(), transport = createCocoKeyboardTransport(pias), idle = pias.snapshot().keyboard;
  const input: ("Shift" | ";")[][] = [["Shift", ";"], ["Shift", ";"]];
  transport.send(input); input[0]!.length = 0;
  advance(transport, 1);
  const pressed = pias.snapshot().keyboard;
  assert.notDeepEqual(pressed, idle); assert.equal(transport.pending, 2);
  advance(transport, 11_999); assert.deepEqual(pias.snapshot().keyboard, pressed);
  advance(transport, 1); assert.deepEqual(pias.snapshot().keyboard, idle); assert.equal(transport.pending, 1);
  advance(transport, 11_999); assert.deepEqual(pias.snapshot().keyboard, idle);
  advance(transport, 1); assert.deepEqual(pias.snapshot().keyboard, pressed);
  advance(transport, 23_999); assert.deepEqual(pias.snapshot().keyboard, idle); assert.equal(transport.settled, true);
});

test("saved press and release phases continue identically without depending on wall time", () => {
  for (const count of [17, 12_017]) {
    const original = new CocoPias(), transport = createCocoKeyboardTransport(original);
    transport.send([["Shift", "-"], ["A"]]); advance(transport, count);
    const state = transport.snapshot(), restored = new CocoPias(original.snapshot());
    const resumed = createCocoKeyboardTransport(restored, state);
    assert.deepEqual(transport.snapshot(), state, "reading does not advance input");
    for (let i = 0; i < 25_000; i++) { advance(transport, 1); advance(resumed, 1); }
    assert.deepEqual(restored.snapshot(), original.snapshot()); assert.deepEqual(resumed.snapshot(), transport.snapshot());
    resumed.release(); assert.equal(resumed.settled, true); assert.deepEqual(restored.snapshot().keyboard, new CocoPias().snapshot().keyboard);
  }
});

test("invalid queues and saved switch states fail before changing input or hardware", () => {
  const pias = new CocoPias(), transport = createCocoKeyboardTransport(pias);
  transport.send([["A"]]); const before = transport.snapshot(), hardware = pias.snapshot();
  for (const invalid of [[["B"], ["bad"]], [["A", "A"]], [[]], [new Array(1)], new Array(2), Array.from({ length: 1024 }, () => ["A"])]) {
    assert.throws(() => transport.send(invalid as never)); assert.deepEqual(transport.snapshot(), before); assert.deepEqual(pias.snapshot(), hardware);
  }
  for (const invalid of [
    { input: [], pressed: true, remaining: 1 }, { input: [], pressed: false, remaining: -1 },
    { input: [], pressed: false, remaining: 12_001 }, { input: [["A"]], pressed: true, remaining: 1 },
    { input: [["bad"]], pressed: false, remaining: 0 }, { input: new Array(1), pressed: false, remaining: 0 },
  ]) assert.throws(() => createCocoKeyboardTransport(pias, invalid as never));
  assert.deepEqual(pias.snapshot(), hardware);
});
