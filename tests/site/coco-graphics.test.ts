import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/6809/coco.js";
import { cocoDisplayMode, renderCocoFrame } from "../../src/machines/6809/coco/runtime.js";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import { cocoScreenText } from "../../site/interactive/coco-inspection.js";

test("the guide's bitmap experiment runs entirely through Color BASIC, restores graphics, and returns to text", {
  skip: !process.env.COCO_ROM && "Set COCO_ROM to the selected Color BASIC 1.3 image.",
}, async () => {
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware,
    async bytes => createHash("sha256").update(bytes).digest("hex"));
  const session = createCocoSession(firmware);
  const chapter = readFileSync("src/machines/6809/coco.md", "utf8");
  const section = chapter.split("## Try bitmap graphics\n")[1]!.split("\n## ")[0]!;
  const commands = [...section.matchAll(/```text\n([^`]+)\n```/g)].map(match => match[1]!);
  assert.equal(commands.length, 6); assert.ok(commands.every(command => !command.includes("\n")));
  function run(count: number): void { for (let i = 0; i < count; i++) session.step(); }
  function line(command: string): void {
    session.send(cocoTextInput(command + "\n"));
    for (let i = 0; i < 3_000_000 && !session.inputSettled; i++) session.step();
    assert.equal(session.inputSettled, true); run(20_000);
  }
  run(720_000); assert.match(cocoScreenText(session.machine), /COLOR BASIC 1\.3\n\(C\) 1982 TANDY\nOK/);
  line(commands[0]!);
  // The ROM's interpreted fill loop is longer than a keyboard release gap.
  // Wait for the final store, then let NEXT finish and the prompt be printed.
  for (let i = 0; i < 5_000_000 && session.machine.ram.read(0x63ff) !== 27; i++) session.step();
  run(20_000);
  for (let address = 0x6000; address < 0x6400; address++) assert.equal(session.machine.ram.read(address), 27);
  assert.match(cocoScreenText(session.machine), /\nOK\n█$/);
  line(commands[1]!); assert.equal(session.machine.sam.displayStart(), 0x6000);
  line(commands[2]!);
  assert.deepEqual(cocoDisplayMode(session.machine), { kind: "bitmap", width: 64, height: 64, bitsPerPixel: 2 });
  function stripeFrame(colours: number[], width: number): Uint8Array {
    return Uint8Array.from({ length: 256 * 192 }, (_, i) => colours[Math.floor((i % 256) / width) % colours.length]!);
  }
  assert.deepEqual(renderCocoFrame(session.machine), stripeFrame([0, 1, 2, 3], 4));
  assert.equal(cocoScreenText(session.machine), "");
  line(commands[3]!); assert.deepEqual(renderCocoFrame(session.machine), stripeFrame([4, 5, 6, 7], 4));
  line(commands[4]!);
  assert.deepEqual(cocoDisplayMode(session.machine), { kind: "bitmap", width: 128, height: 64, bitsPerPixel: 1 });
  const resolution = stripeFrame([8, 8, 8, 4, 4, 8, 4, 4], 2);
  assert.deepEqual(renderCocoFrame(session.machine), resolution);
  const saved = JSON.parse(JSON.stringify(session.snapshot()));
  line(commands[5]!);
  assert.equal(cocoDisplayMode(session.machine).kind, "text"); assert.equal(session.machine.sam.displayStart(), 0x400);
  line("PRINT 2+3"); assert.match(cocoScreenText(session.machine), /\n 5\nOK\n█$/);
  session.restore(saved); assert.deepEqual(renderCocoFrame(session.machine), resolution);
  line(commands[5]!); line("PRINT 2+3"); assert.match(cocoScreenText(session.machine), /\n 5\nOK\n█$/);
});
