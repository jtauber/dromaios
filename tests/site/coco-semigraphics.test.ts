import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cocoDisplayMode, inspectCocoPixel, renderCocoFrame } from "../../src/machines/6809/coco/runtime.js";
import { createCocoDebugger } from "../../site/interactive/coco-debugger.js";
import { compareCocoScreens } from "../../site/interactive/coco-state-comparison.js";
import { catalogue6809 } from "./6809-inspection-fixture.js";
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
  until(() => session.machine.cpu.snapshot().pc === 0x7070, 100_000, 1);
  const drawing = session.snapshot();
  checkpoint.save(drawing);
  const interval = 100_000;
  function move(right: boolean) {
    if (right) session.send([["ArrowRight"]]);
    run(interval);
    const screen = compareCocoScreens(drawing.hardware, session.machine, "composite");
    return { state: session.snapshot(), pixels: frame(), changed: screen.changed };
  }
  const stationary = move(false); restore(); const moved = move(true);
  const changes: number[] = [];
  for (let i = 0; i < image.length; i++) if (stationary.pixels[i] !== moved.pixels[i]) changes.push(i);
  assert.deepEqual(changes, Array.from({ length: 8 }, (_, i) => 96 * 256 + 136 + i));
  assert.deepEqual(stationary.changed, []); assert.deepEqual(moved.changed, changes);
  const selected = moved.changed[0]!, x = selected % 256, y = Math.floor(selected / 256);

  const debug = createCocoDebugger(() => session.machine, catalogue6809, interval);
  debug.setBreakpoints([{ address: 0x7070, enabled: true }]);
  const yellow = { address: 0x1a11, byte: 0x9f, blockBit: 3, foreground: 1, colour: 1 };
  for (const right of [false, true]) {
    restore(); debug.reset();
    assert.deepEqual(inspectCocoPixel(session.machine, x, y), yellow);
    if (right) session.send([["ArrowRight"]]);
    debug.runUntilPixelChanges(x, y, "composite");
    const cursorWrites: number[][] = [];
    let steps = 0, record;
    while (!debug.beforeStep()) {
      record = debug.capture(() => session.step()); steps++;
      for (const access of record.accesses) if (access.kind === "write" && (access.address === 0x1a10 || access.address === 0x1a11)) {
        cursorWrites.push([record.before.pc, access.address, access.value]);
      }
    }
    assert.ok(steps > 0, "cross the initial keyboard poll");
    assert.deepEqual(cursorWrites, right ? [[0x71f6, 0x1a10, 0x9f], [0x713f, 0x1a11, 0xcf]] : []);
    if (right) {
      const hit = debug.pixelHit;
      assert.ok(record && hit);
      assert.equal(debug.stop?.kind, "event"); assert.equal(session.machine.cpu.snapshot().pc, 0x7143);
      assert.deepEqual(record.instruction, { address: 0x713f, bytes: [0xa7, 0x9d, 0xff, 0xa6] });
      assert.deepEqual(record.accesses.slice(-3), [
        { kind: "read", address: 0x70e9, value: 0x1a }, { kind: "read", address: 0x70ea, value: 0x11 },
        { kind: "write", address: 0x1a11, value: 0xcf },
      ]);
      assert.equal(hit.instruction, "STA [-90,PCR]"); assert.deepEqual(hit.before, yellow);
      assert.deepEqual(hit.after, { ...yellow, byte: 0xcf, foreground: 4, colour: 4 });
      assert.equal(frame()[96 * 256 + 136], 4);
    } else {
      assert.equal(debug.stop?.kind, "breakpoint"); assert.equal(session.machine.cpu.snapshot().pc, 0x7070);
      assert.equal(debug.pixelHit, undefined); assert.deepEqual(frame(), image);
    }
    run(interval - steps);
    assert.deepEqual(session.snapshot(), right ? moved.state : stationary.state);
  }
  debug.dispose();
  key("?"); run(300_000);
  assert.equal(session.machine.sam.videoMode(), 6, "help uses repeated glyph slices in SG24 too");
  assert.equal(session.machine.sam.displayStart(), 0x2600, "help switches physical display pages");
  assert.notDeepEqual(frame(), moved.pixels);
  assert.deepEqual(session.machine.disk.exportImage(), new Uint8Array(disk), "the supplied disk remains untouched");
});
