import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/6809/coco-disk.js";
import { cocoDisplayMode, renderCocoFrame } from "../../src/machines/6809/coco/runtime.js";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoSavedState } from "../../site/interactive/coco-saved-state.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import { cocoScreenText } from "../../site/interactive/coco-inspection.js";
import { createSpeakerSamples } from "../../site/interactive/speaker-samples.js";
import { cocoBinaryFile } from "../helpers/coco-disk.js";

const needsMedia = !(process.env.COCO_ROM && process.env.COCO_EXTENDED_ROM && process.env.COCO_DISK_ROM && process.env.COCO_DONKEY_DISK)
  && "Set COCO_ROM, COCO_EXTENDED_ROM, COCO_DISK_ROM, and COCO_DONKEY_DISK for Donkey King.";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// Addresses are observations of this pinned game, never RAM patches or execution shortcuts.
test("Donkey King loads from disk on 32 KiB, walks and jumps with sound, and replays loading and play", { skip: needsMedia }, async () => {
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware, async bytes => hash(bytes));
  const extended = await RomImage.verify(readFileSync(process.env.COCO_EXTENDED_ROM!), romImages.extended, async bytes => hash(bytes));
  const dos = await RomImage.verify(readFileSync(process.env.COCO_DISK_ROM!), romImages.dos, async bytes => hash(bytes));
  const disk = readFileSync(process.env.COCO_DONKEY_DISK!);
  assert.equal(hash(disk), "494f0bb08390d30816370f55226249fcb7cc1725bfc74ed35977eed3dee570f6");
  const file = cocoBinaryFile(disk, "DONKEY  BIN");
  assert.deepEqual(file.granules, [32, 33, 34, 35, 30, 31, 36, 37, 28]);
  assert.equal(file.sectors.length, 78); assert.equal(file.finalBytes, 8);
  assert.deepEqual(file.bytes.slice(0, 5), [0, 0x4c, 0xfe, 0x32, 3]);
  assert.deepEqual(file.bytes.slice(-5), [0xff, 0, 0, 0x32, 3]);
  const payload = Uint8Array.from(file.bytes.slice(5, -5));
  assert.equal(payload.length, 19_710);
  assert.equal(hash(payload), "08fef47d089484802cc956ccb1f2e93c3deeb66c186625850aadc34ec1fb2f7e");
  const session = createCocoSession(firmware, extended, dos), storage = new Map<string, string>();
  const saved = cocoSavedState(() => ({ getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } }), session.machine.clock.hertz!);
  const pc = () => session.machine.cpu.snapshot().pc;
  const ram = (address: number, length: number) => Uint8Array.from({ length }, (_, i) => session.machine.ram.read(address + i));
  const word = (address: number) => session.machine.ram.read(address) * 256 + session.machine.ram.read(address + 1);
  let trackReads = false, readBytes = 0;
  const sectors = new Map<number, number>();
  function step(): void {
    const before = trackReads ? session.machine.disk.inspect() : undefined, record = session.step();
    if (before?.phase !== 3 || before.cylinder === 17) return;
    for (const access of record.accesses) if (access.kind === "read" && access.address === 0xff4b) {
      const sector = before.cylinder * 18 + before.sector - 1;
      sectors.set(sector, (sectors.get(sector) ?? 0) + 1); readBytes++;
    }
  }
  function run(count: number): void { for (let i = 0; i < count; i++) step(); }
  function until(done: () => boolean, limit = 3_000_000, sampleEvery = 1): number {
    for (let i = 0; i < limit; i++) { if (i % sampleEvery === 0 && done()) return i; step(); }
    assert.fail(`Donkey King did not reach its stop at $${pc().toString(16)}: ${cocoScreenText(session.machine)}`);
  }
  const prompt = () => session.inputSettled && session.machine.disk.inspect().phase === 0 && /\nOK(?:\n█)?$/.test(cocoScreenText(session.machine));
  function key(text: string): void { session.send(cocoTextInput(text)); until(() => session.inputSettled); }
  function freshRestore(): void {
    session.powerOn(); session.mountDisk("replacement.dsk", new Uint8Array(disk.length));
    session.restore(saved.read()!.state);
    assert.equal(session.diskName, "donkey-king.dsk"); assert.equal(session.machine.disk.inspect().writable, false);
    assert.deepEqual(session.machine.disk.exportImage(), new Uint8Array(disk));
  }

  session.mountDisk("donkey-king.dsk", disk); run(720_000);
  assert.equal(session.snapshot().hardware.ram.length, 0x8000);
  assert.match(cocoScreenText(session.machine), /^DISK EXTENDED COLOR BASIC 1\.1/);
  key("DIR\n"); run(20_000); until(prompt, undefined, 256);
  assert.match(cocoScreenText(session.machine), /DONKEY\s+BIN\s+2 B 9/);
  trackReads = true; session.send(cocoTextInput('LOADM "DONKEY"\n'));
  until(() => readBytes === 9 * 256 + 128); saved.save(session.snapshot());
  const loading = saved.read()!.state.hardware.disk.circuit;
  assert.equal(loading.phase, 3); assert.ok(loading.byte_index > 0 && loading.byte_index < 256);
  assert.deepEqual(ram(0x3203, 9 * 256 - 6), payload.slice(0, 9 * 256 - 6));
  assert.notDeepEqual(ram(0x3203, payload.length), payload, "LOADM has only delivered a prefix");
  const remaining = until(prompt, undefined, 256), loaded = session.snapshot();
  assert.deepEqual(ram(0x3203, payload.length), payload);
  assert.equal(word(0x9d), 0x3203, "LOADM sets the binary's EXEC address");
  assert.deepEqual([...sectors.keys()], file.sectors);
  assert.ok([...sectors.values()].every(count => count === 256));
  trackReads = false; freshRestore(); run(remaining); assert.deepEqual(session.snapshot(), loaded);

  session.machine.pias.connectJoystick("right", true); session.machine.pias.setJoystickPosition("right", 32, 32);
  key("EXEC\n"); until(() => pc() === 0x322c);
  assert.deepEqual(cocoDisplayMode(session.machine), { kind: "bitmap", width: 256, height: 192, bitsPerPixel: 1 });
  assert.ok(renderCocoFrame(session.machine, "composite").every(pixel => pixel === 12), "the manual's red calibration screen");
  // The game cleared the ROM's keyboard workspace. Let one released scan
  // establish its baseline before presenting a new physical keypress.
  step(); until(() => pc() === 0x322c);
  key(" ");
  // The original publisher/title sequence deliberately spends many seconds in delay loops.
  until(() => cocoScreenText(session.machine).includes("NUMBER OF PLAYERS (1 OR 2)"), 20_000_000, 1024);
  key("1"); until(() => cocoScreenText(session.machine).includes("PRACTICE GAME (Y OR N)"), undefined, 256);
  key("N"); until(() => pc() === 0x3d61); // First level's main loop, before its next update.
  assert.equal(session.machine.ram.read(0x190), 0, "normal, not practice");
  assert.equal(session.machine.ram.read(0x192), 1, "one player");
  assert.equal(session.machine.ram.read(0x1a1), 2, "two spare lives, plus the player on screen");
  assert.equal(word(0x6b), 0x1705);
  saved.save(session.snapshot());
  function frame(advance = step): void {
    advance();
    for (let i = 0; i < 1_000_000; i++) { if (pc() === 0x3d61) return; advance(); }
    assert.fail("Donkey King did not finish its game update.");
  }
  const frames: Uint8Array[] = [];
  let standing: Uint8Array | undefined;
  for (const [x, address] of [[32, 0x1705], [58, 0x1707], [5, 0x1703]] as const) {
    session.restore(saved.read()!.state); session.machine.pias.setJoystickPosition("right", x, 32);
    for (let i = 0; i < 8; i++) {
      frame(); if (x === 32 && i === 3) standing = renderCocoFrame(session.machine, "composite");
    }
    assert.deepEqual(ram(0x15a, 2), Uint8Array.of(x, 32), "ROM reads the physical joystick");
    assert.equal(word(0x6b), address, "eight updates move the player sixteen pixels horizontally");
    frames.push(renderCocoFrame(session.machine, "composite"));
  }
  assert.ok(frames[0]!.includes(11) && frames[0]!.includes(12), "the scene has both artifact colours");
  for (const [index, left, right] of [[1, 40, 79], [2, 24, 63]] as const) {
    let changed = 0;
    for (let pixel = 0; pixel < frames[0]!.length; pixel++) if (frames[0]![pixel] !== frames[index]![pixel]) {
      changed++;
      assert.ok(pixel % 256 >= left && pixel % 256 <= right && Math.floor(pixel / 256) >= 168 && Math.floor(pixel / 256) <= 183,
        "only the old/new player sprite region changes when steering");
    }
    assert.ok(changed > 200);
  }

  function jump(batch: number) {
    const clock = session.machine.clock, sampler = createSpeakerSamples(clock.hertz!, 48000, clock.ticks, session.machine.pias.soundLevel);
    const edges: { ticks: number; address: number; level: number }[] = [], audio: number[] = [], positions: number[] = [];
    let previous = session.machine.pias.soundLevel, count = 0;
    function advance(): void {
      const record = session.step(), level = session.machine.pias.soundLevel;
      if (level !== previous) { edges.push({ ticks: clock.ticks, address: record.instruction!.address, level }); previous = level; }
      sampler.advance(clock.ticks, level); if (++count % batch === 0) audio.push(...sampler.take());
    }
    session.machine.pias.setJoystickButton("right", true);
    let apex: Uint8Array | undefined;
    for (let i = 0; i < 14; i++) {
      frame(advance); session.machine.pias.setJoystickButton("right", false);
      positions.push(word(0x6b)); if (i === 3) apex = renderCocoFrame(session.machine, "composite");
    }
    audio.push(...sampler.take());
    assert.deepEqual(positions, [0x1685, 0x1605, 0x1585, 0x1505, 0x1505, 0x1505, 0x1505, 0x1585, 0x1605, 0x1685, 0x1705, 0x1705, 0x1705, 0x1705]);
    assert.equal(session.machine.ram.read(0x69), 0, "back to standing after jumping sixteen pixels upward");
    assert.equal(session.machine.ram.read(0x1a1), 2, "no life lost");
    assert.deepEqual(edges.map(edge => edge.address), [0xa981, 0x61ee, 0x61f4], "ROM joystick setup, then the game's landing pulse");
    assert.deepEqual(edges.map(edge => edge.level), [0.5, 50 / 63, 0.5]);
    assert.equal(edges[2]!.ticks - edges[1]!.ticks, 497, "98 DECB/BNE iterations, then CLR $FF20");
    assert.ok(audio.some(sample => sample > 0.1) && audio.some(sample => sample < -0.1));
    assert.ok(apex && standing);
    let changed = 0;
    for (let pixel = 0; pixel < apex.length; pixel++) if (apex[pixel] !== standing[pixel]) {
      changed++;
      assert.ok(pixel % 256 >= 40 && pixel % 256 < 64 && Math.floor(pixel / 256) >= 152 && Math.floor(pixel / 256) < 184,
        "at the same update, jumping changes only the player region sixteen pixels above his starting position");
    }
    assert.ok(changed > 200, "jump is visible");
    return { state: session.snapshot(), raster: renderCocoFrame(session.machine, "composite"), apex, audio, edges, positions };
  }
  session.restore(saved.read()!.state); const first = jump(1000);
  freshRestore(); assert.deepEqual(jump(137), first, "play restore reproduces CPU, RAM, devices, clocks, pixels, DAC edges and PCM");
  assert.deepEqual(session.machine.disk.exportImage(), new Uint8Array(disk), "original disk remains untouched");
});
