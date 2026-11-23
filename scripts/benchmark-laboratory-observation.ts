import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cpus } from "node:os";
import { RomImage } from "../src/machines/rom-image.js";
import { romImages as appleRoms } from "../src/machines/generated/6502/apple2.js";
import { romImages as xtRoms } from "../src/machines/generated/8088/pc-xt.js";
import { compileCpuChapter } from "../src/components/cpus/semantics/literate/compile.js";
import { parseMachine } from "../src/machines/machine-language.js";
import { machineChapterSource } from "../src/machines/machine-chapter.js";
import { instructionCatalogue6502 } from "../site/6502-instruction-catalogue.js";
import { xtStorageRegions } from "../site/xt-storage-regions.js";
import { readApple2Rom } from "../site/interactive/apple2-media.js";
import type { Apple2Media } from "../site/interactive/apple2-media.js";
import { prepareApple2SavedState } from "../site/interactive/apple2-saved-state.js";
import { apple2Input, createApple2Session } from "../site/interactive/apple2-session.js";
import { apple2DebugLocation, apple2DebugStep, observeApple2Boundary } from "../site/interactive/apple2-debugger.js";
import { createInstructionDebugger } from "../site/interactive/instruction-debugger.js";
import { createApple2ChangeLog } from "../site/interactive/apple2-change-log.js";
import { apple2HiresFrame, apple2TextFrame } from "../site/interactive/apple2-screen.js";
import { createSpeakerSamples } from "../site/interactive/speaker-samples.js";
import { createXtSession } from "../site/interactive/xt-session.js";
import { createXtDebugger, observeXtBoundary } from "../site/interactive/xt-debugger.js";
import { createXtChangeLog, createXtWatchHistory } from "../site/interactive/xt-history.js";
import { renderXtGraphicsFrame } from "../src/machines/8088/pc-xt/video.js";

// Native observation costs only: no DOM, host pacing, layout or audio-device output.
const [directory, count = "3", strategy = "captured"] = process.argv.slice(2), repetitions = Number(count);
if (!directory || !Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 20 || !["fresh", "captured"].includes(strategy)) {
  throw new Error("Usage: node dist/scripts/benchmark-laboratory-observation.js CHECKPOINT_DIRECTORY [REPETITIONS] [fresh|captured]");
}
// The fresh strategy reproduces the former observers' snapshot requests for paired measurements.
const reuse = strategy === "captured";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const modes = ["machine", "debugger", "recording", "run-to"] as const;
type Mode = typeof modes[number];
interface Probe {
  step(): void;
  output(): unknown;
  result(): { readonly state: unknown; readonly ticks: number; readonly history: unknown; readonly pcm?: string };
  dispose(): void;
}

function measure(workload: string, boundaries: number, restore: (mode: Mode) => Probe): void {
  const warm = restore("recording");
  try { for (let i = 0; i < 20_000; i++) warm.step(); } finally { warm.dispose(); }
  let expected: string | undefined;
  const histories = new Map<Mode, string>(), timings = new Map<Mode, number[]>();
  for (let repeat = 1; repeat <= repetitions; repeat++) for (const mode of repeat % 2 ? modes : [...modes].reverse()) {
    const probe = restore(mode), frames = createHash("sha256");
    const start = performance.now();
    try {
      for (let i = 0; i < boundaries; i++) {
        probe.step();
        if ((i + 1) % 10_000 === 0) frames.update(JSON.stringify(probe.output()));
      }
      frames.update(JSON.stringify(probe.output()));
      const elapsedMs = performance.now() - start;
      const result = probe.result(), state = digest(result.state), output = frames.digest("hex"), history = digest(result.history);
      const outcome = JSON.stringify([state, output, result.ticks, result.pcm]);
      expected ??= outcome;
      assert.equal(outcome, expected, `${workload}/${mode}: observers changed state or output`);
      if (histories.has(mode)) assert.equal(history, histories.get(mode), "History must replay identically");
      histories.set(mode, history);
      const samples = timings.get(mode) ?? []; samples.push(elapsedMs); timings.set(mode, samples);
      console.log(JSON.stringify({ workload, strategy, mode, repeat, boundaries, elapsedMs, ticks: result.ticks, state, output, history, pcm: result.pcm }));
    } finally { probe.dispose(); }
  }
  console.table([...timings].map(([mode, samples]) => {
    const sorted = [...samples].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return { workload, mode, medianMs: ((sorted[middle]! + sorted[Math.floor((sorted.length - 1) / 2)]!) / 2).toFixed(1) };
  }));
}

console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, repetitions, strategy }));
const appleChapter = readFileSync("src/machines/6502/apple2.md", "utf8");
const media: Apple2Media = JSON.parse(appleChapter.match(/^```json\n([\s\S]*?)^```$/m)![1]!);
const romPath = process.env.APPLE2_ROM;
assert.ok(romPath, "Set APPLE2_ROM to the verified Apple II ROM container");
const bytes = new Uint8Array(readFileSync(romPath));
const rom = await readApple2Rom({ name: romPath, size: bytes.length, async arrayBuffer() { return bytes.buffer; } }, appleRoms.firmware, media);
const instructions = instructionCatalogue6502(Object.values(compileCpuChapter(readFileSync("src/components/cpus/specifications/6502.md", "utf8")).families).flat());
for (const [scene, command, boundaries] of [["title", "G", 2_000_000], ["yard", "GO STAIRS", 224_100]] as const) {
  const prepared = await prepareApple2SavedState(json(join(directory, "mystery-house", `${scene}.json`)), rom.image, media);
  const initial = prepared.session.snapshot();
  measure(`mystery-house/${scene}`, boundaries, mode => {
    const session = createApple2Session(rom.image); session.restore(initial); session.send(apple2Input(command + "\n"));
    const machine = session.machine, log = createApple2ChangeLog(machine), debug = createInstructionDebugger();
    log.recording = mode === "recording" || mode === "run-to";
    if (mode === "machine") log.dispose();
    let cpuState = machine.cpu.snapshot();
    const observe = () => observeApple2Boundary(machine, reuse ? cpuState : undefined);
    const location = () => observe().caller;
    if (mode === "run-to") debug.runTo(location(), 0xffff); else debug.run(location());
    const clock = machine.clock, startTicks = clock.ticks, audio = createHash("sha256");
    const sampler = createSpeakerSamples(clock.hertz!, 48_000, clock.ticks, Number(machine.speaker.level()));
    function drain(): void { audio.update(new Uint8Array(sampler.take().buffer)); }
    return {
      step() {
        if (mode === "machine") session.step();
        else {
          assert.equal(debug.beforeStep(location), false);
          const observed = observe(), record = log.capture(() => session.step(), reuse ? observed : undefined);
          cpuState = record.after;
          debug.observe(apple2DebugStep(record, observed.caller, apple2DebugLocation(machine, record.after.pc), instructions));
        }
        sampler.advance(clock.ticks, Number(machine.speaker.level()));
      },
      output() { drain(); return { text: apple2TextFrame(machine.ram, machine.video, false), pixels: apple2HiresFrame(machine.ram, machine.video) }; },
      result() {
        drain();
        if (scene === "yard") { assert.equal(machine.ram.read(0x852), 2); assert.equal(machine.cpu.snapshot().pc, 0x63df); }
        return { state: session.snapshot(), ticks: clock.ticks - startTicks, pcm: audio.digest("hex"), history: { entries: log.entries(), frames: debug.frames } };
      },
      dispose: log.dispose,
    };
  });
}

async function xtRom(path: string | undefined, identity: { readonly size: number; readonly sha256: string }) {
  assert.ok(path, "Set XT_BIOS_ROM, XT_BASIC_ROM and XT_CGA_ROM");
  return RomImage.verify(readFileSync(path), identity, async bytes => createHash("sha256").update(bytes).digest("hex"));
}
const bios = await xtRom(process.env.XT_BIOS_ROM, xtRoms.bios), basic = await xtRom(process.env.XT_BASIC_ROM, xtRoms.basic);
const font = await xtRom(process.env.XT_CGA_ROM, xtRoms.font);
const xtFile = "src/machines/8088/pc-xt.md", xtSource = readFileSync(xtFile, "utf8");
const board = parseMachine(machineChapterSource(xtSource, xtFile), xtFile);
assert.ok("connection" in board);
const storage = xtStorageRegions(board);
// The headless game acceptance needs no CGA character ROM. Install it normally before saving the lab's starting state.
const prepared = createXtSession({ bios, basic, font: null });
prepared.restore(json(join(directory, "xt", "ultima-v.json"))); prepared.install("font", font);
// The acceptance captures the first visible party names, before the map has finished drawing.
let ready = false;
for (let i = 0; i < 6_000_000; i++) {
  const { after } = prepared.step();
  if (after.cs === 0x0c6f && after.ip === 0x1d6c) { ready = true; break; }
}
assert.ok(ready, "Ultima V must finish its redraw and reach the keyboard poll");
const initial = prepared.snapshot();
measure("ultima-v/cga", 500_000, mode => {
  const session = createXtSession({ bios, basic, font }); session.restore(initial);
  session.keyboard.down("ArrowDown"); session.keyboard.up("ArrowDown");
  const machine = session.machine, startTicks = machine.io.oscillatorTicks;
  const log = createXtChangeLog(machine, storage), debug = createXtDebugger(() => machine), watches = createXtWatchHistory();
  log.recording = mode === "recording" || mode === "run-to";
  if (mode === "machine") log.dispose();
  if (mode === "run-to") debug.runTo({ address: 0xfffff }); else debug.run();
  let cpuState = machine.cpu.snapshot();
  const audio = createHash("sha256");
  const sampler = createSpeakerSamples(machine.io.clock.hertz, 48_000, machine.io.clock.ticks, Number(machine.io.speakerLevel));
  const unobserve = machine.io.observeSpeaker((ticks, level) => sampler.advance(ticks, Number(level)));
  function drain(): void { audio.update(new Uint8Array(sampler.take().buffer)); }
  return {
    step() {
      if (mode === "machine") session.step();
      else {
        assert.equal(debug.beforeStep(() => observeXtBoundary(machine, reuse ? cpuState : undefined).caller), false);
        const observed = reuse && log.recording ? observeXtBoundary(machine, cpuState) : undefined;
        const record = log.capture(() => debug.capture(() => session.step()), observed);
        cpuState = record.after;
        watches.observe(record, log.memoryWrites(record));
      }
      sampler.advance(machine.io.clock.ticks, Number(machine.io.speakerLevel));
    },
    output() { drain(); return renderXtGraphicsFrame(machine); },
    result() {
      drain();
      assert.deepEqual([0x215c3, 0x215c6, 0x215c7].map(address => machine.ram.read(address)), [13, 15, 16]);
      return { state: session.snapshot(), ticks: machine.io.oscillatorTicks - startTicks, history: log.entries(), pcm: audio.digest("hex") };
    },
    dispose() { unobserve(); debug.dispose(); log.dispose(); },
  };
});
