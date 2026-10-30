import assert from "node:assert/strict";
import { test } from "node:test";
import { XtIo } from "../../../../src/machines/8088/pc-xt/io.js";

function configured() {
  const io = new XtIo();
  io.write(0x20, 0x13); io.write(0x21, 8); io.write(0x21, 9); io.write(0x21, 0xfd);
  io.write(0x63, 0x99); io.write(0x61, 0x4c);
  return io;
}

test("XT switches, diagnostic outputs, and timer/speaker pins follow PPI direction and latch writes", () => {
  const io = new XtIo();
  assert.equal(io.read(0x63), "bus-error"); assert.equal(io.read(0x64), "bus-error");
  io.write(0x63, 0x89); // POST: A/B outputs, C inputs.
  io.write(0x60, 0x55); assert.equal(io.read(0x60), 0x55);
  io.write(0x61, 0xa5); assert.equal(io.read(0x62), 0x0d);
  io.write(0x61, 0xad); assert.equal(io.read(0x62), 2);
  io.setEquipmentSwitches(0x96);
  assert.equal(io.read(0x62), 9);
  io.write(0x61, 0xa5); assert.equal(io.read(0x62), 6);
  io.write(0x43, 0xb6); assert.equal(io.read(0x62), 0x26);
  io.write(0x63, 0x99); // Mode change clears B, immediately holding the clock low.
  assert.equal(io.offerScanCode(0x1e), false);
  io.write(0x61, 0x43); assert.equal(io.timer2Gate, true); assert.equal(io.speakerData, true);
  assert.equal(io.offerScanCode(0x1e), true); assert.equal(io.read(0x60), 0x1e);
  io.write(0x63, 0x9b); // B becomes input: released-high PB7 clears the receiver.
  assert.equal(io.keyboardPending, false); assert.equal(io.read(0x60), 0xff);
});

test("keyboard read, receiver clear, and PIC EOI have separate effects", () => {
  const io = configured();
  assert.equal(io.offerScanCode(0x1e), true); assert.equal(io.irq, true);
  const saved = io.snapshot();
  io.snapshot(); io.read(0x20); io.read(0x21); io.read(0x60); io.read(0x61); io.read(0x62);
  void io.keyboardData; void io.keyboardPending; void io.irq; void io.timer2Gate; void io.speakerData;
  assert.deepEqual(io.snapshot(), saved);
  assert.equal(io.offerScanCode(0x9e), false);
  assert.equal(io.acknowledge(), 9); assert.equal(io.keyboardPending, true); assert.equal(io.irq, false);
  io.write(0x61, 0xcc); io.write(0x61, 0x4c);
  assert.equal(io.keyboardPending, false);
  assert.equal(io.offerScanCode(0x9e), true);
  assert.equal(io.snapshot().pic.irr, 2); assert.equal(io.irq, false);
  io.write(0x20, 0x20); assert.equal(io.irq, true);
  assert.equal(io.acknowledge(), 9); assert.equal(io.read(0x60), 0x9e);
});

test("a keyboard reset pulse uses supplied time and the self-test response follows IRQ1", () => {
  const io = configured();
  io.write(0x61, 0x08); io.advanceOscillatorTicks(286364); io.write(0x61, 0xc8);
  assert.equal(io.irq, false); assert.equal(io.offerScanCode(0x1e), false);
  const restored = new XtIo(io.snapshot());
  restored.write(0x61, 0x48);
  assert.equal(restored.read(0x60), 0xaa); assert.equal(restored.irq, true);
  assert.equal(restored.acknowledge(), 9);
  assert.equal(io.keyboardPending, false);
});

test("XT snapshots preserve wiring and reject disagreement without repairing it", () => {
  const io = configured(); io.write(0x43, 0xb6); io.offerScanCode(0x1e);
  const saved = io.snapshot(), restored = new XtIo(saved);
  assert.deepEqual(restored.snapshot(), saved);
  restored.write(0x61, 0xcc); assert.deepEqual(io.snapshot(), saved);
  assert.throws(() => new XtIo({ ...saved, pic: { ...saved.pic, levels: 0 } }), /wiring/);
  assert.throws(() => new XtIo({ ...saved, ppi: { ...saved.ppi, input_c: 2 } }), /wiring/);
  assert.throws(() => new XtIo({ ...saved, keyboard: { ...saved.keyboard, clock_high: false } }), /wiring/);
  assert.throws(() => new XtIo({ ...saved, keyboard: undefined } as never), /requires/);
  for (const invalid of [-1, 256, NaN, 1.5]) {
    assert.throws(() => io.write(0x61, invalid), RangeError);
    assert.throws(() => io.setEquipmentSwitches(invalid), RangeError);
    assert.throws(() => io.offerScanCode(invalid), RangeError);
  }
  assert.throws(() => io.setInterruptLine(1, true), /belong/);
  assert.throws(() => io.setInterruptLine(2, 1 as never), TypeError);
  assert.throws(() => io.write(0x63, 0xff), /Unsupported/);
  assert.deepEqual(io.snapshot(), saved);
  io.setInterruptLine(2, true); io.reset();
  assert.equal(io.keyboardPending, false); assert.equal(io.irq, false);
  assert.equal(io.snapshot().pic.levels, 4);
  assert.equal(io.snapshot().equipmentSwitches, 0x2d); assert.equal(io.snapshot().pit.channels[2].out, false);
});
