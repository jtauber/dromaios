import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/6809/coco.js";
import { renderCocoFrame } from "../../src/machines/6809/coco/runtime.js";
import { readCocoTapeWav, writeCocoTapeWav } from "../../src/components/devices/coco-tape-wav.js";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoSavedState } from "../../site/interactive/coco-saved-state.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import { cocoScreenText } from "../../site/interactive/coco-inspection.js";
import { tapeBlocks, casBlock } from "../helpers/coco-tape.js";
import { readCocoTapeCas } from "../../src/components/devices/coco-tape-cas.js";

const needsRom = !process.env.COCO_ROM && "Set COCO_ROM to Color BASIC 1.3.";
const chapter = readFileSync("src/machines/6809/coco.md", "utf8");
const program = chapter.split("### Move a dot with a joystick\n")[1]!.match(/```text\n([^`]+)\n```/)![1]!.split("\n");

function cassetteSessionDriver(session: ReturnType<typeof createCocoSession>) {
  function run(count: number): void { for (let i = 0; i < count; i++) session.step(); }
  function until(predicate: () => boolean, limit = 3_000_000): number {
    for (let i = 0; i < limit; i++) { if (predicate()) return i; session.step(); }
    assert.fail(`CoCo did not reach its stop: ${cocoScreenText(session.machine)}`);
  }
  function line(text: string): void {
    session.send(cocoTextInput(text + "\n")); until(() => session.inputSettled); run(30_000);
  }
  function prompt(): boolean { return !session.machine.pias.cassetteMotor && /\nOK(?:\n█)?$/.test(cocoScreenText(session.machine)); }
  return { run, until, line, prompt };
}

test("CSAVE exports the dot waveform; fresh CLOAD restores its bytes and execution, with exact mid-transfer checkpoint replay", { skip: needsRom }, async () => {
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware,
    async bytes => createHash("sha256").update(bytes).digest("hex"));
  const session = createCocoSession(firmware);
  const storage = new Map<string, string>();
  const saved = cocoSavedState(() => ({ getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } }), session.machine.clock.hertz!);
  const { run, until, line, prompt } = cassetteSessionDriver(session);
  function programBytes(): number[] {
    const ram = session.machine.ram, word = (at: number) => ram.read(at) * 256 + ram.read(at + 1);
    return Array.from({ length: word(0x1b) - word(0x19) }, (_, i) => ram.read(word(0x19) + i));
  }
  run(720_000); program.forEach(line); const original = programBytes(); assert.equal(original.length, 118);
  session.machine.pias.cassette.blank("DOT.wav"); session.machine.pias.cassette.record(); line('CSAVE "DOT"');
  until(() => session.machine.pias.cassette.inspect().position >= 120_000);
  const recording = session.snapshot(); assert.equal(recording.hardware.pias.cassette.mode, "record");
  assert.ok(recording.hardware.pias.cassette.phase > 0); saved.save(recording);
  const remainingSave = until(prompt), recorded = session.snapshot();
  const wav = writeCocoTapeWav(session.machine.pias.cassette.samples());
  session.machine.pias.cassette.eject(); session.restore(saved.read()!.state); run(remainingSave);
  assert.deepEqual(session.snapshot(), recorded); assert.deepEqual(writeCocoTapeWav(session.machine.pias.cassette.samples()), wav);
  const blocks = tapeBlocks(readCocoTapeWav(wav));
  assert.deepEqual(blocks.map(block => block.type), [0, 1, 255]);
  assert.deepEqual(blocks[0]!.data.slice(0, 11), [...Buffer.from("DOT     "), 0, 0, 0]);
  assert.deepEqual(blocks[1]!.data, original); assert.deepEqual(blocks[2]!.data, []);

  session.powerOn(); assert.equal(session.machine.pias.cassette.inspect().mode, "stop");
  assert.deepEqual(session.machine.pias.cassette.samples(), readCocoTapeWav(wav));
  run(720_000); assert.equal(programBytes().length, 2);
  // Mount the exported file, not the old recorder's in-memory medium.
  session.machine.pias.cassette.insert("DOT-saved.wav", readCocoTapeWav(wav));
  session.machine.pias.cassette.play(); line('CLOAD "DOT"');
  until(() => session.machine.pias.cassette.inspect().position >= 120_000);
  const reading = session.snapshot(); assert.equal(reading.hardware.pias.cassette.mode, "play"); saved.save(reading);
  const remainingLoad = until(prompt), loaded = session.snapshot();
  assert.match(cocoScreenText(session.machine), /F DOT\nOK/); assert.deepEqual(programBytes(), original);
  session.powerOn(); session.restore(saved.read()!.state); run(remainingLoad);
  assert.deepEqual(session.snapshot(), loaded); assert.equal(session.machine.pias.cassette.inspect().writable, false);
  line("LIST"); for (const text of program) assert.ok(cocoScreenText(session.machine).replace(/\s/g, "").includes(text.replace(/\s/g, "")));
  session.machine.pias.connectJoystick("right", true); session.machine.pias.setJoystickPosition("right", 12, 46);
  line("RUN");
  function dot(colour: number): void {
    until(() => session.machine.ram.read(0x400 + 11 * 32 + 6) === (0x82 | colour << 4), 100_000);
    const frame = renderCocoFrame(session.machine);
    for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) {
      assert.equal(frame[y * 256 + x], x >= 48 && x < 52 && y >= 138 && y < 144 ? colour : 8);
    }
  }
  dot(2); session.machine.pias.setJoystickButton("right", true); dot(3);
});

test("CSAVEM spans two blocks; fresh CLOADM from WAV and compact CAS restores all bytes and EXEC uses the saved entry", {
  skip: !(process.env.COCO_ROM && process.env.COCO_EXTENDED_ROM) && "Set COCO_ROM and COCO_EXTENDED_ROM for machine-code cassette acceptance.",
}, async () => {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware, digest);
  const extended = await RomImage.verify(readFileSync(process.env.COCO_EXTENDED_ROM!), romImages.extended, digest);
  const session = createCocoSession(firmware, extended), { run, until, line, prompt } = cassetteSessionDriver(session);
  const expected = Array.from({ length: 300 }, (_, i) => i & 255);
  expected.splice(256, 12, 0x86, 0x2a, 0xb7, 0x62, 0x00, 0x86, 0x4d, 0xad, 0x9f, 0xa0, 0x02, 0x39);
  const bytes = () => Array.from({ length: 300 }, (_, i) => session.machine.ram.read(0x6000 + i));
  run(720_000);
  const setup = chapter.split("### Machine code on cassette\n")[1]!.match(/```text\n([^`]+)\n```/)![1]!.split("\n");
  setup.forEach(line); until(prompt); assert.deepEqual(bytes(), expected);
  session.machine.pias.cassette.blank("MARKER.wav"); session.machine.pias.cassette.record();
  line('CSAVEM "MARKER",&H6000,&H612B,&H6100'); until(prompt);
  const wav = writeCocoTapeWav(session.machine.pias.cassette.samples()), blocks = tapeBlocks(readCocoTapeWav(wav));
  assert.deepEqual(blocks, [
    { type: 0, data: [...Buffer.from("MARKER  "), 2, 0, 0, 0x61, 0, 0x60, 0] },
    { type: 1, data: expected.slice(0, 255) }, { type: 1, data: expected.slice(255) }, { type: 255, data: [] },
  ]);
  // CAS may omit the recorded leaders and gaps: the importer must restore them.
  const cas = Uint8Array.from(blocks.flatMap(({ type, data }) => casBlock(type, data).slice(1, -1)));
  for (const [name, samples] of [["MARKER-saved.wav", readCocoTapeWav(wav)], ["MARKER.cas", readCocoTapeCas(cas)]] as const) {
    session.powerOn(); run(720_000); line("CLEAR200,&H5FFF");
    assert.notDeepEqual(bytes(), expected); assert.equal(session.machine.ram.read(0x6200), 0);
    session.machine.pias.cassette.insert(name, samples); session.machine.pias.cassette.play(); line('CLOADM "MARKER"');
    until(() => session.machine.ram.read(0x60fe) === 254);
    assert.notEqual(session.machine.ram.read(0x6100), 0x86, "Checkpoint lies between the two data blocks");
    const halfway = session.snapshot(); assert.equal(halfway.hardware.pias.cassette.mode, "play");
    const remaining = until(prompt), loaded = session.snapshot();
    assert.match(cocoScreenText(session.machine), /F MARKER\nOK/); assert.deepEqual(bytes(), expected);
    session.machine.pias.cassette.eject(); session.restore(JSON.parse(JSON.stringify(halfway))); run(remaining);
    assert.deepEqual(session.snapshot(), loaded); assert.equal(session.machine.pias.cassette.inspect().writable, false);
    session.send(cocoTextInput("EXEC\n")); until(() => session.machine.cpu.snapshot().pc === 0x6100);
    until(() => session.inputSettled); run(30_000);
    assert.equal(session.machine.ram.read(0x6200), 42); assert.match(cocoScreenText(session.machine), /EXEC\nM\nOK/);
    line("PRINT PEEK(&H6200)"); assert.match(cocoScreenText(session.machine), /\n 42\nOK/);
  }
});

test("version-5 checkpoints gain an empty recorder; packed PCM and transport validation reject damaged restores atomically", () => {
  const session = createCocoSession(), values = new Map<string, string>();
  const saved = cocoSavedState(() => ({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }), session.machine.clock.hertz!);
  saved.save(session.snapshot()); const key = [...values.keys()][0]!, envelope = JSON.parse(values.get(key)!);
  const { cassette, ...pias } = envelope.state.hardware.pias;
  const legacy = { ...envelope, version: 5, state: { ...envelope.state, hardware: { ...envelope.state.hardware, pias } } };
  values.set(key, JSON.stringify(legacy)); session.restore(saved.read()!.state);
  assert.equal(session.machine.pias.cassette.inspect().name, null); assert.equal(values.get(key), JSON.stringify(legacy));
  session.machine.pias.cassette.blank("tiny.wav"); session.machine.pias.cassette.record();
  session.machine.pias.cassette.advance(10, 44_100, true, 25); saved.save(session.snapshot());
  const packed = JSON.parse(values.get(key)!); assert.equal(packed.state.hardware.pias.cassette.samples, btoa(String.fromCharCode(...Array(10).fill(25))));
  const before = session.snapshot(); session.restore(saved.read()!.state); assert.deepEqual(session.snapshot(), before);
  for (const replacement of [undefined, { ...packed.state.hardware.pias.cassette, samples: "?" },
    { ...packed.state.hardware.pias.cassette, samples: [25] }, { ...packed.state.hardware.pias.cassette, phase: 2 },
    { ...packed.state.hardware.pias.cassette, position: 11 }, { ...packed.state.hardware.pias.cassette, writable: false }]) {
    values.set(key, JSON.stringify({ ...packed, state: { ...packed.state, hardware: { ...packed.state.hardware,
      pias: { ...packed.state.hardware.pias, cassette: replacement } } } }));
    assert.throws(() => session.restore(saved.read()!.state)); assert.deepEqual(session.snapshot(), before);
  }
});
