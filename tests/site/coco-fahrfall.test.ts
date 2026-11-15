import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cocoDisplayMode, renderCocoFrame } from "../../src/machines/6809/coco/runtime.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import { createSpeakerSamples } from "../../site/interactive/speaker-samples.js";
import { createCocoJoystickInput } from "../../site/interactive/coco-joystick-input.js";
import { standardGamepad } from "../helpers/gamepad.js";
import { cocoSoftware, cocoSoftwareRoms, cocoHash, saveCocoPerformanceCheckpoint } from "../helpers/coco-software.js";

const needsMedia = !(cocoSoftwareRoms && process.env.COCO_FAHRFALL_DISK)
  && "Set COCO_ROM, COCO_EXTENDED_ROM, COCO_DISK_ROM, and COCO_FAHRFALL_DISK for Fahrfall beta 3.";

test("Fahrfall boots, moves both ways, makes sound, and replays loading and fast-clock play checkpoints", { skip: needsMedia }, async () => {
  const disk = readFileSync(process.env.COCO_FAHRFALL_DISK!);
  assert.equal(cocoHash(disk), "f421809567eef3f3602704b08faf1cbebdf6932fad66cfda6beb213c34fa83c6");
  const { session, checkpoint, run, until } = await cocoSoftware();
  const controls = createCocoJoystickInput(() => session.machine.pias);
  const frame = () => renderCocoFrame(session.machine);
  function restore(): void {
    session.powerOn(); session.mountDisk("replacement.dsk", new Uint8Array(disk.length));
    session.restore(checkpoint.read()!.state);
    controls.reset();
    assert.equal(session.diskName, "fahrfall-beta3.dsk");
    assert.equal(session.machine.disk.inspect().writable, false);
  }
  session.mountDisk("fahrfall-beta3.dsk", disk); run(720_000);
  session.send(cocoTextInput('RUN "FAHRFALL"\n'));
  until(() => {
    const drive = session.machine.disk.inspect();
    return drive.phase === 3 && drive.cylinder !== 17 && drive.byte_index === 128;
  }, undefined, 1);
  checkpoint.save(session.snapshot());
  const remaining = until(() => session.machine.sam.clockMode() === 1, undefined, 1) + 200_000;
  run(200_000); const title = session.snapshot(), titlePixels = frame();
  assert.deepEqual(cocoDisplayMode(session.machine), { kind: "semigraphics", height: 96 });
  for (let colour = 0; colour < 9; colour++) assert.ok(titlePixels.includes(colour));
  restore(); run(remaining); assert.deepEqual(session.snapshot(), title);
  assert.deepEqual(frame(), titlePixels);

  controls.select("keyboard", "left"); controls.setActive(true);
  controls.keyDown({ key: " " });
  until(() => session.machine.sam.clockMode() === 3, 1_000_000, 1);
  controls.keyUp({ key: " " });
  until(() => session.machine.sam.clockMode() === 1, 100_000, 1);
  const play = session.snapshot();
  saveCocoPerformanceCheckpoint("fahrfall", play);
  assert.notDeepEqual(frame(), titlePixels, "fire starts the game");

  // Observe completed drawing bursts, not private game variables or instruction addresses.
  function nextFrame(): void {
    until(() => session.machine.sam.clockMode() === 3, 100_000, 1);
    until(() => session.machine.sam.clockMode() === 1, 100_000, 1);
  }
  const directions = [0, 32, 63].map(x => {
    session.restore(play); controls.reset(); controls.select("keyboard", "left"); controls.setActive(true);
    if (x !== 32) controls.keyDown({ key: x === 0 ? "ArrowLeft" : "ArrowRight" });
    for (let i = 0; i < 8; i++) nextFrame();
    return frame();
  });
  for (const [index, axis] of [-1, 0, 1].entries()) {
    session.restore(play); controls.reset(); controls.select("gamepad", "left"); controls.chooseGamepad(0); controls.setActive(true);
    controls.poll([standardGamepad()]); controls.poll([standardGamepad([axis, 0])]);
    for (let i = 0; i < 8; i++) nextFrame();
    assert.deepEqual(frame(), directions[index], "keyboard and gamepad steer through the same physical inputs");
    controls.release(); assert.deepEqual(session.machine.pias.joystick("left"), { connected: true, x: 32, y: 32, pressed: false });
  }
  for (const index of [0, 2]) {
    const changed: number[] = [];
    for (let i = 0; i < directions[1]!.length; i++) if (directions[index]![i] !== directions[1]![i]) changed.push(i);
    assert.ok(changed.length > 400, "movement visibly changes the player sprite");
    const left = index === 0 ? 88 : 120, right = index === 0 ? 143 : 175;
    assert.ok(changed.every(i => i % 256 >= left && i % 256 <= right && (i >> 8) >= 24 && (i >> 8) <= 51),
      `movement bounds: ${Math.min(...changed.map(i => i % 256))}–${Math.max(...changed.map(i => i % 256))}, ${Math.min(...changed.map(i => i >> 8))}–${Math.max(...changed.map(i => i >> 8))}`);
  }

  session.restore(play); controls.reset(); controls.select("keyboard", "left"); controls.setActive(true);
  controls.keyDown({ key: "ArrowRight" });
  until(() => session.machine.sam.clockMode() === 3, 100_000, 1); run(50);
  assert.equal(session.machine.sam.clockMode(), 3);
  checkpoint.save(session.snapshot()); // Inside the fully fast drawing burst.
  function continuePlay(batch: number) {
    const clock = session.machine.clock;
    const sampler = createSpeakerSamples(clock.hertz!, 48_000, clock.ticks, session.machine.pias.soundLevel);
    const samples: number[] = [], edges: { ticks: number; level: number }[] = [];
    const rates = new Set<number>(); let previous = session.machine.pias.soundLevel;
    for (let i = 0; i < 200_000; i++) {
      rates.add(session.machine.sam.clockMode()); session.step();
      const level = session.machine.pias.soundLevel;
      if (level !== previous) { edges.push({ ticks: clock.ticks, level }); previous = level; }
      sampler.advance(clock.ticks, level);
      if ((i + 1) % batch === 0) samples.push(...sampler.take());
    }
    samples.push(...sampler.take());
    assert.deepEqual([...rates].sort(), [1, 3]); assert.ok(edges.length > 100);
    // The sampler subtracts its initial level, which can be silence; polarity is not fixed.
    assert.ok(Math.max(...samples) - Math.min(...samples) > 0.5);
    assert.ok(samples.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1));
    return { state: session.snapshot(), pixels: frame(), edges, samples };
  }
  const result = continuePlay(1000);
  restore();
  const restored = session.snapshot();
  controls.keyDown({ key: "ArrowLeft" }); controls.poll([standardGamepad([-1, 0], [0])]);
  assert.deepEqual(session.snapshot(), restored, "restored positions survive stale host controls until explicitly reassigned");
  assert.deepEqual(continuePlay(137), result, "CPU, RAM, devices, clock, image and PCM replay exactly");
  assert.deepEqual(session.machine.disk.exportImage(), new Uint8Array(disk));
});
