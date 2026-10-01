import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create6502Apple2, romImages } from "../../../src/machines/generated/6502/apple2.js";
import { RomImage } from "../../../src/machines/rom-image.js";

const romPath = process.env.APPLE2_ROM;
const digest = async (bytes: Uint8Array): Promise<string> => createHash("sha256").update(bytes).digest("hex");
// Apple II Reference Manual text-page map, independently transcribed by screen row.
const rows = [0x400, 0x480, 0x500, 0x580, 0x600, 0x680, 0x700, 0x780,
  0x428, 0x4a8, 0x528, 0x5a8, 0x628, 0x6a8, 0x728, 0x7a8,
  0x450, 0x4d0, 0x550, 0x5d0, 0x650, 0x6d0, 0x750, 0x7d0];

test("Apple II ROM boots natively and supports BASIC programs, editing, break, and snapshot continuation", {
  skip: romPath === undefined ? "Set APPLE2_ROM to the externally supplied Apple II Plus ROM" : false,
}, async () => {
  assert.ok(romPath);
  let bytes = readFileSync(romPath);
  if (bytes.length === 20480) {
    assert.equal(await digest(bytes), "92c4bef609920842ea472d21b661a0d35dbda6cd90963b8b734a205e22d84108", "Complete ROM container identity");
    bytes = bytes.subarray(0x2000, 0x5000);
  }
  const firmware = await RomImage.verify(bytes, romImages.firmware, digest);
  const machine = create6502Apple2({ firmware });
  machine.reset();
  assert.equal(machine.cpu.snapshot().pc, 0xfa62);

  function screen(): string {
    return rows.map(start => Array.from({ length: 40 }, (_, column) => {
      const code = machine.ram.read(start + column) & 0x3f;
      return String.fromCharCode(code < 32 ? code + 64 : code);
    }).join("").trimEnd()).join("\n").trim();
  }
  function waitForInput(): void {
    let polls = 0;
    for (let steps = 0; steps < 200_000; steps++) {
      const record = machine.cpu.step();
      polls += record.accesses.filter(access => access.kind === "read" && access.address >= 0xc000 && access.address < 0xc010).length;
      // This selected ROM's KEYIN polling loop. Observe completion; never trap or patch it.
      if (polls >= 10 && !machine.keyboard.snapshot().strobe && record.after.pc >= 0xfd1b && record.after.pc <= 0xfd2f) return;
    }
    assert.fail(`No keyboard wait at PC ${machine.cpu.snapshot().pc.toString(16)}:\n${screen()}`);
  }
  function type(text: string, waitAfterLast = true): void {
    for (const [index, character] of [...text].entries()) {
      assert.equal(machine.keyboard.offer(character.charCodeAt(0)), true);
      if (waitAfterLast || index < text.length - 1) waitForInput();
    }
  }
  function command(text: string): void { type(text + "\r"); }

  waitForInput();
  assert.match(screen(), /APPLE \]\[/);
  assert.match(screen(), /\]$/);
  for (const line of ["NEW", "20 END", "10 PRINT 2+3", "LIST"]) command(line);
  assert.match(screen(), /\n10\s+PRINT 2\s*\+\s*3\n20\s+END\n/);
  // Follow the stored BASIC line links, independent of both typed echoes and LIST rendering.
  const word = (address: number): number => machine.ram.read(address) + 256 * machine.ram.read(address + 1);
  const first = word(0x67), second = word(first), end = word(second);
  assert.equal(first, 0x801);
  assert.equal(word(first + 2), 10);
  assert.equal(word(second + 2), 20);
  assert.equal(word(end), 0);

  machine.keyboard.offer(0x52); // An unconsumed R must survive snapshot and inspection.
  const saved = machine.snapshot(), resumed = create6502Apple2({ firmware }, saved);
  assert.deepEqual(machine.snapshot(), saved);
  assert.deepEqual(resumed.snapshot(), saved);
  for (let step = 0; step < 500; step++) assert.deepEqual(machine.cpu.step(), resumed.cpu.step());
  assert.deepEqual(machine.snapshot(), resumed.snapshot());
  waitForInput(); type("UN\r");
  assert.match(screen(), /\]RUN\n5\n/);
  assert.notDeepEqual(machine.snapshot(), resumed.snapshot());

  command("PRINT 2+9\b3"); // Left arrow/backspace removes 9; Applesoft evaluates 2+3.
  assert.match(screen(), /\]PRINT 2\+3\n5\n/);
  for (const line of ["NEW", "10 GOTO 10"]) command(line);
  type("RUN\r", false);
  // Wait for the running line's break checks, not an arbitrary delay during RUN setup.
  let loopPolls = 0;
  for (let steps = 0; steps < 200_000 && loopPolls < 10; steps++) {
    const record = machine.cpu.step();
    if (word(0x75) === 10 && record.accesses.some(access => access.kind === "read" && access.address === 0xc000)) loopPolls++;
  }
  assert.equal(loopPolls, 10, "Applesoft has entered the line-10 loop before Control-C");
  assert.equal(machine.keyboard.snapshot().strobe, false);
  type("\x03");
  assert.match(screen(), /BREAK IN 10/);
  command("PRINT 1+1");
  assert.match(screen(), /\]PRINT 1\+1\n2\n/);
});
