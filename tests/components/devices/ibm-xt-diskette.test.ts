import assert from "node:assert/strict";
import { test } from "node:test";
import { IbmXtDiskette } from "../../../src/components/devices/generated/ibm-xt-diskette.js";

function command(device: IbmXtDiskette, ...bytes: number[]): void {
  for (const byte of bytes) device.write(3, byte);
}
function sense(device: IbmXtDiskette, status: number, cylinder?: number): void {
  command(device, 8);
  assert.equal(device.irq(), false);
  assert.equal(device.read(2) & 0xf0, 0xd0);
  assert.equal(device.read(3), status);
  if (cylinder !== undefined) { assert.equal(device.read(2), 0xd0); assert.equal(device.read(3), cylinder); }
  assert.equal(device.read(2), 0x80);
}
function fixture(): IbmXtDiskette {
  const device = new IbmXtDiskette();
  device.write(0, 0x1c); device.advanceMicroseconds(2048); sense(device, 0xc0, 0);
  command(device, 3, 0xdf, 2); // IBM's 6 ms step interval, DMA mode.
  return device;
}

test("XT diskette reset is timed, gates IRQ6, and is acknowledged through Sense Interrupt Status", () => {
  const device = new IbmXtDiskette();
  assert.equal(device.status(), 0); assert.equal(device.irq(), false);
  assert.equal(device.read(0), "bus-error"); assert.equal(device.read(3), 0xff);
  device.write(0, 4); device.advanceMicroseconds(2047);
  assert.equal(device.status(), 0); assert.equal(device.irq(), false);
  device.advanceMicroseconds(1); assert.equal(device.status(), 0x80);
  assert.equal(device.snapshot().interrupt, true); assert.equal(device.irq(), false);
  device.write(0, 0x0c); assert.equal(device.irq(), true);
  const pending = device.snapshot();
  for (let i = 0; i < 20; i++) { assert.equal(device.read(2), 0x80); assert.equal(device.read(3), 0xff); }
  assert.deepEqual(device.snapshot(), pending);
  device.write(0, 4); assert.equal(device.irq(), false);
  device.write(0, 0x0c); assert.equal(device.irq(), true);
  sense(device, 0xc0, 0); sense(device, 0x80);
});

test("XT diskette commands expose direction and busy state and drain results one byte at a time", () => {
  const device = fixture();
  command(device, 3); assert.equal(device.status(), 0x90);
  command(device, 0xaf); assert.equal(device.status(), 0x90);
  const partial = device.snapshot(), restored = new IbmXtDiskette(partial);
  command(device, 4); command(restored, 4); assert.deepEqual(restored.snapshot(), device.snapshot());
  assert.equal(device.status(), 0x80); assert.equal(device.snapshot().srt_hut, 0xaf);
  command(device, 4, 0); assert.equal(device.status(), 0xd0);
  assert.equal(device.read(3), 0x30); assert.equal(device.status(), 0x80); // READY + track zero, no media.
  command(device, 0x10); assert.equal(device.read(3), 0x80); // 765A has no VERSION command.
  assert.equal(device.status(), 0x80); assert.equal(device.irq(), false);
  device.write(0, 0x0c); command(device, 4, 4); assert.equal(device.read(3), 0x24); // Head 1, motor off.
});

test("XT diskette seeks move an empty drive at the specified rate and keep busy until sensed", () => {
  const device = fixture();
  command(device, 15, 0, 3);
  assert.equal(device.status(), 0x81); assert.equal(device.irq(), false);
  device.advanceMicroseconds(5999); assert.equal(device.snapshot().cylinder, 0);
  device.advanceMicroseconds(1); assert.equal(device.snapshot().cylinder, 1);
  device.advanceMicroseconds(11999); assert.equal(device.snapshot().cylinder, 2);
  device.advanceMicroseconds(1); assert.equal(device.snapshot().cylinder, 3);
  assert.equal(device.snapshot().pcn, 3); assert.equal(device.status(), 0x81); assert.equal(device.irq(), true);
  sense(device, 0x20, 3);
  command(device, 7, 0); device.advanceMicroseconds(18000);
  assert.equal(device.snapshot().cylinder, 0); sense(device, 0x20, 0);
  command(device, 7, 0); device.advanceMicroseconds(5999); assert.equal(device.irq(), false);
  device.advanceMicroseconds(1); sense(device, 0x20, 0);
  command(device, 15, 4, 0); sense(device, 0x24, 0); // Zero-distance seek still completes.
});

test("XT DOR controls physical selection independently of PCN and the head cannot pass its end stops", () => {
  const device = fixture();
  device.write(0, 0x2d); // Select absent drive 1 with its motor enabled.
  command(device, 15, 0, 10); device.advanceMicroseconds(60000);
  assert.equal(device.snapshot().cylinder, 0); sense(device, 0x20, 10);
  command(device, 7, 0); device.advanceMicroseconds(77 * 6000 - 1);
  assert.equal(device.irq(), false); device.advanceMicroseconds(1);
  sense(device, 0x70, 10); // Track zero never asserted: seek end + equipment check + abnormal.
  device.write(0, 0x1c); command(device, 7, 0); device.advanceMicroseconds(6000); sense(device, 0x20, 0);
  command(device, 15, 0, 255); device.advanceMicroseconds(0xffffffff);
  assert.equal(device.snapshot().cylinder, 39); sense(device, 0x20, 255);
  command(device, 7, 0); device.advanceMicroseconds(39 * 6000);
  assert.equal(device.snapshot().cylinder, 0); sense(device, 0x20, 0);
});

test("XT diskette snapshots preserve partial steps, unread results, and detached parameter storage", () => {
  const device = fixture(); command(device, 15, 0, 34); device.advanceMicroseconds(6123);
  const snapshot = device.snapshot(), restored = new IbmXtDiskette(snapshot);
  for (const elapsed of [0, 1, 5876, 18001, 178000]) {
    device.advanceMicroseconds(elapsed); restored.advanceMicroseconds(elapsed);
    assert.deepEqual(restored.snapshot(), device.snapshot());
    assert.deepEqual(new IbmXtDiskette(device.snapshot()).snapshot(), device.snapshot());
  }
  assert.equal(device.irq(), true); command(device, 8); assert.equal(device.read(3), 0x20);
  const oneLeft = new IbmXtDiskette(device.snapshot());
  assert.equal(oneLeft.read(3), 34); assert.equal(oneLeft.status(), 0x80);
  assert.equal(device.status(), 0xd0);
  (snapshot.parameters as unknown as number[])[0] = 255;
  assert.equal(device.snapshot().parameters[0], 0);
});

test("XT empty reads wait for absent index/data pulses without manufacturing an interrupt or result", () => {
  for (const bytes of [[0xe6, 0, 0, 0, 1, 2, 9, 0x2a, 0xff], [0x4a, 0]]) {
    const device = fixture(); command(device, ...bytes);
    assert.equal(device.status(), 0x10); assert.equal(device.irq(), false);
    const waiting = device.snapshot(), restored = new IbmXtDiskette(waiting);
    device.advanceMicroseconds(0xffffffff); restored.advanceMicroseconds(0xffffffff);
    assert.deepEqual(device.snapshot(), waiting); assert.deepEqual(restored.snapshot(), waiting);
    assert.equal(device.read(3), 0xff); assert.deepEqual(device.snapshot(), waiting);
    assert.throws(() => command(device, 8), RangeError); assert.deepEqual(device.snapshot(), waiting);
    device.write(0, 8); device.write(0, 0x0c); device.advanceMicroseconds(2048); sense(device, 0xc0, 0);
  }
});

test("XT controller reset cancels every protocol phase while retaining Specify and physical position", () => {
  const device = fixture(); command(device, 15, 0, 20); device.advanceMicroseconds(12345);
  assert.equal(device.snapshot().cylinder, 2);
  device.write(0, 8); device.advanceMicroseconds(1000000);
  assert.equal(device.snapshot().cylinder, 2); assert.equal(device.snapshot().pcn, 0);
  assert.equal(device.snapshot().srt_hut, 0xdf); assert.equal(device.irq(), false);
  device.write(0, 0x1c); device.advanceMicroseconds(2048); sense(device, 0xc0, 0);
  command(device, 7, 0); device.advanceMicroseconds(12000); sense(device, 0x20, 0);
  for (const bytes of [[3, 0x80], [4, 0], [15, 0, 1]]) {
    command(device, ...bytes); device.reset();
    assert.equal(device.status(), 0); assert.equal(device.snapshot().srt_hut, 0xdf);
    assert.equal(device.snapshot().hlt, 2); assert.equal(device.irq(), false);
    device.write(0, 0x1c); device.advanceMicroseconds(2048); sense(device, 0xc0, 0);
  }
});

test("XT diskette rejects unsupported modes, commands, units, inputs and contradictory saved state", () => {
  const device = fixture();
  for (const opcode of [5, 0x45, 0x4d, 0x51]) {
    const before = device.snapshot(); assert.throws(() => command(device, opcode), RangeError); assert.deepEqual(device.snapshot(), before);
  }
  command(device, 3, 0xaf); const specify = device.snapshot();
  assert.throws(() => command(device, 1), RangeError); assert.deepEqual(device.snapshot(), specify); command(device, 2);
  command(device, 15); const seek = device.snapshot();
  assert.throws(() => command(device, 1), RangeError); assert.deepEqual(device.snapshot(), seek); command(device, 0, 1);
  const active = device.snapshot(); assert.throws(() => command(device, 15), RangeError); assert.deepEqual(device.snapshot(), active);
  for (const invalid of [-1, 1.5, 0x100000000, NaN]) assert.throws(() => device.advanceMicroseconds(invalid), RangeError);
  assert.throws(() => device.write(0, 256), RangeError); assert.deepEqual(device.snapshot(), active);
  for (const invalid of [{ phase: 4 }, { cylinder: 40 }, { step_us: 0 }, { steps_left: 0 }, { interrupt: true },
    { reset_us: 2049 }, { result_left: 1 }, { phase: 1, received: 3 }, { dor: 0 }]) {
    assert.throws(() => new IbmXtDiskette({ ...active, ...invalid }), /Invalid/);
  }
  assert.throws(() => new IbmXtDiskette({ ...active, parameters: [] } as never), TypeError);
  assert.throws(() => new IbmXtDiskette({ ...active, interrupt: 1 } as never), TypeError);
});
