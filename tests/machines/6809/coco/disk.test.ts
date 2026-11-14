import assert from "node:assert/strict";
import { test } from "node:test";
import { CocoDiskController, cocoDiskSize } from "../../../../src/machines/6809/coco/disk-controller.js";
import { create6809CocoDisk } from "../../../../src/machines/generated/6809/coco-disk.js";
import { stepCoco } from "../../../../src/machines/6809/coco/runtime.js";

const empty = { firmware: null, extended: null, dos: null };

function machineAtRam(armed = false) {
  const state = create6809CocoDisk(empty).snapshot();
  const machine = create6809CocoDisk(empty, { ...state, cpu: {
    ...state.cpu, pc: 0x200, s: 0x7fff, x: 0x4000, a: 0xa9, nmiArmed: armed,
    flags: { ...state.cpu.flags, i: false },
  } });
  // The real ROM uses this same data loop: LDB $FF4B; STB ,X+; STA $FF40; BRA.
  [0xf6, 0xff, 0x4b, 0xe7, 0x80, 0xb7, 0xff, 0x40, 0x20, 0xf6].forEach((byte, i) => machine.ram.write(0x200 + i, byte));
  return machine;
}

test("disk media is owned, read-only and validated; the cartridge decodes only its mapped registers", () => {
  const machine = create6809CocoDisk(empty), bytes = new Uint8Array(cocoDiskSize).fill(0xa5);
  machine.disk.mount(bytes); bytes[0] = 0;
  assert.equal(machine.disk.snapshot().image![0], 0xa5);
  assert.ok(Object.isFrozen(machine.disk.snapshot().image));
  for (let address = 0xff40; address <= 0xff47; address++) {
    machine.memory.write(address, 0x29); assert.equal(machine.disk.inspect().control, 0x29);
    assert.equal(machine.memory.read(address), 0xff);
  }
  machine.memory.write(0xff49, 7); machine.memory.write(0xff4a, 18);
  assert.equal(machine.memory.read(0xff49), 7); assert.equal(machine.memory.read(0xff4a), 18);
  const before = machine.disk.snapshot();
  for (const address of [0xff4c, 0xff5f, 0xff60, 0xffbf]) {
    machine.memory.write(address, 0x80); assert.equal(machine.memory.read(address), 0xff);
  }
  assert.deepEqual(machine.disk.snapshot(), before);
  for (const invalid of [new Uint8Array(1), Array(cocoDiskSize).fill(256)]) {
    assert.throws(() => machine.disk.mount(invalid)); assert.deepEqual(machine.disk.snapshot(), before);
  }
  assert.throws(() => new CocoDiskController({ ...before, image: null }), /mounted image/);
  assert.throws(() => new CocoDiskController({ ...before, microsecondPhase: 3_579_545 }));
  machine.disk.mount(null); assert.equal(machine.disk.inspect().media, false);
});

test("controller time is partition-independent; polling cannot accelerate it or replace lost bytes", () => {
  const disk = new CocoDiskController(); disk.mount(new Uint8Array(cocoDiskSize).map((_, i) => i & 255));
  disk.write(0, 0x29); disk.write(8, 0x80);
  const split = new CocoDiskController(disk.snapshot()), timer = disk.inspect().timer;
  for (let i = 0; i < 100; i++) { disk.read(8); disk.inspect(); disk.snapshot(); }
  assert.equal(disk.inspect().timer, timer);
  disk.advanceCpuClocks(1_000);
  for (const clocks of [1, 7, 53, 17, 922]) split.advanceCpuClocks(clocks);
  assert.deepEqual(split.snapshot(), disk.snapshot());
  assert.equal(disk.inspect().error, 4); assert.ok(disk.inspect().byte_index > 1);
  const before = disk.snapshot();
  assert.throws(() => disk.mount(null), /Finish or abort/);
  assert.throws(() => disk.write(0, 0x21), /active command/);
  assert.deepEqual(disk.snapshot(), before);
  disk.write(8, 0xd0); disk.mount(null);
});

test("HALT advances board time without CPU accesses; an unread byte checkpoint replays the complete RAM transfer", () => {
  const machine = machineAtRam(), image = new Uint8Array(cocoDiskSize).map((_, i) => (i * 37 + 11) & 255);
  machine.disk.mount(image); machine.disk.write(0, 0xa9); machine.disk.write(8, 0x80);
  const before = machine.cpu.snapshot(), waiting = stepCoco(machine);
  assert.equal(waiting.outcome, "waiting"); assert.deepEqual(waiting.accesses, []);
  assert.deepEqual(machine.cpu.snapshot(), before); assert.equal(waiting.clocks, 0);
  assert.equal(waiting.idleClocks, 29); assert.equal(machine.clock.ticks, 29);
  for (let i = 0; i < 1_000 && !(machine.disk.inspect().byte_index === 63 && machine.disk.inspect().drq); i++) stepCoco(machine);
  const checkpoint = machine.snapshot();
  assert.equal(checkpoint.disk.circuit.byte_index, 63); assert.equal(checkpoint.disk.circuit.drq, true);
  assert.notEqual(checkpoint.disk.microsecondPhase, 0);
  const restored = create6809CocoDisk(empty, JSON.parse(JSON.stringify(checkpoint)));
  let checkedDeferredHalt = false;
  let boundaries = 0;
  while (machine.disk.inspect().phase !== 0 && boundaries++ < 2_000) {
    if (!checkedDeferredHalt && machine.disk.snapshot().haltDeferred) {
      const delayed = create6809CocoDisk(empty, JSON.parse(JSON.stringify(machine.snapshot())));
      const stored = stepCoco(delayed);
      assert.equal(stored.outcome, "executed");
      assert.ok(stored.accesses.some(access => access.kind === "write" && access.address === stored.before.x));
      assert.deepEqual(stored, stepCoco(restored)); assert.deepEqual(stored, stepCoco(machine));
      assert.equal(machine.disk.halted, true);
      checkedDeferredHalt = true;
      continue;
    }
    assert.deepEqual(stepCoco(restored), stepCoco(machine));
  }
  assert.equal(checkedDeferredHalt, true);
  assert.ok(boundaries < 2_000); assert.equal(machine.disk.inspect().error, 0);
  assert.deepEqual(restored.snapshot(), machine.snapshot());
  assert.deepEqual(Array.from({ length: 256 }, (_, i) => machine.ram.read(0x4000 + i)), [...image.slice(0, 256)]);
  assert.equal(machine.cpu.snapshot().x, 0x4100);
  assert.equal(machine.disk.halted, false); assert.equal(machine.disk.inspect().nmi_pending, true);
  const saved = machine.snapshot(); machine.reset();
  assert.deepEqual(machine.snapshot(), { ...saved, cpu: machine.cpu.snapshot() });
  assert.equal(create6809CocoDisk(empty).disk.snapshot().image, null);
});

test("NMI assertion is offered once, ahead of IRQ, even if the CPU has not armed NMI", () => {
  for (const armed of [false, true]) {
    const machine = machineAtRam(armed);
    machine.disk.write(0, 0x29); machine.disk.write(8, 0xd8);
    machine.disk.write(8, 0xd0); machine.disk.read(8); // Acknowledge the level, retaining the captured edge.
    machine.disk.write(0, 0xa9);
    const waiting = stepCoco(machine);
    assert.equal(waiting.outcome, "waiting"); assert.deepEqual(waiting.accesses, []);
    assert.equal(machine.disk.inspect().nmi_pending, true, "HALT defers NMI service");
    machine.disk.write(0, 0x29); machine.disk.write(8, 0xd8);
    if (armed) { machine.pias.write(1, 5); machine.pias.setHorizontalSync(false); assert.equal(machine.pias.irq, true); }
    const record = stepCoco(machine);
    if (armed) { assert.equal(record.outcome, "accepted"); assert.ok("source" in record && record.source === "nmi"); }
    else assert.equal(record.outcome, "executed");
    assert.equal(machine.disk.inspect().nmi_pending, false);
    assert.equal(machine.disk.inspect().nmi_level, true);
    assert.equal(machine.disk.takeNmi(), false);
    const before = machine.disk.snapshot();
    machine.disk.inspect(); machine.disk.snapshot(); machine.disk.read(8);
    assert.deepEqual(machine.disk.snapshot(), before, "D8 cannot be acknowledged by observation or status reads alone");
    machine.disk.write(8, 0xd0); machine.disk.read(8);
    machine.disk.write(8, 0xd8); assert.equal(machine.disk.takeNmi(), true);
  }
});

function diskEvent(disk: CocoDiskController): void { disk.advanceCpuClocks(disk.clocksUntilEvent()); }

test("sector writes change the exact physical image bytes, preserve snapshots and export detached media", () => {
  const disk = new CocoDiskController(), original = new Uint8Array(cocoDiskSize).fill(0xcd);
  disk.mount(original); disk.writableCopy(); const initial = disk.snapshot();
  disk.write(0, 0x29); disk.write(11, 4); disk.write(8, 0x10);
  while (disk.inspect().phase) diskEvent(disk);
  disk.write(10, 7); disk.write(8, 0xa0); diskEvent(disk);
  assert.throws(() => disk.writableCopy()); assert.throws(() => disk.mount(null));
  const offset = (4 * 18 + 6) * 256, expected = original.slice();
  disk.write(11, 0xa5); diskEvent(disk);
  for (let i = 0; i < 256; i++) {
    if (i) disk.write(11, i ^ 0xa5);
    assert.equal(disk.exportImage()[offset + i], 0xcd, "DATA has not reached media before its deadline");
    diskEvent(disk); expected[offset + i] = i ^ 0xa5;
  }
  diskEvent(disk); assert.equal(disk.inspect().phase, 0); assert.equal(disk.inspect().error, 0);
  assert.deepEqual(disk.exportImage(), expected); assert.deepEqual(initial.image, [...original]);
  const exported = disk.exportImage(); exported.fill(0); assert.deepEqual(disk.exportImage(), expected);
  const held = disk.snapshot(); assert.ok(Object.isFrozen(held.image));
  disk.write(8, 0xa0); diskEvent(disk); disk.write(11, 0x42); diskEvent(disk); diskEvent(disk);
  disk.write(11, 0x99); // Pending DATA must not be committed by an abort.
  disk.write(8, 0xd0); expected[offset] = 0x42;
  assert.deepEqual(disk.exportImage(), expected); assert.equal(held.image![offset], 0xa5);
  disk.reset(); assert.equal(disk.inspect().writable, true); assert.deepEqual(disk.exportImage(), expected);
  disk.mount(expected); assert.equal(disk.inspect().writable, false);
});

test("a write checkpoint owns the edited prefix and pending DATA; underruns and clock partitions replay exactly", () => {
  const disk = new CocoDiskController(); disk.mount(new Uint8Array(cocoDiskSize).fill(0xcc), { writable: true });
  disk.write(0, 0x29); disk.write(8, 0xa0); diskEvent(disk); disk.write(11, 0x41); diskEvent(disk); diskEvent(disk);
  disk.write(11, 0x42); const held = disk.snapshot(), restored = new CocoDiskController(JSON.parse(JSON.stringify(held)));
  assert.equal(held.image![0], 0x41); assert.equal(held.image![1], 0xcc); assert.equal(held.circuit.data, 0x42);
  disk.advanceCpuClocks(10_000);
  for (const clocks of [1, 7, 83, 2000, 7909]) restored.advanceCpuClocks(clocks);
  assert.deepEqual(restored.snapshot(), disk.snapshot()); assert.equal(disk.inspect().error, 4);
  const expected = new Uint8Array(cocoDiskSize).fill(0xcc); expected.fill(0, 2, 256); expected.set([0x41, 0x42]);
  assert.deepEqual(disk.exportImage(), expected); assert.equal(held.image![1], 0xcc);
  const fresh = new CocoDiskController(); fresh.mount(expected);
  fresh.write(0, 0x29); fresh.write(8, 0xa0); assert.equal(fresh.inspect().error, 0x40);
  assert.deepEqual(fresh.exportImage(), expected);
  fresh.writableCopy(); fresh.write(8, 0xa0); diskEvent(fresh); diskEvent(fresh);
  assert.equal(fresh.inspect().error, 4); assert.deepEqual(fresh.exportImage(), expected, "missing first DATA leaves the disk intact");
  assert.throws(() => fresh.mount(null, { writable: true })); assert.deepEqual(fresh.exportImage(), expected);
  fresh.mount(null); assert.equal(fresh.inspect().writable, false);
  assert.throws(() => fresh.writableCopy()); assert.throws(() => fresh.exportImage());
});
