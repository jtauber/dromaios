function checkLevel(level: number): void {
  if (!Number.isFinite(level) || level < 0 || level > 1) throw new RangeError("Speaker level must be between zero and one.");
}

/** Average a held amplitude (0–1) over each audio sample; batching never changes the waveform. */
export function createSpeakerSamples(hertz: number, sampleRate: number, ticks: number, level: number) {
  if (!Number.isFinite(hertz) || hertz <= 0 || !Number.isSafeInteger(sampleRate) || sampleRate < 1) {
    throw new RangeError("Speaker sampling requires positive CPU and audio rates.");
  }
  if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError("Speaker clocks must be non-negative integers.");
  checkLevel(level);
  const period = hertz / sampleRate, origin = ticks, baseline = level;
  const samples: number[] = [];
  let previous = ticks, value = 0, frames = 0, area = 0;
  return {
    advance(ticks: number, level: number): void {
      checkLevel(level);
      if (!Number.isSafeInteger(ticks) || ticks < previous) throw new RangeError("Speaker clocks must advance monotonically.");
      if ((ticks - origin) / period - frames + samples.length > sampleRate / 4) {
        throw new RangeError("Speaker samples must be drained within a quarter second of emulated time.");
      }
      while (previous < ticks) {
        const end = origin + (frames + 1) * period;
        const next = Math.min(ticks, end);
        area += (next - previous) * value;
        previous = next;
        if (next === end) { samples.push(area / period); frames++; area = 0; }
      }
      value = level - baseline;
    },
    take(): Float32Array { const result = Float32Array.from(samples); samples.length = 0; return result; },
  };
}

export interface SpeakerOutput {
  readonly sampleRate: number;
  play(samples: Float32Array): void;
  silence(): void;
}

/** A playback epoch belongs to one clock and one uninterrupted audible Run. */
export function createSpeakerPlayback(output: SpeakerOutput, hertz: number) {
  let identity: { readonly ticks: number } | undefined;
  let samples: ReturnType<typeof createSpeakerSamples> | undefined;
  return {
    observe(ticks: number, level: number): void { samples?.advance(ticks, level); },
    sync(clock: { readonly ticks: number }, level: number, audible: boolean): void {
      if (!audible || identity !== clock) {
        if (samples) output.silence();
        samples = undefined; identity = clock;
      }
      if (!audible) return;
      if (!samples) samples = createSpeakerSamples(hertz, output.sampleRate, clock.ticks, level);
      const buffer = samples.take();
      if (buffer.length) output.play(buffer);
    },
    stop(): void { output.silence(); samples = undefined; identity = undefined; },
  };
}
