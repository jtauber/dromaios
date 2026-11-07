/** Browser transport only: bounded queued audio, a modest gain, and removal of the held DC level. */
export function createSpeakerAudioOutput(context: AudioContext) {
  const filter = context.createBiquadFilter(), volume = context.createGain();
  filter.type = "highpass"; filter.frequency.value = 80;
  volume.gain.value = 0.12;
  filter.connect(volume); volume.connect(context.destination);
  const pending = new Set<AudioBufferSourceNode>();
  let end = 0;
  function silence(): void {
    for (const source of pending) { source.stop(); source.disconnect(); }
    pending.clear(); end = 0;
    volume.gain.value = 0;
  }
  return {
    sampleRate: context.sampleRate,
    silence,
    play(samples: Float32Array): void {
      if (!samples.length) return;
      samples = samples.subarray(-Math.max(1, Math.floor(context.sampleRate * 0.1)));
      // Resume after an underrun with a small lead. Never accumulate a growing backlog.
      if (end + samples.length / context.sampleRate - context.currentTime > 0.12) silence();
      const start = end > context.currentTime ? end : context.currentTime + 0.02;
      const buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(filter);
      source.onended = () => { pending.delete(source); source.disconnect(); };
      volume.gain.value = 0.12;
      source.start(start); pending.add(source); end = start + buffer.duration;
    },
  };
}
