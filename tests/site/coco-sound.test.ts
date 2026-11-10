import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/6809/coco.js";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import { cocoScreenText } from "../../site/interactive/coco-inspection.js";
import { createSpeakerSamples } from "../../site/interactive/speaker-samples.js";

type Session = ReturnType<typeof createCocoSession>;
type Edge = { ticks: number; dac: number; address: number };

async function boot(extended: boolean) {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware, digest);
  const extension = extended ? await RomImage.verify(readFileSync(process.env.COCO_EXTENDED_ROM!), romImages.extended, digest) : null;
  const session = createCocoSession(firmware, extension);
  for (let i = 0; i < 720_000; i++) session.step();
  assert.match(cocoScreenText(session.machine), extended ? /^EXTENDED COLOR BASIC 1\.1/ : /^COLOR BASIC 1\.3/);
  return session;
}

function example(heading: string): string {
  const chapter = readFileSync("src/machines/6809/coco.md", "utf8");
  return chapter.split(`### ${heading}\n`)[1]!.match(/```text\n([^`]+)\n```/)![1]!;
}

function observe(session: Session) {
  const edges: Edge[] = []; let previous = session.machine.pias.soundLevel;
  return { edges, step(): void {
    const record = session.step(), level = session.machine.pias.soundLevel;
    if (level !== previous) {
      // PB1 remains released high in BASIC; its constant 63 is removed here for DAC measurements.
      edges.push({ ticks: session.machine.clock.ticks, dac: Math.round(level * 126) - 63,
        address: record.instruction?.address ?? -1 });
      previous = level;
    }
  } };
}

function finish(session: Session, step: () => void): void {
  for (let i = 0; i < 2_000_000; i++) {
    step();
    if (i % 1000 === 0 && session.inputSettled && cocoScreenText(session.machine).endsWith("\nDONE\nOK\n█")) return;
  }
  assert.fail(`Sound command did not finish: ${cocoScreenText(session.machine)}`);
}

test("Color BASIC SOUND drives the DAC, returns to OK, and replays a mid-note checkpoint at any batch size", {
  skip: !process.env.COCO_ROM && "Set COCO_ROM to Color BASIC 1.3.",
}, async () => {
  const session = await boot(false), wave = observe(session);
  session.send(cocoTextInput(example("Try Color BASIC SOUND") + ':PRINT "DONE"\n'));
  for (let i = 0; i < 1_500_000 && wave.edges.length < 17; i++) wave.step();
  assert.equal(wave.edges.length, 17);
  assert.deepEqual(wave.edges.slice(0, 8).map(edge => edge.dac), [31, 63, 31, 0, 31, 63, 31, 0]);
  assert.ok(wave.edges.every(edge => edge.address === 0xa987), "samples come from the ROM's STA ,X");
  const saved = session.snapshot();
  function remainder(batch: number) {
    const trace = observe(session), clock = session.machine.clock;
    const sampler = createSpeakerSamples(clock.hertz!, 48000, clock.ticks, session.machine.pias.soundLevel);
    const samples: number[] = []; let count = 0;
    finish(session, () => {
      trace.step(); sampler.advance(clock.ticks, session.machine.pias.soundLevel);
      if (++count % batch === 0) samples.push(...sampler.take());
    });
    samples.push(...sampler.take());
    return { edges: trace.edges, samples, state: session.snapshot() };
  }
  const first = remainder(1);
  session.restore(JSON.parse(JSON.stringify(saved))); assert.deepEqual(remainder(137), first);
  const all = [...wave.edges, ...first.edges];
  const peaks = all.filter(edge => edge.dac === 63);
  const periods = peaks.slice(1).map((edge, i) => edge.ticks - peaks[i]!.ticks).sort((a, b) => a - b);
  // Four DAC phases: three 663-clock gaps and one 671-clock loop rollover.
  // The ROM's duration bookkeeping occasionally adds clocks; it is not a host oscillator.
  assert.equal(periods[Math.floor(periods.length / 2)], 2660);
  const duration = (all.at(-1)!.ticks - all[0]!.ticks) / session.machine.clock.hertz!;
  assert.ok(duration > 0.10 && duration < 0.14, `SOUND duration ${duration}`);
  assert.ok(first.samples.some(value => value > 0) && first.samples.some(value => value < 0));
});

test("Extended BASIC PLAY makes a C–E–G phrase, a held-level rest, and a quieter C through the same DAC", {
  skip: !(process.env.COCO_ROM && process.env.COCO_EXTENDED_ROM) && "Set COCO_ROM and COCO_EXTENDED_ROM.",
}, async () => {
  const session = await boot(true), wave = observe(session);
  session.send(cocoTextInput(example("Try Extended BASIC PLAY") + ':PRINT "DONE"\n'));
  finish(session, wave.step);
  const { edges } = wave, hertz = session.machine.clock.hertz!;
  assert.deepEqual([...new Set(edges.map(edge => edge.dac))].sort((a, b) => a - b), [0, 16, 24, 31, 38, 46]);
  assert.ok(edges.slice(0, -1).every(edge => edge.address === 0x9b83), "PLAY samples come from the Extended ROM's STA ,U");
  assert.equal(edges.at(-1)!.dac, 0, "the ROM disables the mux on return");
  const quietStart = edges.findIndex(edge => edge.dac === 38);
  const rest = (edges[quietStart]!.ticks - edges[quietStart - 1]!.ticks) / hertz;
  assert.equal(edges[quietStart - 1]!.dac, 31);
  assert.ok(rest > 0.12 && rest < 0.15, `held-level rest ${rest}`);
  // O3 C/E/G have nominal pitches near 262/330/392 Hz. IRQ service can lengthen
  // a cycle, so compare the frequent unbroken periods rather than a single edge.
  const loud = edges.filter(edge => edge.dac === 46);
  const periods = loud.slice(1).map((edge, i) => edge.ticks - loud[i]!.ticks);
  for (const pitch of [261.63, 329.63, 392]) {
    assert.ok(periods.filter(period => Math.abs(hertz / period / pitch - 1) < 0.01).length > 20, `missing ${pitch} Hz note`);
  }
  const quiet = edges.filter(edge => edge.dac === 38);
  const quietPeriods = quiet.slice(1).map((edge, i) => edge.ticks - quiet[i]!.ticks).sort((a, b) => a - b);
  assert.ok(Math.abs(hertz / quietPeriods[Math.floor(quietPeriods.length / 2)]! / 261.63 - 1) < 0.01);
});
