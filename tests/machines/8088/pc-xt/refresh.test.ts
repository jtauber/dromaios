import assert from "node:assert/strict";
import { test } from "node:test";
import { XtIo } from "../../../../src/machines/8088/pc-xt/io.js";

function configured(divisor = 3) {
  const io = new XtIo();
  io.write(0, 0x34); io.write(0, 0x12); io.write(1, 1); io.write(1, 0);
  io.write(11, 0x58); io.write(10, 0);
  io.write(0x43, 0x54); io.write(0x41, divisor);
  return io;
}

test("XT OUT1 rising latches DREQ0; a four-clock grant clears it without retriggering a held output", () => {
  const io = configured();
  assert.equal(io.snapshot().refreshPending, true); assert.equal(io.read(8), 0x10);
  assert.deepEqual(io.serviceRefresh(), { address: 0x1234, oscillatorTicks: 12 });
  assert.equal(io.oscillatorTicks, 12); assert.equal(io.read(8), 0);
  assert.equal(io.snapshot().pit.channels[1].count, 3);
  assert.equal(io.serviceRefresh(), undefined);
  io.advanceOscillatorTicks(24); // Count 2 then 1; OUT1 falls, but falling does not request DMA.
  assert.equal(io.refreshOutput, false); assert.equal(io.snapshot().refreshPending, false);
  io.advanceOscillatorTicks(12); // Reload and rising edge.
  assert.equal(io.refreshOutput, true); assert.equal(io.read(8), 0x10);
  assert.deepEqual(io.serviceRefresh(), { address: 0x1235, oscillatorTicks: 12 });
  assert.equal(io.read(8), 1); assert.equal(io.snapshot().dma.address[0], 0x1234);
  assert.equal(io.snapshot().dma.count[0], 1);
});

test("XT masked refresh edges coalesce; disabling and master clearing DMA preserve the board request", () => {
  const io = configured(); io.write(10, 4);
  io.advanceOscillatorTicks(1200);
  const before = io.snapshot();
  assert.equal(io.serviceRefresh(), undefined); assert.deepEqual(io.snapshot(), before);
  io.write(8, 4); io.write(10, 0);
  assert.equal(io.serviceRefresh(), undefined); assert.equal(io.read(8), 0x10);
  io.write(13, 0); assert.equal(io.snapshot().refreshPending, true); assert.equal(io.read(8), 0x10);
  io.write(10, 0); assert.equal(io.serviceRefresh()?.address, 0x1234);
  assert.equal(io.serviceRefresh(), undefined);
  io.reset(); assert.equal(io.snapshot().refreshPending, false); assert.equal(io.read(8), 0);
  assert.equal(io.oscillatorTicks, 0); assert.equal(io.snapshot().dma.mask, 15);
});

test("XT DACK0 holds the refresh latch clear even when OUT1 rises during the grant", () => {
  const io = configured(2);
  io.advanceOscillatorTicks(24); // Count 1, OUT1 low, original request still latched.
  assert.equal(io.refreshOutput, false);
  io.serviceRefresh(); // Next timer pulse raises OUT1 while CLEAR is active.
  assert.equal(io.refreshOutput, true); assert.equal(io.snapshot().refreshPending, false);
  io.advanceOscillatorTicks(12); assert.equal(io.snapshot().refreshPending, false);
  io.advanceOscillatorTicks(12); assert.equal(io.snapshot().refreshPending, true);
});

test("XT refresh snapshots retain pending edges and reject inconsistent wiring or unsupported grants", () => {
  const io = configured(); io.advanceOscillatorTicks(5);
  const saved = io.snapshot(), restored = new XtIo(saved);
  assert.deepEqual(restored.serviceRefresh(), io.serviceRefresh());
  assert.deepEqual(restored.snapshot(), io.snapshot());
  const held = new XtIo(io.snapshot());
  held.advanceOscillatorTicks(1); assert.equal(held.snapshot().refreshPending, false);
  assert.throws(() => new XtIo({ ...saved, refreshPending: false }), /wiring/);
  assert.throws(() => new XtIo({ ...saved, dma: { ...saved.dma, levels: 3 } }), /wiring/);
  assert.throws(() => new XtIo({ ...saved, refreshPending: undefined } as never), /requires/);
  const overflow = new XtIo({ ...saved, clock: { ticks: Number.MAX_SAFE_INTEGER - 3 } });
  const beforeOverflow = overflow.snapshot();
  assert.throws(() => overflow.serviceRefresh(), /exact range/);
  assert.deepEqual(overflow.snapshot(), beforeOverflow);
  const verify = configured(); verify.write(11, 0x40);
  const beforeVerify = verify.snapshot();
  assert.throws(() => verify.serviceRefresh(), /only channel-0/);
  assert.deepEqual(verify.snapshot(), beforeVerify);
});
