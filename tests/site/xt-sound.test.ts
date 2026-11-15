import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { XtIo } from "../../src/machines/8088/pc-xt/io.js";
import { xtOscillatorHz } from "../../src/machines/8088/pc-xt/clock.js";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/8088/pc-xt.js";
import { createXtSession } from "../../site/interactive/xt-session.js";
import { createSpeakerSamples } from "../../site/interactive/speaker-samples.js";
import { decodeXtCheckpoint, encodeXtCheckpoint } from "../../site/interactive/xt-checkpoint.js";
import { expectLastRows, screen, waitingForKey } from "../machines/8088/pc-xt/rom-console.js";

function tone(io: XtIo, divisor: number): void {
  io.write(0x63, 0x99); io.write(0x43, 0xb6);
  io.write(0x42, divisor & 255); io.write(0x42, divisor >>> 8); io.write(0x61, 3);
}

function waveform(io: XtIo) {
  const edges: [number, boolean][] = [], pcm: number[] = [];
  const samples = createSpeakerSamples(io.clock.hertz, 48000, io.clock.ticks, Number(io.speakerLevel));
  const dispose = io.observeSpeaker((ticks, level) => { edges.push([ticks, level]); samples.advance(ticks, Number(level)); });
  return { edges, pcm, dispose, drain() {
    samples.advance(io.clock.ticks, Number(io.speakerLevel)); pcm.push(...samples.take());
  } };
}

test("XT speaker observation preserves every PIT edge within an interval, direct PPI changes and disposal", () => {
  const io = new XtIo(); tone(io, 4);
  const observed = waveform(io), unobserved = new XtIo(io.snapshot());
  io.advanceOscillatorTicks(108); unobserved.advanceOscillatorTicks(108);
  assert.deepEqual(observed.edges, [[36, false], [60, true], [84, false], [108, true]]);
  assert.deepEqual(io.snapshot(), unobserved.snapshot(), "observation cannot change hardware");
  io.write(0x61, 1); io.write(0x61, 3);
  assert.deepEqual(observed.edges.slice(-2), [[108, false], [108, true]]);
  const count = observed.edges.length;
  observed.dispose(); io.advanceOscillatorTicks(108); assert.equal(observed.edges.length, count);
});

test("XT audio and PIT phase replay exactly from a partial-period checkpoint at different batch sizes", () => {
  const initial = new XtIo(); tone(initial, 2711); initial.advanceOscillatorTicks(12345);
  const saved = initial.snapshot();
  function play(batch: number) {
    const io = new XtIo(saved), wave = waveform(io);
    assert.equal(io.clock, io.clock); assert.equal(io.clock.hertz, xtOscillatorHz);
    for (let remaining = 800000; remaining > 0;) {
      const ticks = Math.min(batch, remaining); io.advanceOscillatorTicks(ticks); wave.drain(); remaining -= ticks;
    }
    wave.dispose(); return { edges: wave.edges, pcm: wave.pcm, state: io.snapshot() };
  }
  const first = play(800000);
  assert.deepEqual(play(997), first);
  assert.equal(first.edges[2]![0] - first.edges[0]![0], 2711 * 12);
  assert.ok(first.pcm.some(sample => sample !== 0));
});

const optional = { skip: !(process.env.XT_BIOS_ROM && process.env.XT_BASIC_ROM && process.env.XT_CGA_ROM)
  && "Set XT_BIOS_ROM, XT_BASIC_ROM and XT_CGA_ROM for original BASIC sound." };

test("original XT BASIC sounds two pitches, replays a mid-note checkpoint and returns to its prompt", optional, async () => {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const session = createXtSession({
    bios: await RomImage.verify(readFileSync(process.env.XT_BIOS_ROM!), romImages.bios, digest),
    basic: await RomImage.verify(readFileSync(process.env.XT_BASIC_ROM!), romImages.basic, digest),
    font: await RomImage.verify(readFileSync(process.env.XT_CGA_ROM!), romImages.font, digest),
  });
  session.powerOn("quick");
  function runUntil(done: () => boolean, step = () => { session.step(); }, limit = 8_000_000) {
    for (let i = 0; i < limit; i++) { step(); if (done()) return; }
    assert.fail(`BASIC did not complete: ${screen(session.machine).join("\n")}`);
  }
  runUntil(() => waitingForKey(session.machine));
  const prompt = session.snapshot();
  session.keyboard.paste("SOUND 440,9:SOUND 880,9:PRINT 42\n");
  const opening = waveform(session.machine.io);
  runUntil(() => opening.edges.length >= 17, () => { session.step(); opening.drain(); });
  opening.dispose(); const checkpoint = encodeXtCheckpoint(session.snapshot());
  function remainder(batch: number) {
    const wave = waveform(session.machine.io); let count = 0;
    runUntil(() => !session.keyboard.queuedBytes && !session.keyboard.pasteRemaining && !session.machine.io.speakerData
      && waitingForKey(session.machine), () => {
      session.step(); if (++count % batch === 0) wave.drain();
    });
    wave.drain(); wave.dispose(); expectLastRows(session.machine, " 42", "Ok");
    return { edges: wave.edges, pcm: wave.pcm, state: session.snapshot() };
  }
  const first = remainder(1);
  session.powerOn(); session.restore(decodeXtCheckpoint(checkpoint));
  assert.deepEqual(remainder(137), first);
  const edges = [...opening.edges, ...first.edges], rising = edges.filter(([, high]) => high);
  const periods = rising.slice(1).map(([ticks], i) => ticks - rising[i]![0]);
  for (const frequency of [440, 880]) {
    assert.ok(periods.filter(ticks => Math.abs(xtOscillatorHz / ticks / frequency - 1) < 0.002).length > 150,
      `Missing ${frequency} Hz tone`);
  }
  const duration = (edges.at(-1)![0] - edges[0]![0]) / xtOscillatorHz;
  assert.ok(duration > 0.9 && duration < 1.1, `Two nine-tick tones lasted ${duration} s`);
  assert.equal(session.machine.io.speakerData, false, "BASIC disables the speaker after SOUND");
  assert.ok(first.pcm.some(sample => sample !== 0));
  session.restore(prompt); const beep = waveform(session.machine.io);
  session.keyboard.paste("BEEP:PRINT 42\n");
  runUntil(() => !session.keyboard.queuedBytes && !session.keyboard.pasteRemaining && !session.machine.io.speakerData
    && waitingForKey(session.machine), () => {
    session.step(); beep.drain();
  });
  beep.dispose(); expectLastRows(session.machine, " 42", "Ok");
  assert.ok(beep.edges.length > 100); assert.equal(session.machine.io.speakerData, false);
});
