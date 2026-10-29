import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/6809/coco.js";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import { cocoScreenText, readCocoStorage } from "../../site/interactive/coco-inspection.js";

test("the browser session types, edits, saves, and resumes Color BASIC through the physical keyboard", {
  skip: !process.env.COCO_ROM && "Set COCO_ROM to the selected Color BASIC 1.3 image.",
}, async () => {
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware,
    async bytes => createHash("sha256").update(bytes).digest("hex"));
  const session = createCocoSession(firmware);
  function run(count: number): void { for (let i = 0; i < count; i++) assert.equal(session.step().outcome, "executed"); }
  function settle(): void {
    let budget = 600_000;
    while (!session.inputSettled && budget-- > 0) session.step();
    assert.equal(session.inputSettled, true); run(20_000);
  }
  function screen() { return cocoScreenText(session.machine); }
  function line(text: string, expected?: RegExp): void {
    session.send(cocoTextInput(text + "\n")); settle();
    if (expected) assert.match(screen(), expected);
  }
  run(720_000); assert.match(screen(), /^COLOR BASIC 1\.3\n\(C\) 1982 TANDY\nOK/);
  assert.equal(readCocoStorage(session.machine, 0xfffe), 0xa0);
  assert.equal(readCocoStorage(session.machine, 0xffff), 0x27);
  line("PRINT 2+3", /\n 5\nOK\n█$/);
  line("10 A=2"); line("20 PRINT A+3"); line("30 END");
  line("LIST", /LIST\n10 A=2\n20 PRINT A\+3\n30 END\nOK\n█$/);
  line("RUN", /\n 5\nOK\n█$/);

  // Capture mid-key, including host phase and PIA switches. Both machines must
  // continue identically, rather than merely reconstructing the same screenshot.
  session.send(cocoTextInput("20 PRINT A+4\n")); run(123);
  const saved = session.snapshot(), restored = createCocoSession(firmware);
  restored.restore(JSON.parse(JSON.stringify(saved)));
  for (let i = 0; i < 200; i++) assert.deepEqual(restored.step(), session.step());
  assert.deepEqual(restored.snapshot(), session.snapshot());
  session.restore(saved); settle(); line("RUN", /\n 6\nOK\n█$/);
  line("NEW"); line("LIST", /LIST\nOK\n█$/);
  session.send([...cocoTextInput("PRINT 2+4"), ["ArrowLeft"], ...cocoTextInput("3\n")]);
  settle(); assert.match(screen(), /PRINT 2\+3\n 5\nOK\n█$/);
  line("10 GOTO 10"); line("RUN");
  session.send([["Break"]]); settle(); assert.match(screen(), /BREAK IN 10\nOK\n█$/);
  line("PRINT 2+3", /\n 5\nOK\n█$/);
  const stable = session.snapshot();
  assert.throws(() => session.restore({ ...stable, hardware: { ...stable.hardware, firmware: null } }));
  assert.deepEqual(session.snapshot(), stable);
  session.machine.ram.write(0x4000, 0x5a); session.send([["A"]]); run(1);
  session.reset(); assert.equal(session.machine.ram.read(0x4000), 0x5a);
  assert.equal(session.machine.cpu.snapshot().pc, 0xa027); assert.equal(session.pendingInput, 0);
  session.powerOn(); assert.equal(session.hasFirmware, true); assert.equal(session.machine.ram.read(0x4000), 0);
});
