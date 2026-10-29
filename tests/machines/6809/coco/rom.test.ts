import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create6809Coco, romImages } from "../../../../src/machines/generated/6809/coco.js";
import { renderCocoFrame, stepCoco } from "../../../../src/machines/6809/coco/runtime.js";
import type { CocoKey } from "../../../../src/machines/6809/coco/keyboard.js";
import { RomImage } from "../../../../src/machines/rom-image.js";

test("native CoCo boots verified Color BASIC, edits and runs programs, and resumes after Break", {
  skip: !process.env.COCO_ROM && "Set COCO_ROM to the selected Color BASIC 1.3 image.",
}, async () => {
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware,
    async bytes => createHash("sha256").update(bytes).digest("hex"));
  let machine = create6809Coco({ firmware, extended: null }); machine.reset();
  assert.equal(machine.cpu.snapshot().pc, 0xa027);
  let instructions = 0;
  function run(count: number): void {
    for (let i = 0; i < count; i++) {
      assert.equal(stepCoco(machine).outcome, "executed"); instructions++;
    }
  }
  function screen(): string {
    return Array.from({ length: 16 }, (_, row) => Array.from({ length: 32 }, (_, column) => {
      const byte = machine.ram.read(machine.sam.displayAddress(row, column));
      return machine.vdg.semigraphics(byte) ? "#" : String.fromCharCode(machine.vdg.characterCode(byte));
    }).join("").trimEnd()).join("\n").trimEnd();
  }
  const shifted: Readonly<Record<string, CocoKey>> = { "+": ";", "=": "-" };
  const special: Readonly<Record<string, CocoKey>> = { "\n": "Enter", "\b": "ArrowLeft", "\x1b": "Break", " ": "Space" };
  function key(character: string): void {
    const physical = shifted[character] ?? special[character] ?? (character as CocoKey);
    if (shifted[character]) machine.pias.setKey("Shift", true);
    machine.pias.setKey(physical, true); run(12_000);
    machine.pias.setKey(physical, false);
    if (shifted[character]) machine.pias.setKey("Shift", false);
    run(12_000);
  }
  function line(text: string, expected?: RegExp): void {
    for (const character of text + "\n") key(character);
    run(20_000);
    if (expected) assert.match(screen(), expected);
    const before = machine.snapshot();
    assert.equal(renderCocoFrame(machine).length, 256 * 192);
    assert.deepEqual(machine.snapshot(), before);
  }
  run(720_000);
  assert.match(screen(), /^COLOR BASIC 1\.3\n\(C\) 1982 TANDY\nOK/);
  assert.equal(machine.sam.memoryMode(), 1); assert.equal(machine.sam.page(), true);
  assert.equal(machine.sam.videoMode(), 0); assert.equal(machine.sam.displayStart(), 0x400);
  line("PRINT 2+3", /\n 5\nOK\n#$/);
  line("10 A=2"); line("20 PRINT A+3"); line("30 END");
  line("LIST", /LIST\n10 A=2\n20 PRINT A\+3\n30 END\nOK\n#$/);
  line("RUN", /\n 5\nOK\n#$/);

  // Restore a live interpreter and continue on the restored native hardware.
  const saved = machine.snapshot(), restored = create6809Coco({ firmware, extended: null }, saved);
  for (let i = 0; i < 100; i++) assert.deepEqual(stepCoco(restored), stepCoco(machine));
  assert.deepEqual(restored.snapshot(), machine.snapshot()); machine = create6809Coco({ firmware, extended: null }, saved);

  line("20 PRINT A+4"); line("RUN", /\n 6\nOK\n#$/);
  line("NEW"); line("LIST", /LIST\nOK\n#$/);
  line("PRINT 2+4\b3", /PRINT 2\+3\n 5\nOK\n#$/);
  line("10 GOTO 10"); line("RUN", /10 GOTO 10\nRUN$/);
  key("\x1b"); run(20_000); assert.match(screen(), /BREAK IN 10\nOK\n#$/);
  line("PRINT 2+3", /\n 5\nOK\n#$/);
  assert.equal(instructions, 3_660_000);
});
