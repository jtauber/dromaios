import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/6809/coco.js";
import { cocoDisplayMode, renderCocoFrame } from "../../src/machines/6809/coco/runtime.js";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import { cocoScreenText, readCocoStorage } from "../../site/interactive/coco-inspection.js";

const needsRoms = !(process.env.COCO_ROM && process.env.COCO_EXTENDED_ROM)
  && "Set COCO_ROM and COCO_EXTENDED_ROM to Color BASIC 1.3 and Extended Color BASIC 1.1.";
async function images() {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware, digest);
  const extended = await RomImage.verify(readFileSync(process.env.COCO_EXTENDED_ROM!), romImages.extended, digest);
  return { firmware, extended };
}
function drive(session: ReturnType<typeof createCocoSession>) {
  function run(count: number): void { for (let i = 0; i < count; i++) session.step(); }
  function settle(): void {
    for (let i = 0; i < 3_000_000 && !session.inputSettled; i++) session.step();
    assert.equal(session.inputSettled, true); run(20_000);
  }
  return { run, settle,
    line(text: string): void { session.send(cocoTextInput(text + "\n")); settle(); },
    picture(): void {
      for (let i = 0; i < 3_000_000 && session.machine.vdg.alphaMode(session.machine.pias.videoPins); i++) session.step();
      run(20_000); assert.equal(cocoDisplayMode(session.machine).kind, "bitmap");
    },
  };
}

test("Extended BASIC boots the verified ROM pair and runs the chapter's drawing program without host graphics", { skip: needsRoms }, async () => {
  const { firmware, extended } = await images(), session = createCocoSession(null, extended), input = drive(session);
  const emptyBase = session.snapshot();
  assert.equal(session.hasFirmware, false); assert.throws(() => session.step(), /Load Color BASIC/);
  assert.throws(() => session.installFirmware(extended), /does not match/); assert.deepEqual(session.snapshot(), emptyBase);
  session.machine.ram.write(0x3456, 0x78); session.installFirmware(firmware); session.reset();
  assert.equal(session.machine.ram.read(0x3456), 0x78); assert.equal(session.machine.extended.loaded, true);
  assert.throws(() => createCocoSession(firmware, firmware), /does not match/);
  input.run(720_000);
  assert.match(cocoScreenText(session.machine), /^EXTENDED COLOR BASIC 1\.1\nCOPYRIGHT \(C\) 1982 BY TANDY\nUNDER LICENSE FROM MICROSOFT\n\nOK/);
  const chapter = readFileSync("src/machines/6809/coco.md", "utf8").split("## Draw with Extended Color BASIC\n")[1]!.split("\n## ")[0]!;
  const lines = chapter.match(/```text\n([^`]+)\n```/)![1]!.split("\n");
  assert.equal(lines.length, 10); lines.forEach(input.line); input.line("RUN"); input.picture();
  assert.deepEqual(cocoDisplayMode(session.machine), { kind: "bitmap", width: 128, height: 192, bitsPerPixel: 2 });
  assert.equal(session.machine.sam.displayStart(), 0x600);
  assert.equal(session.machine.sam.videoMode(), 6); assert.equal(session.machine.pias.videoPins & 0xf8, 0xe8);
  const frame = renderCocoFrame(session.machine), pixel = (x: number, y: number) => frame[y * 256 + x];
  assert.deepEqual([...new Set(frame)].sort(), [4, 5, 6, 7]);
  // The rectangular outline and centre point have exact independently specified coordinates.
  for (let x = 16; x <= 239; x++) { assert.equal(pixel(x, 16), 7); assert.equal(pixel(x, 175), 7); }
  for (let y = 16; y <= 175; y++) for (const x of [16, 17, 238, 239]) assert.equal(pixel(x, y), 7);
  for (const [x, y] of [[0, 0], [255, 191], [18, 18], [128, 95]]) assert.equal(pixel(x!, y!), 4);
  assert.equal(pixel(128, 96), 6); assert.equal(pixel(129, 96), 6);
  for (const [x, y] of [[80, 96], [176, 96], [128, 48], [128, 144]]) assert.equal(pixel(x!, y!), 5);
  assert.equal(readCocoStorage(session.machine, 0x8000), readFileSync(process.env.COCO_EXTENDED_ROM!)[0]);

  const saved = JSON.parse(JSON.stringify(session.snapshot())), restored = createCocoSession(firmware, extended);
  restored.restore(saved);
  for (let i = 0; i < 100; i++) assert.deepEqual(restored.step(), session.step());
  assert.deepEqual(restored.snapshot(), session.snapshot());
  const basicOnly = createCocoSession(firmware), before = basicOnly.snapshot();
  assert.throws(() => basicOnly.restore(saved), /Snapshot ROM identity/); assert.deepEqual(basicOnly.snapshot(), before);
  const stable = session.snapshot(); assert.throws(() => session.restore(before), /Snapshot ROM identity/);
  assert.deepEqual(session.snapshot(), stable);

  session.send(cocoTextInput(" ")); input.settle(); assert.equal(cocoDisplayMode(session.machine).kind, "text");
  input.line("PRINT 2+3"); assert.match(cocoScreenText(session.machine), /\n 5\nOK\n█$/);
  session.restore(saved); assert.deepEqual(renderCocoFrame(session.machine), frame);
  session.send(cocoTextInput(" ")); input.settle(); input.line("LIST");
  assert.match(cocoScreenText(session.machine), /80 IFINKEY\$=""THEN80/);
  session.reset(); assert.equal(session.machine.extended.loaded, true); assert.equal(session.machine.ram.read(0x600), 0);
  session.powerOn(); input.run(720_000); assert.match(cocoScreenText(session.machine), /^EXTENDED COLOR BASIC 1\.1/);
});

test("Extended BASIC's five PMODE settings drive the declared SAM/VDG modes and Break returns to BASIC", { skip: needsRoms }, async () => {
  const { firmware, extended } = await images(), session = createCocoSession(firmware, extended), input = drive(session);
  input.run(720_000);
  const modes = [
    [128, 96, 1, 3, 3], [128, 96, 2, 4, 4], [128, 192, 1, 5, 5], [128, 192, 2, 6, 6], [256, 192, 1, 6, 7],
  ] as const;
  for (const [pmode, [width, height, bits, sam, gm]] of modes.entries()) {
    input.line("NEW"); input.line(`10 PMODE${pmode},1:PCLS${bits === 2 ? 1 : 0}:SCREEN1,0`); input.line("20 GOTO20");
    input.line("RUN"); input.picture();
    assert.deepEqual(cocoDisplayMode(session.machine), { kind: "bitmap", width, height, bitsPerPixel: bits });
    assert.equal(session.machine.sam.videoMode(), sam); assert.equal(session.machine.vdg.graphicsMode(session.machine.pias.videoPins), gm);
    assert.deepEqual(renderCocoFrame(session.machine), new Uint8Array(256 * 192).fill(bits === 2 ? 0 : 8));
    session.send([["Break"]]); input.settle(); assert.match(cocoScreenText(session.machine), /BREAK IN 20\nOK/);
  }
});
