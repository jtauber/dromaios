import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/6809/coco.js";
import { renderCocoFrame } from "../../src/machines/6809/coco/runtime.js";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import { cocoScreenText } from "../../site/interactive/coco-inspection.js";

const needsRom = !process.env.COCO_ROM && "Set COCO_ROM to Color BASIC 1.3.";
const chapter = readFileSync("src/machines/6809/coco.md", "utf8");
function example(heading: string): string[] {
  return chapter.split(`### ${heading}\n`)[1]!.match(/```text\n([^`]+)\n```/)![1]!.split("\n");
}

async function boot() {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware, digest);
  const session = createCocoSession(firmware);
  function run(count: number): void { for (let i = 0; i < count; i++) session.step(); }
  function line(text: string): void {
    session.send(cocoTextInput(text + "\n"));
    for (let i = 0; i < 4_000_000 && !session.inputSettled; i++) session.step();
    assert.equal(session.inputSettled, true); run(30_000);
  }
  run(720_000); assert.match(cocoScreenText(session.machine), /^COLOR BASIC 1\.3/);
  return { session, run, line };
}

test("Color BASIC converts independent joystick positions, endpoints and centre; JOYSTK(1–3) use its cache", { skip: needsRom }, async () => {
  const { session, line } = await boot(), io = session.machine.pias;
  io.connectJoystick("right", true); io.connectJoystick("left", true);
  const command = example("Check BASIC's readings")[0]!;
  for (const [rx, ry, lx, ly] of [[0, 63, 17, 46], [32, 32, 32, 32], [63, 0, 63, 0]] as const) {
    io.setJoystickPosition("right", rx, ry); io.setJoystickPosition("left", lx, ly);
    line(command);
    assert.ok(cocoScreenText(session.machine).replace(/\n█$/, "").endsWith(`\n ${rx}  ${ry}  ${lx}  ${ly}\nOK`));
  }
  io.setJoystickPosition("right", 7, 58); io.setJoystickPosition("left", 12, 43);
  line("PRINT JOYSTK(1);JOYSTK(2);JOYSTK(3)");
  assert.match(cocoScreenText(session.machine), /\n 0  63  0\nOK(?:\n█)?$/);
  line(command); assert.match(cocoScreenText(session.machine), /\n 7  58  12  43\nOK(?:\n█)?$/);
  io.connectJoystick("left", false);
  line(command); assert.match(cocoScreenText(session.machine), /\n 7  58  63  63\nOK(?:\n█)?$/);

  // Conversion shares the DAC and selectors with sound. The ROM must still
  // configure SOUND itself, with the connected joystick present throughout.
  session.send(cocoTextInput('SOUND 128,2:PRINT "DONE"\n'));
  let previous = io.soundLevel, edges = 0;
  for (let i = 0; i < 2_000_000; i++) {
    session.step(); const next = io.soundLevel; if (next !== previous) edges++; previous = next;
    if (i % 1000 === 0 && session.inputSettled && /\nDONE\nOK(?:\n█)?$/.test(cocoScreenText(session.machine))) break;
  }
  assert.match(cocoScreenText(session.machine), /\nDONE\nOK(?:\n█)?$/); assert.ok(edges > 100);
});

test("a BASIC PEEK loop observes both fire buttons and returns to the prompt after release and Break", { skip: needsRom }, async () => {
  const { session, line, run } = await boot(), io = session.machine.pias;
  io.connectJoystick("right", true); io.connectJoystick("left", true);
  line("10 POKE512,PEEK(65280) AND 3:GOTO10"); line("RUN");
  function awaitValue(expected: number): void {
    for (let i = 0; i < 100_000 && session.machine.ram.read(512) !== expected; i++) session.step();
    assert.equal(session.machine.ram.read(512), expected);
  }
  for (const [right, left, expected] of [[false, false, 3], [true, false, 2], [false, true, 1], [true, true, 0]] as const) {
    io.setJoystickButton("right", right); io.setJoystickButton("left", left); awaitValue(expected);
  }
  io.releaseJoystickButtons(); awaitValue(3);
  session.send([["Break"]]); run(50_000); assert.match(cocoScreenText(session.machine), /BREAK IN 10\nOK/);
});

test("the chapter's moving dot follows the right joystick, changes colour on fire, and restores mid-conversion", { skip: needsRom }, async () => {
  const { session, line } = await boot();
  session.machine.pias.connectJoystick("right", true);
  example("Move a dot with a joystick").forEach(line); line("RUN");
  function dot(x: number, y: number, colour: number): number {
    const address = 0x400 + (y >>> 1) * 32 + (x >>> 1), bit = 1 << (3 - (y % 2) * 2 - x % 2);
    for (let i = 0; i < 100_000; i++) {
      const record = session.step();
      if (!record.accesses.some(access => access.kind === "write" && access.address === address && access.value === (0x80 | colour << 4 | bit))) continue;
      const frame = renderCocoFrame(session.machine);
      for (let row = 0; row < 192; row++) for (let col = 0; col < 256; col++) {
        assert.equal(frame[row * 256 + col], col >= x * 4 && col < x * 4 + 4 && row >= y * 6 && row < y * 6 + 6 ? colour : 8);
      }
      return i + 1;
    }
    assert.fail(`No dot at ${x},${y} in palette colour ${colour}`);
  }
  dot(32, 16, 2);
  session.machine.pias.setJoystickPosition("right", 63, 0); dot(63, 0, 2);
  session.machine.pias.setJoystickPosition("right", 0, 63); dot(0, 31, 2);
  session.machine.pias.setJoystickButton("right", true); dot(0, 31, 3);
  session.machine.pias.setJoystickPosition("right", 12, 46);
  let converting = false;
  for (let i = 0; i < 100_000 && !converting; i++) {
    converting = session.step().accesses.some(access => access.kind === "write" && access.address === 0xff20);
  }
  assert.equal(converting, true);
  const saved = JSON.parse(JSON.stringify(session.snapshot()));
  const count = dot(12, 23, 3), result = session.snapshot();
  session.machine.pias.setJoystickPosition("right", 0, 0); session.machine.pias.releaseJoystickButtons();
  session.restore(saved); assert.equal(dot(12, 23, 3), count); assert.deepEqual(session.snapshot(), result);
});
