/// <reference lib="dom" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpeakerAudioOutput } from "../../site/interactive/speaker-audio-output.js";

test("audio buffers stay contiguous, bounded and cancellable, with modest gain and DC removal", () => {
  const sources: { start: number; stopped: boolean; disconnected: boolean; buffer: { duration: number }; onended(): void }[] = [];
  const filter = { type: "", frequency: { value: 0 }, connect() {} };
  const volume = { gain: { value: 0 }, connect() {} };
  const context = {
    sampleRate: 1000, currentTime: 10, destination: {},
    createBiquadFilter: () => filter, createGain: () => volume,
    createBuffer(channels: number, length: number, rate: number) {
      assert.equal(channels, 1); assert.equal(rate, 1000);
      return { duration: length / rate, getChannelData: () => new Float32Array(length) };
    },
    createBufferSource() {
      const state = { start: 0, stopped: false, disconnected: false, buffer: { duration: 0 }, onended() {} };
      sources.push(state);
      return { set buffer(value: { duration: number }) { state.buffer = value; }, connect() {},
        start(time: number) { state.start = time; }, stop() { state.stopped = true; },
        disconnect() { state.disconnected = true; }, set onended(callback: () => void) { state.onended = callback; } };
    },
  };
  const output = createSpeakerAudioOutput(context as unknown as AudioContext);
  output.play(new Float32Array(50)); output.play(new Float32Array(20));
  assert.equal(sources[0]!.start, 10.02); assert.equal(sources[1]!.start, 10.07);
  assert.equal(volume.gain.value, 0.12); assert.equal(filter.type, "highpass"); assert.equal(filter.frequency.value, 80);
  output.play(new Float32Array(500)); // Overproduction drops queued history and retains at most 100 ms.
  assert.ok(sources.slice(0, 2).every(source => source.stopped && source.disconnected));
  assert.equal(sources[2]!.start, 10.02); assert.equal(sources[2]!.buffer.duration, 0.1);
  output.silence(); assert.equal(volume.gain.value, 0);
  assert.ok(sources.every(source => source.stopped && source.disconnected));
  context.currentTime = 1000;
  output.play(new Float32Array(20)); assert.equal(sources.at(-1)!.start, 1000.02);
  sources.at(-1)!.onended(); assert.equal(sources.at(-1)!.disconnected, true);
  output.play(new Float32Array()); assert.equal(sources.length, 4);
});
