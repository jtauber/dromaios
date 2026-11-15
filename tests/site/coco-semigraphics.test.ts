import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cocoDisplayMode, renderCocoFrame } from "../../src/machines/6809/coco/runtime.js";
import { cocoDisplayStatus } from "../../site/interactive/coco-inspection.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import { cocoBinaryFile } from "../helpers/coco-disk.js";
import { cocoSoftware, cocoSoftwareRoms, cocoHash } from "../helpers/coco-software.js";

const needsMedia = !(cocoSoftwareRoms && process.env.COCO_SEMIGRAPHICS_DISK)
  && "Set COCO_ROM, COCO_EXTENDED_ROM, COCO_DISK_ROM, and COCO_SEMIGRAPHICS_DISK for Gault's Sketcher.";

test("Semigraphics-24 Sketcher loads Saturn, moves its cursor, and replays loading and drawing checkpoints", { skip: needsMedia }, async () => {
  const disk = readFileSync(process.env.COCO_SEMIGRAPHICS_DISK!);
  assert.equal(cocoHash(disk), "754f298973aa454c44fafa178b627036ed95b523cbee3db1a6a8a93897108f7c");
  const picture = cocoBinaryFile(disk, "SATURN  S24");
  assert.deepEqual(picture.bytes.slice(0, 5), [0, 0x18, 0, 0x0e, 0]);
  assert.deepEqual(picture.bytes.slice(-5), [0xff, 0, 0, 0, 0]);
  const payload = Uint8Array.from(picture.bytes.slice(5, -5));
  assert.equal(payload.length, 6144);
  const { session, checkpoint, run, until, key, screen, bytes } = await cocoSoftware();
  const frame = () => renderCocoFrame(session.machine);
  function menu(): number {
    const count = until(() => screen().includes("(5) EXIT PROGRAM"));
    run(100_000); // Finish printing and reach the program's INKEY$ loop.
    return count + 100_000;
  }
  function answer(text: string, prompt: string): void {
    key(text); until(() => screen().includes(prompt)); run(20_000);
  }
  function restore(): void {
    session.powerOn(); session.mountDisk("replacement.dsk", new Uint8Array(disk.length));
    session.restore(checkpoint.read()!.state);
    assert.equal(session.diskName, "semigraphics-24.dsk");
    assert.equal(session.machine.disk.inspect().writable, false);
  }
  session.mountDisk("semigraphics-24.dsk", disk); run(720_000);
  key('RUN "S24"\n'); menu();
  answer("3", "WILL YOU USE <T>APE OR <D>ISK?");
  answer("D", "IS DISK READY <Y OR N>?");
  answer("Y", "DO YOU NEED A DIRECTORY LISTING?");
  answer("N", "ONLY NO EXTENSIONS?");
  session.send(cocoTextInput("SATURN\n"));
  until(() => {
    const drive = session.machine.disk.inspect();
    return drive.phase === 3 && drive.cylinder !== 17 && drive.byte_index === 128;
  }, undefined, 1);
  checkpoint.save(session.snapshot());
  assert.notDeepEqual(bytes(0x0e00, payload.length), payload);
  const remaining = menu(), loaded = session.snapshot();
  assert.deepEqual(bytes(0x0e00, payload.length), payload, "DOS delivered the original picture to its declared address");
  restore(); run(remaining); assert.deepEqual(session.snapshot(), loaded);

  key("1"); until(() => session.machine.sam.videoMode() === 6); run(100_000);
  assert.deepEqual(cocoDisplayMode(session.machine), { kind: "semigraphics", height: 192 });
  assert.equal(cocoDisplayStatus(session.machine), "SG24 · 64 × 192 · 8 colours + black · CSS 0 · $0E00");
  const image = frame();
  for (let colour = 0; colour < 9; colour++) assert.ok(image.includes(colour), `picture includes colour ${colour}`);
  checkpoint.save(session.snapshot());
  function move(right: boolean) {
    session.machine.pias.setKey("ArrowRight", right); run(100_000);
    session.machine.pias.setKey("ArrowRight", false);
    return { state: session.snapshot(), pixels: frame() };
  }
  const stationary = move(false); restore(); const moved = move(true);
  const changes: number[] = [];
  for (let i = 0; i < image.length; i++) if (stationary.pixels[i] !== moved.pixels[i]) changes.push(i);
  assert.ok(changes.length > 0, "the right arrow visibly moves the cursor");
  assert.ok(changes.every(i => i % 256 >= 128 && i % 256 < 144 && Math.floor(i / 256) === 96),
    "only the cursor's old/new positions change, at the centre of the picture");
  restore(); assert.deepEqual(move(true), moved, "checkpoint replay preserves CPU, RAM, devices, clocks and pixels");
  key("?"); run(300_000);
  assert.equal(session.machine.sam.videoMode(), 6, "help uses repeated glyph slices in SG24 too");
  assert.equal(session.machine.sam.displayStart(), 0x2600, "help switches physical display pages");
  assert.notDeepEqual(frame(), moved.pixels);
  assert.deepEqual(session.machine.disk.exportImage(), new Uint8Array(disk), "the supplied disk remains untouched");
});
