import assert from "node:assert/strict";
import { test } from "node:test";
import { create6809Coco } from "../../../../src/machines/generated/6809/coco.js";
import { create6809Coco64 } from "../../../../src/machines/generated/6809/coco64.js";
import { stepCoco, renderCocoFrame } from "../../../../src/machines/6809/coco/runtime.js";
import type { Coco } from "../../../../src/machines/6809/coco/runtime.js";
import { advanceCocoSync, ticksUntilCocoSync } from "../../../../src/machines/6809/coco/timing.js";
import { cocoTestRom } from "./fixture.js";

const empty = { firmware: null, extended: null };

test("address-dependent timing distinguishes transfers, internal cycles, and boundary rate changes", () => {
  const bindings = { ...empty, dos: null };
  const base = create6809Coco64(bindings).snapshot();
  for (const pc of [0x200, 0xa000]) for (const address of [0x4000, 0x8000, 0xff00, 0xff1f, 0xff20, 0xff40]) {
    for (const rate of [0, 1, 2, 3]) {
      const machine = create6809Coco64(bindings, { ...base, sam: { control: 0xc000 | rate << 11 }, cpu: { ...base.cpu, pc } });
      [0xb6, address >> 8, address & 255].forEach((byte, i) => machine.ram.write(pc + i, byte)); // LDA extended: five E cycles.
      const record = stepCoco(machine);
      assert.equal(record.clocks, 5); assert.equal(record.accesses.length, 4);
      const slowFetches = pc < 0x8000 ? 3 : 0;
      const slowData = address < 0x8000 || address >= 0xff00 && address < 0xff20 ? 1 : 0;
      assert.equal(record.elapsedTicks, rate === 0 ? 10 : rate === 1 ? 5 + slowFetches + slowData : 5);
      assert.equal(machine.clock.ticks, record.elapsedTicks);
    }
  }
  const machine = create6809Coco64(bindings, { ...base, cpu: { ...base.cpu, pc: 0x200 } });
  [0xb7, 0xff, 0xd7, 0x12, 0xb7, 0xff, 0xd6, 0x12].forEach((byte, i) => machine.ram.write(0x200 + i, byte));
  assert.equal(stepCoco(machine).elapsedTicks, 10, "STA selects the next boundary's rate");
  assert.equal(stepCoco(machine).elapsedTicks, 3, "RAM NOP: one slow fetch and one fast internal cycle");
  assert.equal(stepCoco(machine).elapsedTicks, 8, "STA has three slow fetches, one fast SAM write, and one internal cycle");
  assert.equal(stepCoco(machine).elapsedTicks, 4, "normal NOP restores two slow cycles");
});

function elapse(machine: Coco, count: number): void {
  const start = machine.clock.ticks;
  machine.clock.advance(count); advanceCocoSync(machine, start);
}

test("address-dependent IRQ entry charges slow stack writes and fast vector/internal cycles; waits preserve board time", () => {
  const base = create6809Coco(empty).snapshot();
  const machine = create6809Coco(empty, { ...base, sam: { control: 0x0800 }, cpu: {
    ...base.cpu, pc: 0x200, s: 0x7000, flags: { ...base.cpu.flags, i: false },
  } });
  machine.pias.write(1, 5); machine.pias.setHorizontalSync(false);
  const record = stepCoco(machine);
  assert.equal(record.outcome, "accepted"); assert.equal(record.clocks, 19);
  assert.equal(record.accesses.length, 14); assert.equal(record.elapsedTicks, 31);
  for (const rate of [0, 1, 3]) {
    const waiting = create6809Coco(empty, { ...base, sam: { control: rate << 11 }, cpu: { ...base.cpu, waitMode: "sync" } });
    const before = waiting.snapshot(), next = stepCoco(waiting);
    assert.equal(next.clocks, 0); assert.equal(next.elapsedTicks, 106); assert.equal(next.idleTicks, 106);
    assert.deepEqual(next.accesses, []);
    const restored = create6809Coco(empty, before);
    assert.deepEqual(stepCoco(restored), next); assert.deepEqual(restored.snapshot(), waiting.snapshot());
  }
});

test("NTSC HS/FS edges reach the PIA at independently calculated board-tick boundaries", () => {
  const machine = create6809Coco(empty);
  assert.equal(machine.clock.hertz, 14_318_180 / 8);
  const hs: [number, boolean][] = [], fs: [number, boolean][] = [];
  const horizontal = machine.pias.setHorizontalSync.bind(machine.pias), field = machine.pias.setFieldSync.bind(machine.pias);
  machine.pias.setHorizontalSync = high => { hs.push([machine.clock.ticks, high]); horizontal(high); };
  machine.pias.setFieldSync = high => { fs.push([machine.clock.ticks, high]); field(high); };
  for (let tick = 0; tick < 2 * 29_868; tick++) elapse(machine, 1);
  assert.deepEqual(hs, Array.from({ length: 524 }, (_, line) => [[line * 114 + 106, false], [line * 114 + 114, true]]).flat());
  assert.deepEqual(fs, [[26_212, false], [29_860, true], [56_080, false], [59_728, true]]);
  assert.equal(machine.pias.irq, false, "disabled edges still latch without requesting IRQ");
  assert.equal(machine.pias.read(3) & 0x80, 0x80);
  machine.pias.write(3, 5); assert.equal(machine.pias.irq, true, "enable the already pending falling edge");
  machine.pias.read(3); assert.equal(machine.pias.irq, true, "control read preserves it");
  machine.pias.read(2); assert.equal(machine.pias.irq, false, "data read acknowledges");
});

test("a single interval retains short pulses, repeated fields, and safe-integer clock phase", () => {
  for (const rising of [false, true]) {
    const machine = create6809Coco(empty);
    machine.pias.write(1, rising ? 7 : 5);
    elapse(machine, 120); assert.equal(machine.pias.irq, true);
    machine.pias.read(0); assert.equal(machine.pias.irq, false);
    elapse(machine, 3 * 29_868); assert.equal(machine.pias.irq, true);
  }
  const base = create6809Coco(empty).snapshot();
  const nearLimit = Number.MAX_SAFE_INTEGER - 100;
  const large = create6809Coco(empty, { ...base, clock: { ticks: nearLimit } });
  const small = create6809Coco(empty, { ...base, clock: { ticks: nearLimit % 29_868 } });
  assert.equal(ticksUntilCocoSync(large), ticksUntilCocoSync(small));
  elapse(large, 80); elapse(small, 80);
  assert.deepEqual(large.pias.snapshot(), small.pias.snapshot());
});

test("waiting advances time without fetches; masked IRQ wakes SYNC but not CWAI", () => {
  for (const waitMode of ["sync", "cwai"] as const) {
    const base = create6809Coco(empty).snapshot();
    const machine = create6809Coco(empty, { ...base, cpu: { ...base.cpu, waitMode, pc: 0x200, s: 0x7000 } });
    machine.pias.write(1, 5);
    machine.memory.read = () => { throw new Error("A waiting CPU must not fetch"); };
    const waiting = stepCoco(machine);
    assert.equal(waiting.instruction, null); assert.equal(waiting.clocks, 0); assert.equal(waiting.idleTicks, 106);
    assert.equal(machine.clock.ticks, 106); assert.equal(machine.pias.irq, true);
    const next = stepCoco(machine);
    assert.equal(next.outcome, waitMode === "sync" ? "resumed" : "waiting");
    assert.equal(next.clocks, 0); assert.equal(next.idleTicks, waitMode === "sync" ? 0 : 8);
    assert.equal(next.after.pc, 0x200);
  }
});

test("a field-interrupt screen counter survives waits and checkpoints with identical batch/render schedules", async t => {
  const bytes = new Uint8Array(0x2000).fill(0x12);
  const initialization = [
    0x10, 0xce, 0x7f, 0xff,       // LDS #$7FFF
    0x86, 0xf8, 0xb7, 0xff, 0x22, // PIA1 B DDR: video mode pins are outputs
    0x86, 0x04, 0xb7, 0xff, 0x23, // Select PIA1 B data
    0x86, 0x00, 0xb7, 0xff, 0x22, // Internal text, green colour set
    0x86, 0x04, 0xb7, 0xff, 0x01, // PIA0 A data, HS interrupt disabled
    0x86, 0x05, 0xb7, 0xff, 0x03, // PIA0 B data, falling FS interrupt enabled
    0xb6, 0xff, 0x02,             // Acknowledge any existing FS flag
    0x86, 0x40, 0xb7, 0x04, 0x00, // First screen character = inverse @
    0xb7, 0xff, 0xc9,             // SAM text page at $0400
    0x1c, 0xef,                   // ANDCC #$EF: enable IRQ
  ];
  bytes.set([...initialization, 0x13, 0x20, 0xfd]); // wait: SYNC; BRA wait
  bytes.set([0xb6, 0xff, 0x02, 0x7c, 0x04, 0x00, 0x3b], 0x100); // IRQ: LDA $FF02; INC $0400; RTI
  bytes.set([0xa1, 0x00], 0x1ff8); bytes.set([0xa0, 0x00], 0x1ffe);
  const { create, firmware } = await cocoTestRom(t, bytes), bindings = { firmware, extended: null };
  for (const cwai of [false, true]) {
    let original = create(bindings); original.reset();
    if (cwai) {
      // The RAM copy changes only SYNC to CWAI #$EF and its back branch.
      const program = [...initialization, 0x3c, 0xef, 0x20, 0xfc];
      program.forEach((byte, index) => original.ram.write(0x200 + index, byte));
      const snapshot = original.snapshot();
      original = create(bindings, { ...snapshot, cpu: { ...snapshot.cpu, pc: 0x200 } });
    }
    while (original.clock.ticks < 26_212) stepCoco(original);
    assert.equal(original.clock.ticks, 26_212); assert.equal(original.pias.irq, true);
    assert.equal(original.ram.read(0x400), 0x40);
    const checkpoint = original.snapshot(), restored = create(bindings, checkpoint);
    const accepted = stepCoco(original);
    assert.equal(accepted.outcome, "accepted"); assert.equal(accepted.clocks, cwai ? 4 : 19);
    assert.deepEqual(stepCoco(restored), accepted);
    const acknowledged = stepCoco(original); assert.deepEqual(stepCoco(restored), acknowledged);
    assert.equal(original.pias.irq, false);
    stepCoco(original); stepCoco(restored); assert.equal(original.ram.read(0x400), 0x41);
    assert.deepEqual(original.snapshot(), restored.snapshot());
    const expected = create(bindings, checkpoint);
    for (let i = 0; i < 1_200; i++) stepCoco(expected);
    for (const batch of [1, 7, 137]) {
      const actual = create(bindings, checkpoint);
      for (let i = 0; i < 1_200; i += batch) {
        for (let j = i; j < Math.min(i + batch, 1_200); j++) stepCoco(actual);
        if (batch !== 1) renderCocoFrame(actual);
      }
      assert.deepEqual(actual.snapshot(), expected.snapshot());
      assert.deepEqual(renderCocoFrame(actual), renderCocoFrame(expected));
      assert.ok(actual.ram.read(0x400) >= 0x43, "successive fields increment the screen");
    }
    const beforeReset = restored.snapshot(); restored.reset();
    assert.deepEqual(restored.snapshot(), { ...beforeReset, cpu: restored.cpu.snapshot() });
    assert.equal(create(bindings).clock.ticks, 0);
  }
});
