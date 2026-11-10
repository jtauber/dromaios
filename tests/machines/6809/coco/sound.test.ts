import assert from "node:assert/strict";
import { test } from "node:test";
import { CocoPias } from "../../../../src/machines/6809/coco/pias.js";
import { create6809Coco } from "../../../../src/machines/generated/6809/coco.js";
import { stepCoco } from "../../../../src/machines/6809/coco/runtime.js";
import { createSpeakerSamples } from "../../../../site/interactive/speaker-samples.js";

function configure(io: CocoPias): void {
  io.write(0x20, 0xfc); // PA7–PA2: DAC outputs; PA1–PA0 remain inputs.
  io.write(0x22, 2); // PB1: independent one-bit output, initially low.
  io.write(0x21, 4); io.write(0x23, 0x3c); // Data registers; sound enable high.
  io.write(1, 0x34); io.write(3, 0x34); // Both mux selectors low: DAC.
}

test("CoCo sound resolves all DAC bits, selectors, enable and the independent one-bit path", () => {
  const io = new CocoPias(); configure(io);
  for (let value = 0; value < 64; value++) {
    for (const lowBits of [0, 3]) {
      io.write(0x3c, value * 4 + lowBits); // Mirrored FF3C; PA1–PA0 do not affect the DAC.
      assert.equal(io.soundLevel, value / 126);
    }
  }
  for (const enable of [0x34, 0x3c]) for (const sel1 of [0x34, 0x3c]) for (const sel2 of [0x34, 0x3c]) {
    io.write(1, sel1); io.write(3, sel2); io.write(0x23, enable);
    const dac = enable === 0x3c && sel1 === 0x34 && sel2 === 0x34 ? 63 : 0;
    for (const bit of [0, 2]) {
      io.write(0x22, bit);
      assert.equal(io.soundLevel, (dac + (bit ? 63 : 0)) / 126);
    }
  }
});

test("sound respects port directions and observing or restoring it cannot acknowledge PIA edges", () => {
  const io = new CocoPias(); configure(io);
  io.write(0x20, 0x80); assert.equal(io.soundLevel, 32 / 126);
  io.write(0x21, 0); io.write(0x20, 0x80); // Only PA7 driven: other DAC pins released high.
  assert.equal(io.soundLevel, 63 / 126);
  io.write(0x21, 4); io.write(0x20, 0); assert.equal(io.soundLevel, 31 / 126);
  io.write(0x23, 0x38); io.write(0x22, 0); io.write(0x23, 0x3c); // PB1 released high.
  const level = io.soundLevel; io.write(0x22, 2); assert.equal(io.soundLevel, level);
  io.write(1, 0x35); io.write(0x23, 0x3d);
  io.setHorizontalSync(false); io.setCartridgeLine(false);
  const before = io.snapshot();
  assert.equal(io.irq, true); assert.equal(io.firq, true);
  assert.equal(io.soundLevel, 94 / 126);
  assert.equal(new CocoPias(before).soundLevel, io.soundLevel);
  assert.deepEqual(io.snapshot(), before);
});

test("a 6809 DAC loop produces clocked amplitudes independent of sampling batches and restores mid-wave", () => {
  const initial = create6809Coco({ firmware: null, extended: null });
  configure(initial.pias);
  // LDA #$00; STA $FF20; LDA #$80; STA $FF20; LDA #$FC; STA $FF20; BRA $0200.
  [0x86, 0, 0xb7, 0xff, 0x20, 0x86, 0x80, 0xb7, 0xff, 0x20, 0x86, 0xfc, 0xb7, 0xff, 0x20, 0x20, 0xef]
    .forEach((byte, i) => initial.ram.write(0x200 + i, byte));
  const state = initial.snapshot();
  const start = { ...state, cpu: { ...state.cpu, pc: 0x200 } };
  function run(batch: number) {
    const machine = create6809Coco({ firmware: null, extended: null }, start);
    const signal = createSpeakerSamples(machine.clock.hertz!, 48000, 0, machine.pias.soundLevel);
    const edges: [number, number][] = [], samples: number[] = [];
    let level = machine.pias.soundLevel;
    for (let i = 0; i < 700; i++) {
      stepCoco(machine);
      const next = machine.pias.soundLevel;
      if (next !== level) edges.push([machine.clock.ticks, next]);
      level = next; signal.advance(machine.clock.ticks, level);
      if (i % batch === 0) samples.push(...signal.take());
    }
    samples.push(...signal.take());
    return { edges, samples, state: machine.snapshot() };
  }
  const first = run(1);
  assert.deepEqual(first.edges.slice(0, 5), [[14, 32 / 126], [21, 0.5], [31, 0], [38, 32 / 126], [45, 0.5]]);
  assert.equal(first.state.clock.ticks, 2400); // 3*(LDA immediate 2 + STA extended 5) + BRA 3 per cycle.
  assert.deepEqual(run(83), first);
  const machine = create6809Coco({ firmware: null, extended: null }, start);
  for (let i = 0; i < 4; i++) stepCoco(machine);
  const restored = create6809Coco({ firmware: null, extended: null }, machine.snapshot());
  assert.equal(restored.pias.soundLevel, 32 / 126);
  for (let i = 0; i < 50; i++) {
    assert.deepEqual(stepCoco(restored), stepCoco(machine));
    assert.equal(restored.pias.soundLevel, machine.pias.soundLevel);
  }
  assert.deepEqual(restored.snapshot(), machine.snapshot());
  const before = machine.pias.soundLevel; machine.reset(); assert.equal(machine.pias.soundLevel, before);
});
