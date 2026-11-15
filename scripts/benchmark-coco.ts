import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cpus } from "node:os";
import { RomImage } from "../src/machines/rom-image.js";
import { romImages } from "../src/machines/generated/6809/coco-disk.js";
import { createCocoSession } from "../site/interactive/coco-session.js";
import { compileCpuChapter } from "../src/components/cpus/semantics/literate/compile.js";
import { instructionCatalogue6809 } from "../site/6809-instruction-catalogue.js";
import { renderCocoFrame } from "../src/machines/6809/coco/runtime.js";
import { createCocoDebugger, observeCocoBoundary } from "../site/interactive/coco-debugger.js";
import { createCocoChangeLog } from "../site/interactive/coco-change-log.js";
import { createCocoWatchHistory } from "../site/interactive/coco-watch-history.js";
import { readCocoStorage } from "../site/interactive/coco-inspection.js";
import { previewCocoInstruction } from "../site/interactive/coco-instruction-preview.js";
import { captureMemory } from "../site/interactive/memory-window.js";
import { createSpeakerSamples } from "../site/interactive/speaker-samples.js";

// Build first, then supply the acceptance checkpoints and verified local ROM paths.
// This measures native work, not DOM layout, browser scheduling or audio-device output.
const directory = process.argv[2];
if (!directory) throw new Error("Usage: node dist/scripts/benchmark-coco.js CHECKPOINT_DIRECTORY [REPETITIONS]");
const repetitions = Number(process.argv[3] ?? 3), boundaries = 500_000, batchSize = 5_000;
if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 20) throw new Error("Use 1–20 repetitions.");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const catalogue6809 = instructionCatalogue6809(compileCpuChapter(readFileSync("src/components/cpus/specifications/6809.md", "utf8")));
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, boundaries, batchSize, repetitions }));
async function rom(path: string | undefined, identity: { readonly size: number; readonly sha256: string }) {
  if (!path) throw new Error("Set COCO_ROM, COCO_EXTENDED_ROM and COCO_DISK_ROM to verified local ROMs.");
  return RomImage.verify(readFileSync(path), identity, async bytes => createHash("sha256").update(bytes).digest("hex"));
}
const firmware = await rom(process.env.COCO_ROM, romImages.firmware);
const extended = await rom(process.env.COCO_EXTENDED_ROM, romImages.extended);
const dos = await rom(process.env.COCO_DISK_ROM, romImages.dos);

for (const workload of ["fahrfall", "brickaway"] as const) {
  const session = createCocoSession(firmware, extended, workload === "fahrfall" ? dos : null);
  const initial: unknown = JSON.parse(readFileSync(join(directory, `${workload}.json`), "utf8"));
  let expected: string | undefined, expectedAudio: string | undefined;
  const modes = ["machine", "debugger", "recording", "sound", "inspection"] as const;
  const timings = new Map<string, number[]>();
  // Warm the common execution path before timing; each sample still restores its exact start.
  session.restore(initial);
  for (let i = 0; i < 20_000; i++) session.step();
  for (let repeat = 0; repeat < repetitions; repeat++) {
    for (const mode of repeat % 2 ? [...modes].reverse() : modes) {
      session.restore(initial);
      const debug = createCocoDebugger(() => session.machine, catalogue6809);
      const log = createCocoChangeLog(session.machine), watches = createCocoWatchHistory();
      log.recording = mode !== "debugger";
      if (mode === "machine") log.dispose(); // No RAM observer in the machine-only measurement.
      const clock = session.machine.clock, startTicks = clock.ticks;
      const sampler = mode === "sound" || mode === "inspection"
        ? createSpeakerSamples(clock.hertz!, 48_000, clock.ticks, session.machine.pias.soundLevel) : undefined;
      const audio = createHash("sha256");
      const drain = () => { if (sampler) audio.update(new Uint8Array(sampler.take().buffer)); };
      debug.run();
      let cpuState = session.machine.cpu.snapshot();
      let inspectionMs = 0;
      const start = performance.now();
      try {
        for (let i = 0; i < boundaries; i++) {
          if (mode === "machine") session.step();
          else {
            assert.equal(debug.beforeStep(observeCocoBoundary(session.machine, cpuState).caller), false);
            const observed = observeCocoBoundary(session.machine, cpuState);
            const record = log.capture(() => debug.capture(() => session.step(), observed.caller), observed);
            cpuState = record.after;
            watches.observe(record, observed.caller, debug.watchpoints, log.memoryWrites(record));
          }
          sampler?.advance(clock.ticks, session.machine.pias.soundLevel);
          if ((i + 1) % batchSize === 0) {
            drain();
            if (mode === "inspection") {
              const start = performance.now();
              captureMemory(address => readCocoStorage(session.machine, address));
              previewCocoInstruction(session.machine, catalogue6809);
              renderCocoFrame(session.machine, "composite");
              inspectionMs += performance.now() - start;
            }
          }
        }
        const elapsedMs = performance.now() - start;
        drain();
        const state = digest(session.snapshot()), frame = digest(renderCocoFrame(session.machine, "composite"));
        const result = state + frame;
        expected ??= result;
        assert.equal(result, expected, `${workload}/${mode}: observations changed hardware or pixels`);
        const pcm = sampler ? audio.digest("hex") : undefined;
        if (pcm !== undefined) {
          expectedAudio ??= pcm;
          assert.equal(pcm, expectedAudio, `${workload}/${mode}: observations changed PCM samples`);
        }
        const samples = timings.get(mode) ?? []; samples.push(elapsedMs); timings.set(mode, samples);
        console.log(JSON.stringify({ workload, mode, repeat: repeat + 1, elapsedMs, inspectionMs,
          ticks: clock.ticks - startTicks, state, frame, pcm }));
      } finally { debug.dispose(); log.dispose(); }
    }
  }
  console.table([...timings].map(([mode, samples]) => {
    const sorted = [...samples].sort((a, b) => a - b);
    const median = (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2;
    return { workload, mode, medianMs: median.toFixed(1) };
  }));
}
