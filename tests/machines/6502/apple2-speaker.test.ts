import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create6502Apple2, romImages } from "../../../src/machines/generated/6502/apple2.js";
import { createApple2Session } from "../../../site/interactive/apple2-session.js";
import { readApple2Rom } from "../../../site/interactive/apple2-media.js";
import { editApple2Register } from "../../../site/interactive/apple2-register-edit.js";
import { createSpeakerSamples } from "../../../site/interactive/speaker-samples.js";

test("a software delay loop toggles every 1023 CPU clocks and renders a 500 Hz tone regardless of batching", () => {
  function run(batchSize: number) {
    const machine = create6502Apple2({ firmware: null });
    // BIT $C030; LDX #203; DEX; BNE $0205; JMP $0200.
    // Between toggles: 2 + 203*2 + 202*3 + 2 + 3 + 4 = 1023 clocks.
    [0x2c, 0x30, 0xc0, 0xa2, 203, 0xca, 0xd0, 0xfd, 0x4c, 0, 2]
      .forEach((byte, index) => machine.ram.write(0x200 + index, byte));
    editApple2Register(machine, "pc", "0200");
    const signal = createSpeakerSamples(machine.clock.hertz!, 48000, 0, 0), edges: number[] = [], samples: number[] = [];
    let level = false, instructions = 0;
    while (edges.length < 100) {
      assert.ok(instructions < 50000); machine.step(); instructions++;
      const next = machine.speaker.level();
      if (next !== level) edges.push(machine.clock.ticks);
      level = next; signal.advance(machine.clock.ticks, Number(level));
      if (instructions % batchSize === 0) samples.push(...signal.take());
    }
    samples.push(...signal.take());
    return { state: machine.snapshot(), samples, edges };
  }
  const single = run(1);
  assert.deepEqual(single.edges, Array.from({ length: 100 }, (_, index) => 4 + index * 1023));
  assert.equal(1_023_000 / (2 * (single.edges[1]! - single.edges[0]!)), 500);
  assert.equal(single.samples.filter((sample, i) => sample >= 0.5 && (single.samples[i - 1] ?? 0) < 0.5).length, 50);
  assert.deepEqual(run(137), single); assert.deepEqual(run(10000), single);
});

test("CPU reads, writes, and RMW toggle the mapped speaker; reset and restoration preserve its latch", () => {
  const machine = create6502Apple2({ firmware: null });
  [0xad, 0x3f, 0xc0, 0x8d, 0x30, 0xc0, 0xee, 0x31, 0xc0].forEach((byte, i) => machine.ram.write(0x200 + i, byte));
  editApple2Register(machine, "pc", "0200");
  machine.step(); assert.equal(machine.speaker.level(), true);
  const saved = machine.snapshot(), restored = create6502Apple2({ firmware: null }, saved);
  assert.equal(restored.speaker.level(), true); assert.equal(restored.clock.ticks, 4);
  machine.step(); assert.equal(machine.speaker.level(), false);
  const modified = machine.step();
  assert.deepEqual(modified.accesses.filter(access => access.address === 0xc031).map(access => access.kind), ["read", "write", "write"]);
  assert.equal(machine.speaker.level(), true);
  machine.reset(); assert.equal(machine.speaker.level(), true);
  assert.deepEqual(saved.speaker, { level: true });
  assert.equal(create6502Apple2({ firmware: null }).speaker.level(), false);
});

test("the verified Monitor bell produces 192 clocked speaker edges and replays exactly from a checkpoint", {
  skip: process.env.APPLE2_ROM === undefined ? "Set APPLE2_ROM to the caller-supplied Apple II Plus ROM" : false,
}, async () => {
  const bytes = new Uint8Array(readFileSync(process.env.APPLE2_ROM!));
  const chapter = readFileSync("src/machines/6502/apple2.md", "utf8"), media = JSON.parse(chapter.match(/```json\n([\s\S]*?)```/)![1]!);
  const rom = await readApple2Rom({ name: "apple2p.rom", size: bytes.length, async arrayBuffer() { return bytes.buffer; } }, romImages.firmware, media);
  const session = createApple2Session(rom.image);
  // JSR the actual BELL2 routine; its LDY #$C0 controls 192 iterations, not a host sound effect.
  [0x20, 0xdd, 0xfb].forEach((byte, i) => session.machine.ram.write(0x200 + i, byte));
  editApple2Register(session.machine, "pc", "0200");
  assert.deepEqual(Array.from({ length: 14 }, (_, i) => session.machine.firmware.read(0x2be2 + i)),
    [0xa0, 0xc0, 0xa9, 0x0c, 0x20, 0xa8, 0xfc, 0xad, 0x30, 0xc0, 0x88, 0xd0, 0xf5, 0x60]);
  const saved = session.snapshot();
  function bell(batch: number) {
    const signal = createSpeakerSamples(session.machine.clock.hertz!, 48000, session.machine.clock.ticks, Number(session.machine.speaker.level()));
    const edges: number[] = [], samples: number[] = []; let level = session.machine.speaker.level(), count = 0;
    while (session.machine.cpu.snapshot().pc !== 0x203) {
      assert.ok(count++ < 100000); session.step();
      const next = session.machine.speaker.level();
      if (next !== level) edges.push(session.machine.clock.ticks);
      level = next; signal.advance(session.machine.clock.ticks, Number(level));
      if (count % batch === 0) samples.push(...signal.take());
    }
    samples.push(...signal.take()); return { edges, samples, state: session.snapshot() };
  }
  const first = bell(1); assert.equal(first.edges.length, 192);
  assert.equal(new Set(first.edges.slice(1).map((tick, i) => tick - first.edges[i]!)).size, 1);
  assert.ok(first.samples.some(sample => sample !== 0));
  session.restore(saved); assert.deepEqual(bell(113), first);
});
