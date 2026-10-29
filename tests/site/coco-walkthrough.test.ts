import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/6809/coco.js";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoScreenText, readCocoStorage } from "../../site/interactive/coco-inspection.js";
import { create6809MemoryObservation } from "../../site/interactive/6809-memory.js";
import { createExecutionTarget } from "../../site/interactive/execution-target.js";

test("Color BASIC walkthrough reaches its real-ROM stops and exposes calls, direct-page stores, and keyboard input", {
  skip: !process.env.COCO_ROM && "Set COCO_ROM to the selected Color BASIC 1.3 image.",
}, async () => {
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware,
    async bytes => createHash("sha256").update(bytes).digest("hex"));
  const session = createCocoSession(firmware), target = createExecutionTarget(), view = create6809MemoryObservation();
  const state = () => session.machine.cpu.snapshot();
  const read = (address: number) => readCocoStorage(session.machine, address);
  let steps = 0;
  function step(): void { assert.equal(session.step().outcome, "executed"); steps++; }
  function stop(address: number): void {
    target.start(address, steps);
    while (!target.beforeStep(state().pc, steps)) step();
    assert.equal(target.stopped, "reached"); assert.equal(state().pc, address);
    view.refresh(read, state());
  }
  assert.equal(state().pc, 0xa027); step(); assert.equal(state().y, 0xa00e);
  stop(0xa051); step(); assert.equal(state().u, 0xffc0);
  view.refresh(read, state()); assert.equal(view.byte(view.pointer("u")).value, undefined);
  stop(0xa05e); step(); assert.equal(state().dp, 0); assert.equal(state().b, 0);
  stop(0xa00e); step(); assert.equal(state().s, 0x3d7);
  stop(0xa07d); step(); view.refresh(read, state());
  assert.equal(state().pc, 0xa928); assert.equal(view.pointer("s"), 0x3d5);
  assert.equal(view.word(0x3d5), 0xa080); assert.equal(view.byte(0x3d5).changed, true);
  step(); step(); step(); view.refresh(read, state());
  assert.equal(state().pc, 0xa92f); assert.equal(view.word(0x88), 0x400);
  stop(0xa936); assert.equal(view.word(0x3d5), 0xa080);
  for (let address = 0x400; address <= 0x5ff; address++) assert.equal(view.byte(address).value, 0x60);
  step(); assert.equal(state().pc, 0xa080); assert.equal(state().s, 0x3d7);
  view.refresh(read, state()); assert.equal(view.word(0x3d5), 0xa080); assert.equal(view.byte(0x3d5).changed, false);
  stop(0xa1d9); assert.equal(state().u, 0xff00);
  step(); assert.equal(session.machine.pias.snapshot().pia0.orb, 0xfe);
  stop(0xa23a); step(); assert.equal(state().a, 0xff); assert.equal(state().pc, 0xa23c);
  for (let i = 0; i < 100_000; i++) step();
  assert.match(cocoScreenText(session.machine), /COLOR BASIC 1\.3\n\(C\) 1982 TANDY\nOK/);
});
