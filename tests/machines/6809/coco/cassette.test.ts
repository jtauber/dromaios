import assert from "node:assert/strict";
import { test } from "node:test";
import { CocoCassette, cocoTapeSampleRate, cocoTapeSampleLimit } from "../../../../src/components/devices/coco-cassette.js";
import { readCocoTapeWav, writeCocoTapeWav } from "../../../../src/components/devices/coco-tape-wav.js";
import { CocoPias } from "../../../../src/machines/6809/coco/pias.js";
import { create6809Coco } from "../../../../src/machines/generated/6809/coco.js";
import { stepCoco } from "../../../../src/machines/6809/coco/runtime.js";

test("cassette relay, DAC and input comparator follow resolved PIA pins without acknowledging interrupts", () => {
  const io = new CocoPias(); io.write(0x21, 0x34); // Motor off, data register selected.
  io.cassette.insert("levels.wav", [0, 127, 128, 129, 255]); io.cassette.play();
  io.cassette.advance(2, cocoTapeSampleRate, io.cassetteMotor, 0);
  assert.equal(io.cassette.inspect().position, 0); assert.equal(io.inspect().pia1.input_a, 0xff);
  io.write(0x21, 0x3d); io.setCarrierDetect(false); assert.equal(io.firq, true);
  for (const expected of [0xff, 0xff, 0xff, 0xfe, 0xfe]) {
    assert.equal(io.inspect().pia1.input_a, expected); assert.equal(io.firq, true);
    io.cassette.advance(1, cocoTapeSampleRate, io.cassetteMotor, 0);
  }
  assert.equal(io.cassette.inspect().mode, "stop"); assert.equal(io.inspect().pia1.input_a, 0xff);
  io.write(0x21, 0x38); io.write(0x20, 0xfc); io.write(0x21, 0x3c);
  for (let dac = 0; dac < 64; dac++) {
    io.write(0x3c, dac * 4 + 3); assert.equal(io.cassetteOutput, dac * 4);
    io.write(0x23, dac & 1 ? 0x34 : 0x3c); assert.equal(io.cassetteOutput, dac * 4, "sound enable does not gate tape output");
  }
  io.write(0x21, 0x38); io.write(0x20, 0); assert.equal(io.cassetteOutput, 252, "input pins are released high");
});

test("recording, overwrite permission, fractional samples and motor pauses survive detached snapshots", () => {
  const tape = new CocoCassette(); tape.blank("test.wav"); tape.record();
  tape.advance(1, cocoTapeSampleRate * 2, true, 12);
  const halfway = tape.snapshot(); assert.equal(halfway.phase, .5); assert.deepEqual(halfway.samples, []);
  tape.advance(1, cocoTapeSampleRate * 2, false, 99); assert.deepEqual(tape.snapshot(), halfway);
  tape.stop(); tape.record(); tape.advance(3, cocoTapeSampleRate * 2, true, 200);
  const restored = new CocoCassette(undefined, halfway); restored.advance(3, cocoTapeSampleRate * 2, true, 200);
  assert.deepEqual(restored.snapshot(), tape.snapshot()); assert.deepEqual(tape.samples(), Uint8Array.of(200, 200));
  assert.deepEqual(halfway.samples, []);
  const exported = tape.samples(); tape.rewind(); tape.record(); tape.advance(1, cocoTapeSampleRate, true, 25);
  assert.deepEqual(tape.samples(), Uint8Array.of(25, 200)); assert.deepEqual(exported, Uint8Array.of(200, 200));
  tape.insert("protected.wav", exported); assert.throws(() => tape.record(), /writable/);
  tape.writableCopy(); tape.record(); tape.advance(1, cocoTapeSampleRate, true, 0); assert.deepEqual(exported, Uint8Array.of(200, 200));
  const before = tape.snapshot();
  for (const samples of [[256], [-1], [NaN]]) assert.throws(() => tape.insert("bad.wav", samples));
  for (const bad of [{ ...before, phase: 1 }, { ...before, position: 100 }, { ...before, writable: false }, { ...before, samples: null }]) {
    assert.throws(() => new CocoCassette(undefined, bad));
  }
  assert.deepEqual(tape.snapshot(), before);
  const full = new CocoCassette(); full.blank(); full.record(); full.advance(cocoTapeSampleLimit + 10, cocoTapeSampleRate, true, 128);
  assert.equal(full.inspect().length, cocoTapeSampleLimit); assert.equal(full.inspect().mode, "stop"); assert.throws(() => full.record(), /limit/);
});

test("ordinary and waiting CPU boundaries move tape with the interval's starting relay and DAC levels", () => {
  const machine = create6809Coco({ firmware: null, extended: null }), io = machine.pias;
  io.write(0x20, 0xfc); io.write(0x21, 0x3c); io.write(0x20, 0x40);
  io.cassette.blank(); io.cassette.record();
  // Eight NOPs / LDA #$C0 / STA $FF20 / SYNC: the first sample falls inside STA.
  [...Array(8).fill(0x12), 0x86, 0xc0, 0xb7, 0xff, 0x20, 0x13].forEach((byte, at) => machine.ram.write(at, byte));
  for (let i = 0; i < 8; i++) stepCoco(machine);
  const first = stepCoco(machine), write = stepCoco(machine), wait = stepCoco(machine), idle = stepCoco(machine);
  assert.ok(first.clocks + write.clocks + wait.clocks + idle.idleClocks > 20);
  assert.deepEqual(io.cassette.samples(), Uint8Array.of(64, 192));
  const saved = machine.snapshot(); machine.reset(); assert.deepEqual(io.cassette.snapshot(), saved.pias.cassette);
  const copy = create6809Coco({ firmware: null, extended: null }, saved);
  const other = create6809Coco({ firmware: null, extended: null }, saved);
  for (let i = 0; i < 20; i++) { stepCoco(copy); stepCoco(other); }
  assert.deepEqual(copy.snapshot(), other.snapshot());
});

test("WAV codec preserves samples and padding, skips metadata, and rejects malformed or unsupported files", () => {
  for (const data of [[], [0], [0, 128, 255], [12, 34, 56, 78]]) {
    const samples = Uint8Array.from(data), wav = writeCocoTapeWav(samples);
    assert.deepEqual(readCocoTapeWav(wav), samples);
    assert.equal(wav.length, 44 + samples.length + (samples.length & 1));
    const metadata = new Uint8Array(wav.length + 12); metadata.set(wav.subarray(0, 12));
    metadata.set([74, 85, 78, 75, 3, 0, 0, 0, 9, 8, 7, 0], 12); metadata.set(wav.subarray(12), 24);
    new DataView(metadata.buffer).setUint32(4, metadata.length - 8, true);
    assert.deepEqual(readCocoTapeWav(metadata), samples);
  }
  const valid = writeCocoTapeWav(Uint8Array.of(0, 128, 255));
  for (const at of [0, 4, 8, 20, 22, 24, 28, 32, 34, 40]) {
    const corrupt = valid.slice(); corrupt[at] = 99; assert.throws(() => readCocoTapeWav(corrupt));
  }
  assert.throws(() => readCocoTapeWav(valid.subarray(0, valid.length - 1)));
});
