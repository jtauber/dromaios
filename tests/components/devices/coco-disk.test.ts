import assert from "node:assert/strict";
import { test } from "node:test";
import { CocoDiskCircuit } from "../../../src/components/devices/generated/coco-disk.js";

function mounted() {
  const chip = new CocoDiskCircuit(); chip.setMedia(true, false); chip.setControl(0x29); return chip;
}
function event(chip: CocoDiskCircuit, byte = 0): number {
  const delay = chip.remainingMicroseconds(); assert.ok(delay > 0);
  chip.elapse(delay); chip.event(byte);
  assert.deepEqual(new CocoDiskCircuit(chip.snapshot()).snapshot(), chip.snapshot());
  return delay;
}
function finish(chip: CocoDiskCircuit): number {
  let elapsed = 0;
  for (let i = 0; chip.status() & 1; i++) { assert.ok(i < 300); elapsed += event(chip); }
  return elapsed;
}

test("FD-502 register types, READY wiring, HALT gate, and NMI assertion edges", () => {
  const chip = mounted();
  assert.equal(chip.status(), 0x44); // WP and physical track zero, no invented not-ready/index.
  chip.setControl(0xa9); assert.equal(chip.halted(), true);
  chip.write(0, 0xd8); assert.equal(chip.halted(), false);
  assert.equal(chip.snapshot().control, 0x29); assert.equal(chip.nmiPending(), true);
  chip.consumeNmi(); chip.read(0); assert.equal(chip.snapshot().intrq, true);
  chip.setControl(0xa9); assert.equal(chip.nmiPending(), false); assert.equal(chip.halted(), false);
  chip.setControl(0x09); assert.equal(chip.snapshot().nmi_level, false);
  chip.setControl(0x29); assert.equal(chip.nmiPending(), true);
  chip.consumeNmi(); chip.write(0, 0xd0); chip.read(0);
  assert.equal(chip.snapshot().intrq, false);
  chip.write(0, 3); event(chip); assert.equal(chip.nmiPending(), true);
  const before = chip.snapshot(); chip.status(); chip.snapshot();
  assert.deepEqual(chip.snapshot(), before);
  chip.read(0); assert.equal(chip.snapshot().intrq, false);
  assert.equal(chip.nmiPending(), true, "acknowledging the level does not erase an already captured edge");
});

test("WD1773 step rates, physical/logical track separation, restore and verify", () => {
  for (const [rate, interval] of [6000, 12000, 20000, 30000].entries()) {
    const chip = mounted(); chip.write(3, 3); chip.write(0, 0x10 | rate);
    for (let cylinder = 1; cylinder <= 3; cylinder++) {
      assert.equal(chip.remainingMicroseconds(), interval); chip.elapse(interval - 1);
      assert.equal(chip.snapshot().cylinder, cylinder - 1); event(chip);
      assert.equal(chip.snapshot().track, cylinder); assert.equal(chip.snapshot().cylinder, cylinder);
    }
    chip.write(1, 20); assert.equal(chip.snapshot().cylinder, 3);
    chip.write(0, 0x40 | rate); assert.equal(finish(chip), interval); // STEP IN without U.
    assert.equal(chip.snapshot().track, 20); assert.equal(chip.snapshot().cylinder, 4);
    chip.write(0, 0x70 | rate); finish(chip); // STEP OUT with U.
    assert.equal(chip.snapshot().track, 19); assert.equal(chip.snapshot().cylinder, 3);
    chip.write(0, rate); assert.equal(finish(chip), 3 * interval);
    assert.equal(chip.snapshot().track, 0); assert.equal(chip.snapshot().cylinder, 0);
    chip.write(3, 1); chip.write(0, 0x14 | rate);
    assert.equal(finish(chip), interval + 30000); assert.equal(chip.snapshot().error, 0);
  }
  const chip = mounted(); chip.write(3, 41); chip.write(0, 0x14);
  assert.equal(finish(chip), 41 * 6000 + 30000 + 1000000);
  assert.equal(chip.snapshot().cylinder, 39); assert.equal(chip.snapshot().track, 41);
  assert.equal(chip.status() & 0x10, 0x10);
});

test("single-sector MFM reads have timed byte deadlines, final CRC time and lost-data status", () => {
  const chip = mounted(); chip.write(2, 18); chip.write(0, 0x84);
  assert.equal(chip.remainingMicroseconds(), 30032); event(chip);
  for (let i = 0; i < 256; i++) {
    assert.equal(chip.remainingMicroseconds(), 32);
    assert.equal(chip.mediaOffset(), 17 * 256 + i);
    event(chip, i ^ 0xa5); assert.equal(chip.status(), 3);
    assert.equal(chip.read(3), i ^ 0xa5); assert.equal(chip.status(), 1);
    chip.setControl(0xa9); assert.equal(chip.halted(), true);
  }
  assert.equal(event(chip), 32); assert.equal(chip.status(), 1);
  assert.equal(event(chip), 32); assert.equal(chip.status(), 0);
  assert.equal(chip.halted(), false); assert.equal(chip.nmiPending(), true);
  chip.read(0); chip.consumeNmi(); chip.write(0, 0x80); event(chip);
  event(chip, 0x11); event(chip, 0x22); // First byte overwritten.
  assert.equal(chip.read(3), 0x22); assert.equal(chip.status(), 5);
  finish(chip); assert.equal(chip.status(), 4);
  assert.equal(chip.snapshot().byte_index, 256, "loss does not stop rotation or shorten the transfer");
});

test("bad IDs time out, absent media waits for software, and writes cannot change a protected disk", () => {
  for (const [track, sector, command] of [[1, 1, 0x80], [0, 0, 0x80], [0, 19, 0x80], [0, 1, 0x8a]]) {
    const chip = mounted(); chip.write(1, track!); chip.write(2, sector!); chip.write(0, command!);
    assert.equal(finish(chip), 32 + 800000); assert.equal(chip.status(), 0x10);
  }
  const chip = mounted(); chip.setMedia(false, false); chip.write(0, 0x80);
  assert.equal(chip.status(), 1); assert.equal(chip.remainingMicroseconds(), 0);
  chip.elapse(1000000); assert.equal(chip.status(), 1);
  chip.write(0, 0xd0); assert.equal(chip.status(), 0, "abort preserves the active Type II status class");
  chip.setMedia(true, false); chip.write(0, 0xa0);
  assert.equal(chip.status(), 0x40); assert.equal(chip.snapshot().intrq, true);
});

test("unsupported commands and busy register writes reject atomically; ordinary commands while busy are ignored", () => {
  const chip = mounted();
  for (const command of [0x90, 0xb0, 0xc0, 0xd1, 0xd4, 0xe0, 0xf0]) {
    const before = chip.snapshot(); assert.throws(() => chip.write(0, command), RangeError);
    assert.deepEqual(chip.snapshot(), before);
  }
  chip.setControl(9); assert.throws(() => chip.write(0, 0x80), RangeError);
  chip.setControl(0x29); chip.write(0, 0x80); const reading = chip.snapshot();
  chip.write(0, 0xc0); assert.deepEqual(chip.snapshot(), reading);
  for (const address of [1, 2, 3]) {
    assert.throws(() => chip.write(address, 7), RangeError); assert.deepEqual(chip.snapshot(), reading);
  }
  chip.reset(); const reset = chip.snapshot();
  assert.equal(reset.media, true); assert.equal(reset.phase, 0); assert.equal(reset.nmi_pending, false);
  for (const invalid of [{ phase: 6 }, { timer: 1 }, { cylinder: 40 }, { byte_index: 257 },
    { drq: true }, { intrq: true, nmi_level: true }, { immediate: true }, { phase: 2, timer: 32, media: false }]) {
    assert.throws(() => new CocoDiskCircuit({ ...reset, ...invalid }), RangeError);
  }
});

test("writes request the first byte separately, then retire 256 timed bytes and the final CRC", () => {
  const chip = mounted(); chip.setMedia(true, true);
  assert.equal(chip.status(), 4, "write permission removes WP but preserves physical track zero");
  chip.write(0, 0xa4); assert.equal(event(chip), 30032);
  assert.equal(chip.snapshot().phase, 6); assert.equal(chip.snapshot().drq, true);
  assert.equal(chip.writesByte(), false); assert.equal(chip.remainingMicroseconds(), 288);
  chip.write(3, 0xa5); assert.equal(chip.snapshot().drq, false);
  assert.equal(event(chip), 288); assert.equal(chip.snapshot().phase, 7);
  for (let i = 0; i < 256; i++) {
    if (i) { assert.equal(chip.snapshot().drq, true); chip.write(3, i ^ 0xa5); }
    assert.equal(chip.writeByte(), i ^ 0xa5); assert.equal(chip.mediaOffset(), i);
    assert.equal(chip.writesByte(), true); assert.equal(event(chip), 32);
    assert.equal(chip.snapshot().byte_index, i + 1); assert.equal(chip.snapshot().error, 0);
  }
  assert.equal(chip.snapshot().phase, 4); assert.equal(chip.snapshot().drq, false);
  assert.equal(chip.writesByte(), false); assert.equal(chip.nmiPending(), false);
  assert.equal(event(chip), 88); assert.equal(chip.status(), 0); assert.equal(chip.nmiPending(), true);
});

test("missing the first write request aborts; later underruns write zero and continue", () => {
  const chip = mounted(); chip.setMedia(true, true); chip.write(0, 0xa0);
  event(chip); assert.equal(event(chip), 288);
  assert.equal(chip.status(), 4); assert.equal(chip.snapshot().byte_index, 0);
  assert.equal(chip.writesByte(), false); assert.equal(chip.snapshot().intrq, true);
  chip.write(0, 0xa0); event(chip); chip.write(3, 0x5a); event(chip);
  assert.equal(chip.writeByte(), 0x5a); event(chip);
  assert.equal(chip.writeByte(), 0); event(chip);
  assert.equal(chip.status(), 7); assert.equal(chip.snapshot().byte_index, 2);
  chip.write(3, 0x81); assert.equal(chip.writeByte(), 0x81); event(chip);
  assert.equal(chip.snapshot().error, 4);
  chip.write(0, 0xd0); assert.equal(chip.snapshot().byte_index, 3); assert.equal(chip.status(), 4);
});

test("write requests enforce DATA ownership and writable-state invariants", () => {
  const chip = mounted(); chip.setMedia(true, true);
  for (const command of [0xa1, 0xa3, 0xab, 0xb0]) {
    const before = chip.snapshot(); assert.throws(() => chip.write(0, command)); assert.deepEqual(chip.snapshot(), before);
  }
  chip.write(0, 0xa0); const search = chip.snapshot();
  assert.throws(() => chip.write(3, 1)); assert.deepEqual(chip.snapshot(), search);
  event(chip); chip.write(3, 1); const supplied = chip.snapshot();
  for (const address of [1, 2, 3]) {
    assert.throws(() => chip.write(address, 9)); assert.deepEqual(chip.snapshot(), supplied);
  }
  for (const invalid of [{ writable: false }, { media: false }, { byte_index: 1 }, { command: 0x80 }, { timer: 289 }]) {
    assert.throws(() => new CocoDiskCircuit({ ...supplied, ...invalid }));
  }
  chip.reset(); assert.equal(chip.snapshot().writable, true); assert.equal(chip.snapshot().media, true);
  assert.throws(() => new CocoDiskCircuit({ ...chip.snapshot(), media: false }));
});
