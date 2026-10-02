import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { compileMachine } from "../../../scripts/generate-machines.js";
import { create6502Apple2, romImages } from "../../../src/machines/generated/6502/apple2.js";
import { RomImage } from "../../../src/machines/rom-image.js";

async function fixture(t: TestContext) {
  const bytes = Uint8Array.from({ length: 0x3000 }, (_, i) => (i * 7 + Math.floor(i / 256)) & 255);
  bytes.set([0x00, 0x03], 0x2ffc);
  const digest = async (bytes: Uint8Array): Promise<string> => createHash("sha256").update(bytes).digest("hex");
  const sha256 = await digest(bytes), firmware = await RomImage.verify(bytes, { size: bytes.length, sha256 }, digest);
  const chapter = readFileSync("src/machines/6502/apple2.md", "utf8").replace(romImages.firmware.sha256, sha256);
  const generated = compileMachine(chapter, "6502/apple2.md").replace(/from "([^"]+)"/g,
    (_, path: string) => `from "${new URL(path, new URL("../../../src/machines/generated/6502/apple2.js", import.meta.url)).href}"`);
  const directory = mkdtempSync(join(tmpdir(), "dromaios-language-card-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(join(directory, "machine.ts"), generated);
  const { create6502Apple2: create } = await import(pathToFileURL(join(directory, "machine.ts")).href) as { create6502Apple2: typeof create6502Apple2 };
  return { machine: create({ firmware }), create: (state?: ReturnType<ReturnType<typeof create>["snapshot"]>) => create({ firmware }, state), bytes };
}

test("Apple II windows isolate both banks and share upper RAM, independently of ROM reads", async t => {
  const { machine, bytes, create } = await fixture(t);
  const { memory, language } = machine;
  // Power-on writes are enabled even though reads see ROM. Exercise every byte and boundary.
  for (let address = 0xd000; address <= 0xffff; address++) {
    assert.equal(memory.read(address), bytes[address - 0xd000]);
    memory.write(address, 0x22);
    assert.equal(memory.read(address), bytes[address - 0xd000]);
  }
  memory.read(0xc08a); memory.read(0xc089); // Bank 1, ROM read, first enable read only.
  const saved = machine.snapshot(), restored = create(saved);
  assert.deepEqual(restored.snapshot(), saved);
  memory.write(0xd000, 0xaa); assert.equal(machine.bank1.read(0), 0);
  memory.read(0x400); memory.write(0x400, 0x5a); // Outside controls: do not cancel PREWRITE.
  memory.read(0xc08d);
  assert.equal(language.ramWrite(), true);
  for (let address = 0xd000; address < 0xe000; address++) memory.write(address, 0x11);
  memory.read(0xc088); // Bank 1, RAM read, protected.
  for (let address = 0xd000; address <= 0xffff; address++) {
    assert.equal(memory.read(address), address < 0xe000 ? 0x11 : 0x22);
    memory.write(address, 0xff);
    assert.equal(memory.read(address), address < 0xe000 ? 0x11 : 0x22);
  }
  memory.read(0xc084); // Bank 2 alias, protected.
  for (let address = 0xd000; address <= 0xffff; address++) assert.equal(memory.read(address), 0x22);
  for (let i = 0; i < bytes.length; i++) assert.equal(machine.firmware.read(i), bytes[i]);
  restored.memory.read(0xc08f);
  restored.memory.write(0xd000, 0x99);
  assert.equal(restored.bank1.read(0), 0x99);
  assert.equal(machine.bank1.read(0), 0x11);
  assert.equal(saved.bank1[0], 0);
  assert.deepEqual(saved.language, { bank2: false, ram_read: false, ram_write: false, prewrite: true });
  const { upper, ...incomplete } = saved;
  assert.throws(() => create(incomplete as never), /Machine snapshot requires/);
});

test("a 6502 probe observes distinct banks, shared upper RAM, and writes behind ROM", async t => {
  const { machine, create } = await fixture(t);
  const program = [
    0x2c, 0x82, 0xc0, // BIT $C082: protect, read ROM, bank 2.
    0x2c, 0x81, 0xc0, 0x2c, 0x81, 0xc0, // Enable writes with two reads.
    0xa9, 0x52, 0x8d, 0x00, 0xd0, // Bank 2 <- $52 while reading ROM.
    0xa9, 0x73, 0x8d, 0x00, 0xe0, // Shared RAM <- $73.
    0x8d, 0x8b, 0xc0, // STA $C08B: bank 1 RAM read; keep write enable.
    0xa9, 0x31, 0x8d, 0x00, 0xd0, // Bank 1 <- $31.
    0xad, 0x00, 0xd0, 0x8d, 0x00, 0x04, // Read bank 1.
    0xad, 0x00, 0xe0, 0x8d, 0x01, 0x04, // Read common upper RAM.
    0x2c, 0x80, 0xc0, // Bank 2 protected, RAM read.
    0xad, 0x00, 0xd0, 0x8d, 0x02, 0x04, // Read bank 2.
    0xa9, 0xff, 0x8d, 0x00, 0xd0, // Protected write has no effect.
  ];
  program.forEach((byte, i) => machine.ram.write(0x300 + i, byte));
  machine.reset();
  machine.cpu.step(); machine.cpu.step(); // Snapshot between the two enabling reads.
  const resumed = create(machine.snapshot());
  const accesses = [];
  for (let steps = 0; machine.cpu.snapshot().pc < 0x300 + program.length && steps < 40; steps++) {
    const record = machine.cpu.step();
    assert.deepEqual(record, resumed.cpu.step());
    accesses.push(...record.accesses);
  }
  assert.equal(machine.cpu.snapshot().pc, 0x300 + program.length);
  assert.deepEqual([0, 1, 2].map(i => machine.ram.read(0x400 + i)), [0x31, 0x73, 0x52]);
  assert.equal(machine.bank2.read(0), 0x52);
  assert.ok(accesses.some(access => access.kind === "write" && access.address === 0xc08b && access.value === 0x73));
  assert.deepEqual(machine.snapshot(), resumed.snapshot());
  // CPU reset must fetch the currently selected RAM vector, preserving every card latch.
  machine.upper.write(0x1ffc, 0x34); machine.upper.write(0x1ffd, 0x12);
  const before = machine.snapshot();
  machine.reset();
  assert.equal(machine.cpu.snapshot().pc, 0x1234);
  assert.deepEqual(machine.language.snapshot(), before.language);
  assert.deepEqual(machine.snapshot().upper, before.upper);
  machine.memory.read(0xc082); machine.reset();
  assert.equal(machine.cpu.snapshot().pc, 0x300);
});
