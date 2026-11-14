import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cocoHash, cocoSoftware, cocoSoftwareRoms } from "../helpers/coco-software.js";
import { tapeBlocks } from "../helpers/coco-tape.js";
import { renderCocoFrame } from "../../src/machines/6809/coco/runtime.js";
import { readCocoTapeWav, writeCocoTapeWav } from "../../src/components/devices/coco-tape-wav.js";

const skip = !(cocoSoftwareRoms && process.env.COCO_CARTRIDGE_DIR)
  && "Set the three COCO ROM paths and COCO_CARTRIDGE_DIR for cartridge cassette round trips.";

async function cartridge(name: string, hash: string) {
  const h = await cocoSoftware(), image = readFileSync(join(process.env.COCO_CARTRIDGE_DIR!, name + ".ccc"));
  assert.equal(cocoHash(image), hash); h.session.mountCartridge(name + ".ccc", image); h.run(1_300_000);
  const key = (text: string) => { h.key(text); h.run(50_000); };
  const breakKey = () => { h.keys([["Break"]]); h.run(50_000); };
  return { ...h, key, breakKey };
}

type Cartridge = Awaited<ReturnType<typeof cartridge>>;

/** Restore the packed browser checkpoint after discarding the active machine and tape. */
function finishTransfer(h: Cartridge, mode: "record" | "play", position: number, done: () => boolean): Uint8Array {
  const { session } = h;
  h.until(() => session.machine.pias.cassette.inspect().position >= position && session.machine.pias.cassetteMotor, 10_000_000);
  const state = session.snapshot(), tape = state.hardware.pias.cassette;
  assert.equal(tape.mode, mode); assert.ok(tape.phase > 0, "checkpoint retains fractional sample progress");
  assert.equal(tape.writable, mode === "record"); assert.equal(done(), false);
  h.checkpoint.save(state);
  const remaining = h.until(done, 30_000_000), completed = session.snapshot();
  const wav = writeCocoTapeWav(session.machine.pias.cassette.samples());
  assert.ok(completed.hardware.pias.cassette.position > tape.position, "more tape passed through the firmware after the checkpoint");
  session.powerOn(); session.machine.pias.cassette.eject(); session.ejectCartridge();
  session.restore(h.checkpoint.read()!.state);
  assert.deepEqual(session.snapshot(), state); h.run(remaining);
  assert.deepEqual(session.snapshot(), completed, "CPU, all RAM, cartridge, clock, PIA, tape and queued input replay exactly");
  assert.deepEqual(writeCocoTapeWav(session.machine.pias.cassette.samples()), wav, "export is identical after recovery");
  return wav;
}

test("Art Gallery exports its picture and reloads every byte and pixel after power-on; both tape transfers recover exactly", { skip }, async () => {
  const h = await cartridge("art-gallery", "80640ff96b6611a62387c3d64ac94b135ffc501e8a42f898cca515477203303c"), { session } = h;
  const menu = () => !session.machine.pias.cassetteMotor && h.screen().includes("6 LOAD & RUN PRESENTATION");
  assert.ok(menu()); h.key("1");
  for (const [colour, direction] of [["W", "ArrowRight"], ["E", "ArrowDown"], ["T", "ArrowRight"]] as const) {
    h.key(colour);
    for (let i = 0; i < 8; i++) { h.keys([[direction]]); h.run(50_000); }
  }
  h.breakKey(); assert.ok(menu());
  // Break removes the transient brush cursor. The menu uses $0200, leaving the picture at $0400.
  const picture = h.bytes(0x400, 3072);
  const pixels = Uint8Array.from({ length: 256 * 192 }, (_, i) => {
    const x = i % 256, y = Math.floor(i / 256);
    return picture[Math.floor(y / 2) * 32 + Math.floor(x / 8)]! >> (6 - Math.floor(x / 2) % 4 * 2) & 3;
  });
  assert.deepEqual([...new Set(pixels)].sort(), [0, 1, 2, 3], "green background with red, blue and yellow drawing");
  h.key("5"); assert.deepEqual(renderCocoFrame(session.machine), pixels, "presentation displays the picture without a brush cursor");
  h.breakKey(); h.key("2"); assert.match(h.screen(), /PREPARE RECORDER TO RECORD/);
  session.machine.pias.cassette.blank("ART.wav"); session.machine.pias.cassette.record(); h.key("\n");
  const wav = finishTransfer(h, "record", 600_000, menu), blocks = tapeBlocks(readCocoTapeWav(wav));
  assert.deepEqual(blocks.map(block => [block.type, block.data.length]), [[0, 1], ...Array.from({ length: 16 }, () => [1, 192]), [255, 0]]);
  assert.deepEqual(blocks[0]!.data, [0], "Art Gallery's colour-set header, not a standard BASIC filename header");
  assert.deepEqual(Uint8Array.from(blocks.filter(block => block.type === 1).flatMap(block => block.data)), picture);

  session.powerOn(); h.run(1_300_000); assert.ok(menu());
  assert.equal(session.machine.pias.cassette.inspect().mode, "stop");
  assert.ok(h.bytes(0x400, 3072).every(byte => byte === 0), "power-on erased the previous picture");
  session.machine.pias.cassette.insert("ART-saved.wav", readCocoTapeWav(wav));
  session.machine.pias.cassette.play(); h.key("3"); assert.match(h.screen(), /PREPARE RECORDER TO PLAY/); h.key("\n");
  finishTransfer(h, "play", 600_000, menu);
  assert.deepEqual(h.bytes(0x400, 3072), picture); assert.doesNotMatch(h.screen(), /READ ERROR/);
  h.key("5"); assert.deepEqual(renderCocoFrame(session.machine), pixels, "every displayed pixel survives export and cold reload");
});

test("EDTASM exports numbered source, cold-loads it, reassembles and runs it; recording and playback checkpoints retain continuation", { skip }, async () => {
  const h = await cartridge("edtasm-plus", "df2bcb8064eddc028847b5078851b6ec82005ce0d88616343a1f8c9de3d3f372"), { session } = h;
  const source = [" ORG $6000", "START LDA #42", " STA $6100", " SWI", " END START"];
  const listing = source.map((line, i) => `${100 + 10 * i}`.padStart(5, "0") + " " + line);
  const object = Uint8Array.of(0x86, 42, 0xb7, 0x61, 0, 0x3f);
  const prompt = () => !session.machine.pias.cassetteMotor && /\n\*$/.test(h.screen());
  h.key("I\n"); for (const line of source) h.key(line + "\n"); h.breakKey();
  function assembleAndRun(): void {
    h.key("A/IM/AO/NL\n"); h.until(prompt); h.run(50_000);
    assert.match(h.screen(), /00000 TOTAL ERRORS/); assert.deepEqual(h.bytes(0x6000, object.length), object);
    h.key("Z\n"); h.key("G6000\n");
    assert.equal(session.machine.ram.read(0x6100), 42); assert.match(h.screen(), /BRK @ START\+5/);
  }
  // W preserves source, not the assembled bytes. Save before execution as recommended by the manual.
  h.key("W ANSWER\n"); assert.match(h.screen(), /READY CASSETTE/);
  session.machine.pias.cassette.blank("ANSWER-source.wav"); session.machine.pias.cassette.record(); h.key("\n");
  const wav = finishTransfer(h, "record", 180_000, prompt);
  assert.deepEqual(tapeBlocks(readCocoTapeWav(wav)), [
    { type: 0, data: [...Buffer.from("ANSWER  "), 3, 255, 255, 0, 0, 0, 0] },
    { type: 1, data: [...Buffer.from(listing.join("\r") + "\r")] }, { type: 255, data: [] },
  ]);
  assembleAndRun();

  session.powerOn(); h.run(1_300_000); assert.ok(prompt());
  assert.equal(session.machine.pias.cassette.inspect().mode, "stop");
  assert.ok(h.bytes(0x6000, object.length).every(byte => byte === 0)); assert.equal(session.machine.ram.read(0x6100), 0);
  h.key("P\n"); assert.doesNotMatch(h.screen(), /START LDA|ORG \$6000/, "the new editor has no retained source");
  session.machine.pias.cassette.insert("ANSWER-source-saved.wav", readCocoTapeWav(wav));
  session.machine.pias.cassette.play(); h.key("L ANSWER\n"); assert.match(h.screen(), /READY CASSETTE/); h.key("\n");
  // The motor briefly stops between the header and data. Only the editor prompt completes the load.
  finishTransfer(h, "play", 180_000, prompt);
  h.key("P\n"); for (const line of listing) assert.ok(h.screen().includes(line), line);
  assert.ok(h.bytes(0x6000, object.length).every(byte => byte === 0), "loading text has not installed object code");
  assembleAndRun();
});
