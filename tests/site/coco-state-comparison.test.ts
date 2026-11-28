import assert from "node:assert/strict";
import { test } from "node:test";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { compareCocoScreens, compareCocoStates } from "../../site/interactive/coco-state-comparison.js";

test("CoCo comparison uses stored 6809 registers, CC flags and physical RAM bytes in address order", () => {
  const before = createCocoSession(null, null, null, 64).snapshot().hardware;
  const ram = [...before.ram];
  ram[0x9400] = 0xdf; ram[0x0100] = 1; ram[0x01ff] = 2;
  const cpu = { ...before.cpu, pc: 0x2a0b, a: 0xaa, d: 0xaa00, flags: { ...before.cpu.flags, z: !before.cpu.flags.z } };
  const next = { cpu, ram };
  assert.deepEqual(compareCocoStates(before, before), { cpu: [], pages: [], byteCount: 0 });
  const changes = compareCocoStates(before, next);
  assert.deepEqual(changes.cpu.map(({ target, width, before, after }) => [target, width, before, after]),
    [["A", 2, 0, 0xaa], ["PC", 4, 0, 0x2a0b], ["Z", 1, +before.cpu.flags.z, +cpu.flags.z]]);
  assert.equal(changes.byteCount, 3);
  assert.deepEqual(changes.pages, [
    { base: 0x100, bytes: [{ address: 0x100, before: 0, after: 1 }, { address: 0x1ff, before: 0, after: 2 }] },
    { base: 0x9400, bytes: [{ address: 0x9400, before: 0, after: 0xdf }] },
  ]);
  assert.equal(before.ram[0x9400], 0);
});

test("32 and 64 KiB captures compare their shared RAM, and malformed saved values are rejected", () => {
  const small = createCocoSession().snapshot().hardware, large = createCocoSession(null, null, null, 64).snapshot().hardware;
  const ram = [...large.ram]; ram[0x7fff] = 1; ram[0xffff] = 2;
  assert.equal(compareCocoStates(small, { ...large, ram }).byteCount, 1);
  assert.equal(compareCocoStates({ ...large, ram }, small).byteCount, 1);
  ram[0xffff] = 256;
  assert.throws(() => compareCocoStates({ ...large, ram }, small), /Saved RAM byte/);
  assert.throws(() => compareCocoStates({ ...small, cpu: { ...small.cpu, a: 256 } }, small), /integer/);
});

test("screen comparison uses each side's physical page and video pins with the same monitor signal", () => {
  const session = createCocoSession(null, null, null, 64), machine = session.machine;
  machine.sam.write(3, 0); machine.sam.write(5, 0); machine.sam.write(19, 0); // RG6 at $8000
  machine.pias.write(0x23, 0); machine.pias.write(0x22, 0xf8);
  machine.pias.write(0x23, 4); machine.pias.write(0x22, 0xf8); // black/buff
  machine.ram.write(0x8000, 0x80);
  const saved = session.snapshot().hardware;
  machine.ram.write(0x7000, 255);
  assert.deepEqual(compareCocoScreens(saved, machine, "direct").changed, []);
  machine.pias.write(0x22, 0xf0); // Black/green changes the lit dot without a video RAM store.
  const palette = compareCocoScreens(saved, machine, "direct");
  assert.deepEqual(palette.changed, [0]); assert.equal(palette.before[0], 4); assert.equal(palette.after[0], 0);
  machine.sam.write(18, 0); // Display the blank page at $0000.
  const held = session.snapshot();
  for (const [signal, expected] of [["composite", 12], ["composite-reversed", 11]] as const) {
    const { before, after, changed } = compareCocoScreens(saved, machine, signal);
    assert.deepEqual(changed, [0, 1]); assert.equal(before[0], expected); assert.equal(after[0], 8);
  }
  assert.deepEqual(session.snapshot(), held);
});
