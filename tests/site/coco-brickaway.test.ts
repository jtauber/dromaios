import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/6809/coco.js";
import { cocoDisplayMode, inspectCocoPixel, renderCocoFrame } from "../../src/machines/6809/coco/runtime.js";
import { readCocoTapeCas } from "../../src/components/devices/coco-tape-cas.js";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { createCocoDebugger } from "../../site/interactive/coco-debugger.js";
import { compareCocoStates } from "../../site/interactive/coco-state-comparison.js";
import { cocoSavedCheckpoints } from "../../site/interactive/coco-saved-state.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import { cocoScreenText } from "../../site/interactive/coco-inspection.js";
import { createSpeakerSamples } from "../../site/interactive/speaker-samples.js";
import { createCocoJoystickInput } from "../../site/interactive/coco-joystick-input.js";
import { standardGamepad } from "../helpers/gamepad.js";
import { memoryStorage } from "../helpers/browser-storage.js";
import { tapeBlocks } from "../helpers/coco-tape.js";
import { saveCocoPerformanceCheckpoint } from "../helpers/coco-software.js";
import { catalogue6809 } from "./6809-inspection-fixture.js";

const needsMedia = !(process.env.COCO_ROM && process.env.COCO_EXTENDED_ROM && process.env.COCO_BRICKAWAY_CAS)
  && "Set COCO_ROM, COCO_EXTENDED_ROM, and COCO_BRICKAWAY_CAS for the independent cassette game.";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// Addresses refer only to the pinned, unmodified game; they are observation points,
// never execution shortcuts. The machine chapter records their observed meanings.
test("3-D Brickaway loads through CLOADM, responds to both joystick axes, sounds a brick hit, and replays loading and play", {
  skip: needsMedia,
}, async () => {
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware, async bytes => hash(bytes));
  const extended = await RomImage.verify(readFileSync(process.env.COCO_EXTENDED_ROM!), romImages.extended, async bytes => hash(bytes));
  const cas = readFileSync(process.env.COCO_BRICKAWAY_CAS!);
  assert.equal(cas.length, 11_563);
  assert.equal(hash(cas), "da1e6a1671fd66fa9a269b61d960cccba2e4368cb54bd6f284b7babfeccaa365");
  const samples = readCocoTapeCas(cas), blocks = tapeBlocks(samples);
  assert.equal(samples.length, 2_936_380); // 66.585 seconds: exceeds the former one-minute limit.
  assert.deepEqual(blocks[0]!.data, [...Buffer.from("3DBRICK "), 2, 0, 0, 0x41, 0x2b, 0x16, 0x48]);
  const payload = Uint8Array.from(blocks.filter(block => block.type === 1).flatMap(block => block.data));
  assert.equal(payload.length, 11_017);
  assert.equal(hash(payload), "00c86d64f8eca97ffff1d465e594e6aa2eb8eda157b9232e4b332ff596396833");
  const session = createCocoSession(firmware, extended), storage = memoryStorage();
  const controls = createCocoJoystickInput(() => session.machine.pias);
  const checkpoints = () => cocoSavedCheckpoints(() => storage, session.machine.clock.hertz!);
  function run(count: number): void { for (let i = 0; i < count; i++) session.step(); }
  function until(predicate: () => boolean, limit = 15_000_000): number {
    for (let i = 0; i < limit; i++) { if (predicate()) return i; session.step(); }
    assert.fail(`Game did not reach its stop at PC $${session.machine.cpu.snapshot().pc.toString(16)}.`);
  }
  function line(text: string): void { session.send(cocoTextInput(text + "\n")); until(() => session.inputSettled); }
  const ramBytes = (address: number, length: number) => Uint8Array.from({ length }, (_, i) => session.machine.ram.read(address + i));
  const word = (address: number) => session.machine.ram.read(address) * 256 + session.machine.ram.read(address + 1);
  const pc = () => session.machine.cpu.snapshot().pc;

  run(720_000); session.machine.pias.cassette.insert("3d-brickaway.cas", samples);
  session.machine.pias.cassette.play(); line("CLOADM");
  until(() => session.machine.pias.cassette.inspect().position >= 1_500_000);
  assert.ok(session.machine.pias.cassetteMotor);
  assert.deepEqual(ramBytes(0x1648, 1000), payload.slice(0, 1000));
  assert.notDeepEqual(ramBytes(0x1648, payload.length), payload);
  const loading = session.snapshot(); assert.ok(loading.hardware.pias.cassette.phase > 0); await checkpoints().save("Loading", loading);
  const remaining = until(() => !session.machine.pias.cassetteMotor && /\nOK(?:\n█)?$/.test(cocoScreenText(session.machine)));
  assert.match(cocoScreenText(session.machine), /F 3DBRICK\nOK/);
  assert.deepEqual(ramBytes(0x1648, payload.length), payload);
  assert.equal(word(0x9d), 0x412b, "CLOADM restores the header's EXEC address");
  const loaded = session.snapshot();
  session.powerOn(); session.machine.pias.cassette.eject(); session.restore(await checkpoints().restore("Loading")); run(remaining);
  assert.deepEqual(session.snapshot(), loaded); // Includes RAM, tape, sub-sample phase, clock and pending input.

  controls.select("gamepad", "right"); controls.chooseGamepad(0); controls.setActive(true); controls.poll([standardGamepad()]);
  line("EXEC"); until(() => pc() === 0x2559, 1_000_000); // The game's right-fire polling loop.
  assert.deepEqual(cocoDisplayMode(session.machine), { kind: "bitmap", width: 256, height: 192, bitsPerPixel: 1 });
  assert.equal(session.machine.ram.read(0x1e24), 5);
  controls.poll([standardGamepad([0, 0], [0])]); run(1000); controls.poll([standardGamepad()]);
  until(() => pc() === 0x2a0b, 1_000_000); // Paddle drawn; next ball update has not begun.
  assert.equal(word(0x1e18), 0);
  const playing = session.snapshot(); await checkpoints().save("Playing", playing);
  assert.deepEqual(checkpoints().names(), ["Loading", "Playing"]);
  assert.deepEqual(await checkpoints().restore("Loading"), loading);
  saveCocoPerformanceCheckpoint("brickaway", playing);
  assert.deepEqual(renderCocoFrame(session.machine, "composite"), renderCocoFrame(session.machine),
    "the green opening scene keeps its direct colours");
  function frame(step = () => { session.step(); }): void {
    step();
    for (let i = 0; i < 1_000_000; i++) { if (pc() === 0x2a0b) return; step(); }
    assert.fail("Game did not finish its frame.");
  }
  const frames: { raster: Uint8Array; address: number }[] = [];
  for (const [x, y, address] of [[5, 5, 0x0a22], [58, 5, 0x0a39], [58, 58, 0x17d9]] as const) {
    session.restore(await checkpoints().restore("Playing")); controls.reset();
    const restored = session.snapshot();
    assert.deepEqual(compareCocoStates(playing.hardware, restored.hardware), { cpu: [], pages: [], byteCount: 0 });
    controls.poll([standardGamepad([1, 1], [0])]);
    assert.deepEqual(session.snapshot(), restored, "restoration hands ownership back to the saved controls");
    controls.select("gamepad", "right"); controls.setActive(true); controls.poll([standardGamepad()]);
    controls.poll([standardGamepad([x === 5 ? -0.875 : 0.875, y === 5 ? -0.875 : 0.875])]); frame();
    assert.deepEqual(ramBytes(0x15a, 2), Uint8Array.of(x, y), "the ROM measures the physical joystick");
    assert.equal(word(0x1e22), address, "game chooses the paddle's video RAM address");
    if (x === 58 && y === 58) {
      const compared = compareCocoStates(playing.hardware, session.snapshot().hardware);
      const changed = new Map(compared.pages.flatMap(page => page.bytes.map(byte => [byte.address, byte] as const)));
      assert.equal(playing.hardware.cpu.pc, pc(), "both captures stop at the same frame boundary");
      for (const [location, before, after] of [
        [0x015a, 0, 58], [0x015b, 0, 58], [0x1e22, 0x0a, 0x17], [0x1e23, 0x20, 0xd9], [0x17d9, 0x10, 0x11],
      ] as const) assert.deepEqual(changed.get(location), { address: location, before, after });
    }
    frames.push({ raster: renderCocoFrame(session.machine), address });
  }
  for (let i = 1; i < frames.length; i++) {
    const before = frames[i - 1]!, after = frames[i]!;
    function inPaddle(pixel: number, address: number): boolean {
      const x = (address % 32) * 8, y = Math.floor((address - 0x600) / 32);
      return pixel % 256 >= x && pixel % 256 < x + 56 && Math.floor(pixel / 256) >= y && Math.floor(pixel / 256) < y + 50;
    }
    let changed = 0;
    for (let pixel = 0; pixel < after.raster.length; pixel++) if (before.raster[pixel] !== after.raster[pixel]) {
      changed++;
      assert.ok(inPaddle(pixel, before.address) || inPaddle(pixel, after.address), "only the two paddle regions differ");
    }
    assert.ok(changed > 100, "movement changes visible pixels on each axis");
  }

  const debug = createCocoDebugger(() => session.machine, catalogue6809);
  const dot = { address: 0x17d9, bit: 0, bitsPerPixel: 1, byte: 0x11, colour: 0 };
  const black = { ...dot, byte: 0x10, colour: 8 };
  assert.deepEqual(inspectCocoPixel(session.machine, 207, 142), dot);
  for (const stop of ["write", "pixel"]) {
    debug.setWatchpoints(stop === "write" ? [{ address: dot.address, enabled: true }] : []);
    session.restore(await checkpoints().restore("Playing")); debug.reset();
    assert.deepEqual(inspectCocoPixel(session.machine, 207, 142), black);
    const paddlePixel = () => renderCocoFrame(session.machine)[142 * 256 + 207];
    assert.equal(paddlePixel(), 8, "the dot is black in the saved frame");
    session.machine.pias.setJoystickPosition("right", 58, 58);
    if (stop === "write") debug.run(); else debug.runUntilPixelChanges(207, 142, "composite");
    let record;
    for (let i = 0; !debug.beforeStep(); i++) {
      assert.ok(i < 100_000, "expected the first paddle store");
      record = debug.capture(() => session.step());
    }
    assert.deepEqual(record?.instruction, { address: 0x26a3, bytes: [0xa7, 0x84] });
    assert.equal(pc(), 0x26a5);
    if (stop === "write") {
      const hit = debug.hit;
      assert.ok(hit?.kind === "write");
      assert.deepEqual([hit.address, hit.before, hit.after], [0x17d9, 0x10, 0x11]);
    } else {
      const hit = debug.pixelHit;
      assert.equal(hit?.instruction, "STA ,X"); assert.equal(hit.caller.address, 0x26a3);
      assert.deepEqual(hit.before, black); assert.deepEqual(hit.after, dot);
    }
    assert.equal(paddlePixel(), 0, "the store lights the dot green");
    assert.deepEqual(inspectCocoPixel(session.machine, 207, 142), dot);
  }
  debug.dispose();

  function firstBrick(batch: number) {
    const clock = session.machine.clock, sampler = createSpeakerSamples(clock.hertz!, 48000, clock.ticks, session.machine.pias.soundLevel);
    const audio: number[] = [], edges: { ticks: number; level: number; address: number }[] = [];
    let previous = session.machine.pias.soundLevel, count = 0;
    function step(): void {
      const record = session.step(), level = session.machine.pias.soundLevel;
      if (level !== previous) { edges.push({ ticks: clock.ticks, level, address: record.instruction!.address }); previous = level; }
      sampler.advance(clock.ticks, level);
      if (++count % batch === 0) audio.push(...sampler.take());
    }
    for (let i = 0; i < 30 && word(0x1e18) === 0; i++) frame(step);
    audio.push(...sampler.take());
    assert.equal(word(0x1e18), 100);
    const bricks = [...ramBytes(0x1e26, 5)].reduce((total, byte) => total + byte.toString(2).replaceAll("0", "").length, 0);
    assert.equal(bricks, 39, "one of forty bricks has gone");
    assert.equal(edges.length, 32, "sixteen pulses at the first brick collision");
    assert.deepEqual([...new Set(edges.map(edge => edge.level))].sort(), [0.5, 1]);
    assert.ok(edges.every(edge => [0x2440, 0x2445, 0x244d].includes(edge.address)), "sound is produced by the game's DAC and sound-enable writes");
    assert.ok(audio.some(sample => sample > 0.1));
    const raster = renderCocoFrame(session.machine); assert.ok(raster.includes(4), "hit selects the buff colour set");
    const beforeDisplay = session.snapshot();
    const composite = renderCocoFrame(session.machine, "composite"), reversed = renderCocoFrame(session.machine, "composite-reversed");
    assert.ok(composite.includes(11) && composite.includes(12), "the unchanged game produces both artifact colours");
    for (let pixel = 0; pixel < raster.length; pixel += 2) {
      const pair = Number(raster[pixel] === 4) * 2 + Number(raster[pixel + 1] === 4);
      const colour = [8, 11, 12, 4][pair]!;
      assert.equal(composite[pixel], colour); assert.equal(composite[pixel + 1], colour);
      const swapped = [8, 12, 11, 4][pair]!;
      assert.equal(reversed[pixel], swapped); assert.equal(reversed[pixel + 1], swapped);
    }
    assert.deepEqual(session.snapshot(), beforeDisplay, "switching display interpretation cannot alter play or sound");
    return { state: beforeDisplay, raster, composite, reversed, audio, edges };
  }
  session.restore(await checkpoints().restore("Playing")); const first = firstBrick(1000);
  session.powerOn(); session.machine.pias.cassette.eject(); session.restore(await checkpoints().restore("Playing"));
  assert.deepEqual(firstBrick(137), first, "play checkpoint repeats RAM, pixels, DAC edges and PCM at a different drain schedule");
});
