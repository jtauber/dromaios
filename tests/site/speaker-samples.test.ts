import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpeakerSamples, createSpeakerPlayback } from "../../site/interactive/speaker-samples.js";

test("sample averages preserve sub-sample edges and phase across drains and instruction boundaries", () => {
  const signal = createSpeakerSamples(1000, 100, 0, 0);
  signal.advance(3, 1); signal.advance(9, 0); signal.advance(10, 0);
  assert.ok(Math.abs(signal.take()[0]! - 0.6) < 1e-7);
  signal.advance(25, 1); signal.advance(30, 1);
  assert.deepEqual([...signal.take()], [0, 0.5]);
  assert.deepEqual([...signal.take()], []);
  const sameBoundary = createSpeakerSamples(1000, 100, 0, 0);
  sameBoundary.advance(0, 1); sameBoundary.advance(0, 0); sameBoundary.advance(20, 0);
  assert.deepEqual([...sameBoundary.take()], [0, 0], "Zero-duration pulses have no area");
});

test("regular 1 kHz transitions render the same wave at either sample rate and any drain cadence", () => {
  for (const sampleRate of [44100, 48000]) {
    function render(drainEvery: number) {
      const signal = createSpeakerSamples(1_000_000, sampleRate, 0, 0), result: number[] = [];
      for (let edge = 1; edge <= 200; edge++) {
        signal.advance(edge * 500, edge % 2);
        if (edge % drainEvery === 0) result.push(...signal.take());
      }
      result.push(...signal.take()); return result;
    }
    const expected = render(200);
    assert.equal(expected.length, sampleRate / 10);
    assert.deepEqual(render(1), expected); assert.deepEqual(render(17), expected);
    assert.equal(expected.filter((value, index) => value >= 0.5 && (expected[index - 1] ?? 0) < 0.5).length, 100);
    const average = expected.reduce((sum, value) => sum + value, 0) / expected.length;
    assert.ok(Math.abs(average - 0.5) < 1e-6);
  }
});

test("paused, muted, Unlimited and restored playback discard history and begin without a fabricated edge", () => {
  const played: number[][] = []; let silences = 0;
  const player = createSpeakerPlayback({ sampleRate: 100, play: samples => played.push([...samples]), silence: () => { silences++; } }, 1000);
  const clock = { ticks: 0 };
  player.sync(clock, 1, true); // Starting high is silent until an actual change.
  clock.ticks = 10; player.observe(10, 0); player.sync(clock, 0, true);
  assert.deepEqual(played, [[0]]);
  clock.ticks = 20; player.observe(20, 0); player.sync(clock, 0, true);
  assert.deepEqual(played.at(-1), [-1]);
  for (let mode = 0; mode < 3; mode++) {
    clock.ticks += 5; player.observe(clock.ticks, 1);
    player.sync(clock, 1, false); assert.equal(silences, mode + 1);
    clock.ticks += 100000; player.observe(clock.ticks, 0); // No buffering while inaudible.
    const count = played.length;
    player.sync(clock, 0, true); assert.equal(played.length, count);
    clock.ticks += 10; player.observe(clock.ticks, 0); player.sync(clock, 0, true);
    assert.deepEqual(played.at(-1), [0]);
  }
  const restored = { ticks: 12 };
  player.sync(restored, 1, true); assert.equal(silences, 4);
  restored.ticks = 22; player.observe(22, 1); player.sync(restored, 1, true);
  assert.deepEqual(played.at(-1), [0]);
  player.stop(); assert.equal(silences, 5);
});

test("invalid timing and undrained samples cannot grow the sound buffer indefinitely", () => {
  for (const hertz of [0, -1, Infinity, NaN]) assert.throws(() => createSpeakerSamples(hertz, 48000, 0, 0));
  const signal = createSpeakerSamples(1000, 100, 0, 0);
  for (const ticks of [-1, Infinity, NaN, 1.5, 100000]) assert.throws(() => signal.advance(ticks, 0));
  signal.advance(10, 0); assert.deepEqual([...signal.take()], [0]);
});

test("DAC amplitudes are averaged, not reduced to Boolean edges, and rejected values preserve the sampler", () => {
  const signal = createSpeakerSamples(1000, 100, 0, 0.25);
  signal.advance(2, 0.5); signal.advance(6, 1); signal.advance(10, 0.25);
  assert.ok(Math.abs(signal.take()[0]! - 0.4) < 1e-7); // (2*0 + 4*.25 + 4*.75) / 10
  for (const level of [-1, 1.01, NaN, Infinity]) {
    assert.throws(() => createSpeakerSamples(1000, 100, 0, level), /level/);
    assert.throws(() => signal.advance(20, level), /level/);
  }
  signal.advance(20, 0.25); assert.deepEqual([...signal.take()], [0]);
  for (const ticks of [-1, 0.5, NaN, Infinity]) assert.throws(() => createSpeakerSamples(1000, 100, ticks, 0));
});
