import assert from "node:assert/strict";
import { test } from "node:test";
import { I8237a } from "../../../src/components/devices/generated/i8237a.js";

function word(dma: I8237a, port: number, value: number) {
  dma.write(0x0c, 0); dma.write(port, value & 255); dma.write(port, value >>> 8);
}
function readWord(dma: I8237a, port: number) {
  dma.write(0x0c, 0);
  const low = dma.read(port), high = dma.read(port);
  assert.ok(typeof low === "number" && typeof high === "number");
  return low | high << 8;
}
function configured(mode = 0x48, address = 0x12ff, count = 1) {
  const dma = new I8237a();
  word(dma, 0, address); word(dma, 1, count);
  dma.write(0x0b, mode); dma.write(0x0a, 0);
  dma.setRequests(true, false, false, false);
  return dma;
}

test("8237A exposes all four current register pairs and retains separate unreadable base values", () => {
  const dma = new I8237a();
  assert.equal(dma.size, 16); assert.equal(dma.snapshot().mask, 15);
  for (let port = 0; port < 8; port++) word(dma, port, 0x1234 + port * 0x1111);
  for (let port = 0; port < 8; port++) assert.equal(readWord(dma, port), 0x1234 + port * 0x1111);
  assert.deepEqual(dma.snapshot().address, [0x1234, 0x3456, 0x5678, 0x789a]);
  assert.deepEqual(dma.snapshot().count, [0x2345, 0x4567, 0x6789, 0x89ab]);
  assert.deepEqual(dma.snapshot().base_address, dma.snapshot().address);
  assert.deepEqual(dma.snapshot().base_count, dma.snapshot().count);
  for (const port of [9, 10, 11, 12, 14, 15]) assert.equal(dma.read(port), "bus-error");
  assert.equal(dma.read(13), 0);
});

test("8237A shares one byte flip-flop across channels, count/address, and read/write direction", () => {
  const dma = new I8237a();
  dma.write(0, 0x34); // Low address 0; next access is high, regardless of its port.
  dma.write(3, 0x12); // High count 1.
  assert.equal(dma.read(0), 0x34); // Low, advances to high.
  dma.write(4, 0x56); // High address 2.
  assert.deepEqual(dma.snapshot().address, [0x34, 0, 0x5600, 0]);
  assert.deepEqual(dma.snapshot().count, [0, 0x1200, 0, 0]);
  dma.read(0); dma.read(8); dma.write(0x0a, 7); // Neither status nor mask changes byte phase.
  assert.equal(dma.snapshot().high_byte, true);
  dma.write(0x0c, 0xff); assert.equal(dma.snapshot().high_byte, false);
});

test("8237A updates base and current bytes independently after DMA has moved the address", () => {
  const dma = configured(0x48, 0xff, 3);
  dma.completeTransfer();
  assert.equal(dma.transferAddress(), 0x100);
  dma.write(0x0c, 0); dma.write(0, 0xaa);
  assert.equal(dma.snapshot().address[0], 0x1aa);
  assert.equal(dma.snapshot().base_address[0], 0xaa);
  dma.write(0, 0xbb);
  assert.equal(dma.snapshot().address[0], 0xbbaa);
  assert.equal(dma.snapshot().base_address[0], 0xbbaa);
});

test("8237A count N allows N+1 transfers, wraps, masks, and clears only terminal bits on status reads", () => {
  const dma = configured();
  dma.completeTransfer();
  assert.equal(dma.transferAddress(), 0x1300); assert.equal(dma.snapshot().count[0], 0);
  assert.equal(dma.read(8), 0x10);
  dma.completeTransfer();
  assert.equal(dma.snapshot().address[0], 0x1301); assert.equal(dma.snapshot().count[0], 0xffff);
  assert.equal(dma.pending(), 0); assert.equal(dma.transferReady(), false);
  assert.equal(dma.read(8), 0x11); assert.equal(dma.read(8), 0x10);
  const ended = dma.snapshot(); dma.completeTransfer(); assert.deepEqual(dma.snapshot(), ended);
});

test("8237A auto-initialization reloads base registers and decrement wraps at zero", () => {
  const dma = configured(0x78, 0, 1); // Single read, decrement, auto-initialize.
  dma.completeTransfer();
  assert.equal(dma.transferAddress(), 0xffff); assert.equal(dma.snapshot().count[0], 0);
  dma.completeTransfer();
  assert.equal(dma.transferAddress(), 0); assert.equal(dma.snapshot().count[0], 1);
  assert.equal(dma.snapshot().mask, 14); assert.equal(dma.pending(), 1);
  assert.equal(dma.read(8), 0x11);
  dma.setRequests(false, false, false, false);
  assert.equal(dma.read(8), 0); assert.equal(dma.pending(), 0);
});

test("8237A fixed priority, masks, controller disable, and verify all preserve external request levels", () => {
  const dma = new I8237a();
  for (let channel = 0; channel < 4; channel++) {
    word(dma, channel * 2, 0x1000 * channel); word(dma, channel * 2 + 1, 1);
    dma.write(0x0b, 0x40 | channel);
  }
  dma.setRequests(true, true, true, true);
  assert.equal(dma.read(8), 0xf0); assert.equal(dma.pending(), 0);
  dma.write(0x0e, 0xff); assert.equal(dma.pending(), 1);
  dma.write(8, 4); assert.equal(dma.pending(), 0); assert.equal(dma.read(8), 0xf0);
  dma.write(8, 0);
  for (let channel = 0; channel < 4; channel++) {
    assert.equal(dma.pending(), 1 << channel); assert.equal(dma.transferChannel(), channel);
    assert.equal(dma.readTransfer(), false); assert.equal(dma.transferReady(), true);
    dma.completeTransfer(); assert.equal(dma.snapshot().address[channel], 0x1000 * channel + 1);
    dma.write(0x0a, 4 | channel);
  }
  dma.write(0x0f, 0xfa); assert.equal(dma.snapshot().mask, 10); assert.equal(dma.pending(), 1);
});

test("8237A master clear retains channel registers and pins, while construction owns detached arrays", () => {
  const dma = configured(0x58, 0x1234, 0);
  dma.completeTransfer(); dma.read(0);
  const saved = dma.snapshot(), restored = new I8237a(saved);
  assert.deepEqual(restored.snapshot(), saved); assert.equal(restored.read(0), 0x12);
  dma.write(0x0d, 0x99);
  assert.deepEqual(dma.snapshot(), { ...saved, command: 0, mask: 15, terminal: 0, high_byte: false });
  restored.reset(); assert.deepEqual(restored.snapshot(), dma.snapshot());
  (saved.address as unknown as number[])[0] = 0xffff;
  assert.equal(restored.snapshot().address[0], 0x1234);
  assert.equal(dma.snapshot().address[0], 0x1234);
  assert.equal(new I8237a().snapshot().address[0], 0);
});

test("8237A rejects unsupported modes, commands, host values, and invalid snapshots without mutation", () => {
  const dma = configured(); const saved = dma.snapshot();
  for (const [port, values] of [
    [8, [1, 2, 8, 16, 32, 64, 128, 255]],
    [11, [0, 0x44, 0x4c, 0x80, 0xc0, 0xff]],
    [9, [4, 5, 6, 7]],
  ] as const) for (const value of values) assert.throws(() => dma.write(port, value), /Unsupported/);
  for (const value of [-1, 256, 1.5, NaN]) assert.throws(() => dma.write(0, value), RangeError);
  assert.throws(() => dma.setRequests(false, false, false, 1 as never), TypeError);
  assert.deepEqual(dma.snapshot(), saved);
  for (const patch of [
    { address: [1, 2, 3] }, { count: [0, 0, 65536, 0] }, { mode: [0x80, 0, 0, 0] },
    { mode: [0x48, 0x41, 0, 0] }, { command: 8 }, { mask: 16 }, { levels: 16 }, { terminal: 16 },
    { high_byte: 1 },
  ]) assert.throws(() => new I8237a({ ...saved, ...patch } as never));
  const unconfigured = new I8237a(); unconfigured.write(14, 0); unconfigured.setRequests(true, false, false, false);
  const before = unconfigured.snapshot();
  assert.equal(unconfigured.transferReady(), false); unconfigured.completeTransfer();
  assert.deepEqual(unconfigured.snapshot(), before);
});
