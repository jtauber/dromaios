import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create6502Apple2, romImages } from "../../src/machines/generated/6502/apple2.js";
import { readApple2Rom, readApple2Disk } from "../../site/interactive/apple2-media.js";
import type { Apple2Media } from "../../site/interactive/apple2-media.js";
import { createApple2Session, apple2Input } from "../../site/interactive/apple2-session.js";

const media: Apple2Media = JSON.parse(readFileSync("src/machines/6502/apple2.md", "utf8").match(/```json\n([\s\S]*?)```/)![1]!);
function file(bytes: Uint8Array, name = "local file") {
  const buffer = new Uint8Array(bytes).buffer;
  return { name, size: buffer.byteLength, async arrayBuffer() { return buffer; } };
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("Apple II media checks whole containers, bootstrap slices, and selected disk identity before replacement", async () => {
  const bytes = new Uint8Array(20480);
  bytes.fill(0xa5, 1536, 1792); bytes.fill(0x42, 8192);
  const expected = { size: 12288, sha256: hash(bytes.subarray(8192)) };
  const synthetic: Apple2Media = { ...media, sha256: hash(bytes), bootstrap: { ...media.bootstrap, sha256: hash(bytes.subarray(1536, 1792)) } };
  const rom = await readApple2Rom(file(bytes), expected, synthetic);
  assert.equal(rom.image.createRom(expected).read(0), 0x42);
  assert.deepEqual(rom.bootstrap, new Array(256).fill(0xa5));
  assert.ok(Object.isFrozen(rom.bootstrap));
  assert.equal((await readApple2Rom(file(bytes.subarray(8192)), expected, synthetic)).bootstrap, undefined);
  await assert.rejects(readApple2Rom(file(bytes), expected, { ...synthetic, bootstrap: { ...synthetic.bootstrap, sha256: "0".repeat(64) } }), /bootstrap/);
  await assert.rejects(readApple2Rom(file(bytes), expected, { ...synthetic, bootstrap: { ...synthetic.bootstrap, offset: 20400 } }), /layout/);
  bytes[0] = 1; // Unmapped container bytes must still be authenticated.
  await assert.rejects(readApple2Rom(file(bytes), expected, synthetic), /SHA-256/);
  await assert.rejects(readApple2Disk(file(new Uint8Array(1)), media.disk), /143,360/);
  await assert.rejects(readApple2Disk(file(new Uint8Array(143360)), media.disk), /System Master/);
  const diskBytes = new Uint8Array(143360), selected = await readApple2Disk(file(diskBytes), { bytes: 143360, sha256: hash(diskBytes) });
  diskBytes[0] = 255; assert.equal(selected.disk.snapshot()[0], 0);
});

const romPath = process.env.APPLE2_ROM, diskPath = process.env.APPLE2_DISK;
test("native Disk II boots DOS, catalogues and loads HELLO, runs BASIC, and rejects SAVE", {
  skip: romPath === undefined || diskPath === undefined ? "Set APPLE2_ROM (20 KiB container) and APPLE2_DISK to the selected local media" : false,
}, async () => {
  assert.ok(romPath); assert.ok(diskPath);
  const rom = await readApple2Rom(file(readFileSync(romPath)), romImages.firmware, media);
  assert.ok(rom.bootstrap, "Disk acceptance needs the container's slot-6 bootstrap");
  const selected = await readApple2Disk(file(readFileSync(diskPath)), media.disk);
  const session = createApple2Session(rom.image, { bootstrap: rom.bootstrap, image: selected.disk });
  const machine = session.machine;
  const original = machine.disk.snapshot().media;
  // Independent Apple II page-one text rows, rather than the production video decoder.
  const rows = [0x400, 0x480, 0x500, 0x580, 0x600, 0x680, 0x700, 0x780,
    0x428, 0x4a8, 0x528, 0x5a8, 0x628, 0x6a8, 0x728, 0x7a8,
    0x450, 0x4d0, 0x550, 0x5d0, 0x650, 0x6d0, 0x750, 0x7d0];
  function screen(): string {
    return rows.map(start => Array.from({ length: 40 }, (_, column) => {
      const code = machine.ram.read(start + column) & 0x3f;
      return String.fromCharCode(code < 32 ? code + 64 : code);
    }).join("").trimEnd()).join("\n").trim();
  }
  let checkedResume = false;
  function waitForInput(limit = 10_000_000): void {
    let polls = 0;
    for (let steps = 0; steps < limit; steps++) {
      const record = session.step();
      assert.equal(record.outcome, "executed");
      if (!checkedResume && record.accesses.some(access => access.kind === "read" && access.address === 0xc0ec)) {
        checkedResume = true;
        const saved = machine.snapshot(), resumed = create6502Apple2({ firmware: rom.image }, saved);
        screen(); machine.disk.inspect(); assert.deepEqual(machine.snapshot(), saved);
        for (let step = 0; step < 1000; step++) assert.deepEqual(session.step(), resumed.cpu.step());
        assert.deepEqual(machine.snapshot(), resumed.snapshot());
      }
      // Start counting only after the final queued key has been acknowledged: KEYIN
      // still has to return that key to BASIC before it can execute the command.
      if (record.accesses.some(access => access.kind === "read" && access.address >= 0xc000 && access.address < 0xc010)) {
        polls = session.pendingInput || machine.keyboard.snapshot().strobe ? 0 : polls + 1;
      }
      if (polls >= 10 && session.pendingInput === 0 && !machine.keyboard.snapshot().strobe && record.after.pc >= 0xfd1b && record.after.pc <= 0xfd2f) return;
    }
    assert.fail(`No keyboard wait at PC ${machine.cpu.snapshot().pc.toString(16)}:\n${screen()}`);
  }
  function command(text: string): void { session.send(apple2Input(text + "\n")); waitForInput(); }
  waitForInput(60_000_000);
  assert.ok(checkedResume);
  assert.match(screen(), /DOS VERSION 3\.3\s+08\/25\/80/);
  assert.match(screen(), /LOADING INTEGER INTO LANGUAGE CARD/);
  assert.match(screen(), /\]$/);
  command("CATALOG");
  let catalogue = screen(), pages = 1;
  const prompt = () => machine.ram.read(0x24) === 1 && (machine.ram.read(rows[machine.ram.read(0x25)]!) & 0x7f) === 0x5d;
  while (!prompt() && pages < 5) { command(""); catalogue += "\n" + screen(); pages++; }
  assert.ok(prompt(), "Catalogue pagination must finish before the next command");
  assert.ok(pages > 1);
  assert.match(catalogue, /\*A 006 HELLO/); assert.match(catalogue, /\*A 009 COLOR DEMOSOFT/);
  command("NEW"); command("LOAD HELLO"); command("LIST");
  assert.match(screen(), /200\s+VTAB 10/);
  assert.match(screen(), /BLOAD INTBASIC,A\$D000/);
  for (const line of ["NEW", "20 END", "10 PRINT 2+3", "LIST", "RUN"]) command(line);
  assert.match(screen(), /\n10\s+PRINT 2\s*\+\s*3\n20\s+END/);
  assert.match(screen(), /\]RUN\n5\n/);
  command("SAVE TEST"); assert.match(screen(), /WRITE PROTECTED/);
  assert.deepEqual(machine.disk.snapshot().media, original);
  const before = machine.disk.snapshot(); session.reset(); assert.deepEqual(machine.disk.snapshot(), before);
  session.powerOn();
  assert.equal(session.machine.disk.inspect().position, 0);
  assert.equal(session.machine.disk.inspect().halfTrack, 0);
  assert.equal(session.machine.disk.inspect().motor, false);
  assert.deepEqual(session.machine.disk.snapshot().media, original);
  session.eject();
  assert.equal(session.machine.disk.inspect().loaded, false);
  session.powerOn(); assert.equal(session.machine.disk.inspect().installed, false, "Fresh power-on without media is ROM-only");
});
