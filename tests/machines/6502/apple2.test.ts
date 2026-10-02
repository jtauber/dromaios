import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { compileMachine } from "../../../scripts/generate-machines.js";
import { create6502Apple2, romImages } from "../../../src/machines/generated/6502/apple2.js";
import { RomImage } from "../../../src/machines/rom-image.js";

test("the generated Apple II map boots synthetic ROM and records guest keyboard and storage transfers", async t => {
  const bytes = new Uint8Array(0x3000);
  bytes.set([
    0xad, 0x0f, 0xc0, // D000: LDA $C00F — keyboard alias.
    0x8d, 0x00, 0x04, // STA $0400 — retained screen character.
    0x8d, 0x1f, 0xc0, // STA $C01F — acknowledge alias.
    0x8d, 0x00, 0xd0, // STA $D000 — write RAM behind ROM at power-on.
    0xad, 0x00, 0xc1, // LDA $C100 — empty slot reads zero.
    0x4c, 0x00, 0xd0, // JMP $D000.
  ]);
  bytes.set([0x00, 0xd0], 0x2ffc);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const firmware = await RomImage.verify(bytes, { size: bytes.length, sha256 }, async bytes => createHash("sha256").update(bytes).digest("hex"));
  assert.throws(() => create6502Apple2({ firmware }), /does not match/);
  assert.throws(() => create6502Apple2({ firmware: {} as never }), /verified ROM/);

  // Compile the actual chapter with a distinct synthetic identity, never bypass verification.
  const chapter = readFileSync("src/machines/6502/apple2.md", "utf8").replace(romImages.firmware.sha256, sha256);
  const generated = compileMachine(chapter, "6502/apple2.md").replace(/from "([^"]+)"/g,
    (_, path: string) => `from "${new URL(path, new URL("../../../src/machines/generated/6502/apple2.js", import.meta.url)).href}"`);
  const directory = mkdtempSync(join(tmpdir(), "dromaios-apple2-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(join(directory, "machine.ts"), generated);
  const { create6502Apple2: create } = await import(pathToFileURL(join(directory, "machine.ts")).href) as { create6502Apple2: typeof create6502Apple2 };
  const machine = create({ firmware });
  assert.equal(machine.cpu.snapshot().pc, 0);
  const reads: number[] = [];
  const read = machine.memory.read.bind(machine.memory);
  machine.memory.read = address => { reads.push(address); return read(address); };
  machine.reset();
  assert.deepEqual(reads, [0xfffc, 0xfffd]);
  assert.equal(machine.cpu.snapshot().pc, 0xd000);
  assert.equal(machine.cpu.snapshot().sp, 0xfc);
  machine.keyboard.offer(0x41);
  assert.deepEqual(machine.cpu.step().accesses.at(-1), { kind: "read", address: 0xc00f, value: 0xc1 });
  const saved = machine.snapshot(), resumed = create({ firmware }, saved);
  for (let step = 0; step < 5; step++) assert.deepEqual(machine.cpu.step(), resumed.cpu.step());
  assert.deepEqual(machine.snapshot(), resumed.snapshot());
  assert.equal(machine.ram.read(0x400), 0xc1);
  assert.equal(machine.keyboard.snapshot().strobe, false);
  assert.equal(machine.firmware.read(0), 0xad);
  assert.equal(machine.bank2.read(0), 0xc1);
  assert.equal(machine.memory.read(0xc100), 0);
  assert.equal(machine.memory.read(0xffff), 0);
  machine.ram.write(0xbfff, 0x5a);
  machine.keyboard.offer(0x42);
  machine.reset();
  assert.equal(machine.ram.read(0xbfff), 0x5a);
  assert.deepEqual(machine.keyboard.snapshot(), { key: 0x42, strobe: true });
  assert.equal(resumed.keyboard.snapshot().strobe, false);
  assert.equal(saved.keyboard.strobe, true);
  assert.equal(saved.firmware, sha256);
  assert.throws(() => create({ firmware }, { ...saved, firmware: "0".repeat(64) }), /Snapshot ROM identity/);
  const { firmware: omitted, ...incomplete } = saved;
  assert.throws(() => create({ firmware }, incomplete as never), /Machine snapshot requires/);
  assert.throws(() => create({ firmware }, { ...saved, firmware: undefined } as never), /Machine snapshot requires/);

  // The same generated map attaches a slot-6 controller without special factory logic.
  assert.equal(machine.memory.read(0xc600), 0, "Uninstalled card is an empty slot");
  const bootstrap = new Uint8Array(256).fill(0xa5);
  machine.disk.install(bootstrap); bootstrap[0] = 0;
  assert.equal(machine.memory.read(0xc600), 0xa5);
  assert.equal(machine.memory.read(0xc6ff), 0xa5);
  machine.memory.write(0xc600, 0); assert.equal(machine.memory.read(0xc600), 0xa5);
  assert.equal(machine.memory.read(0xc500), 0); assert.equal(machine.memory.read(0xc700), 0);
  const io = create({ firmware }, { ...machine.snapshot(), cpu: { ...machine.cpu.snapshot(), pc: 0x200 } });
  [0xad, 0xe9, 0xc0, 0xad, 0xed, 0xc0, 0xad, 0xee, 0xc0].forEach((byte, i) => io.ram.write(0x200 + i, byte));
  assert.deepEqual(io.cpu.step().accesses.at(-1), { kind: "read", address: 0xc0e9, value: 0 });
  assert.equal(io.disk.inspect().motor, true);
  io.cpu.step();
  assert.deepEqual(io.cpu.step().accesses.at(-1), { kind: "read", address: 0xc0ee, value: 0x80 });
  const controller = io.disk.snapshot(); io.reset(); assert.deepEqual(io.disk.snapshot(), controller);
});
