import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create6809CocoDisk, romImages } from "../../../../src/machines/generated/6809/coco-disk.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { stepCoco } from "../../../../src/machines/6809/coco/runtime.js";
import { cocoScreenText } from "../../../../site/interactive/coco-inspection.js";
import { cocoTextInput } from "../../../../site/interactive/coco-input.js";
import { createCocoKeyboardTransport } from "../../../../site/interactive/coco-keyboard-transport.js";
import { answerDisk } from "./disk-fixture.js";

const needsRoms = !(process.env.COCO_ROM && process.env.COCO_EXTENDED_ROM && process.env.COCO_DISK_ROM)
  && "Set COCO_ROM, COCO_EXTENDED_ROM and COCO_DISK_ROM for Disk BASIC 1.1 acceptance.";

test("Disk BASIC boots, lists and runs ANSWER through FF4B; mid-sector restore and ROM error paths", { skip: needsRoms }, async () => {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware, digest);
  const extended = await RomImage.verify(readFileSync(process.env.COCO_EXTENDED_ROM!), romImages.extended, digest);
  const dos = await RomImage.verify(readFileSync(process.env.COCO_DISK_ROM!), romImages.dos, digest);
  const bindings = { firmware, extended, dos }, image = answerDisk();
  let machine = create6809CocoDisk(bindings);
  machine.disk.mount(image); machine.reset();
  let input = createCocoKeyboardTransport(machine.pias, machine.clock.hertz!);
  let reads: number[] = [], commands: number[] = [], idle = 0, nmis = 0;
  function step() {
    input.beforeStep(); const start = machine.clock.ticks, record = stepCoco(machine);
    input.afterStep(machine.clock.ticks - start);
    if (record.idleClocks) idle++;
    if ("source" in record && record.source === "nmi") {
      nmis++;
      const disk = machine.disk.inspect();
      if (disk.command === 0x80 && disk.byte_index === 256 && disk.error === 0) {
        const offset = (disk.cylinder * 18 + disk.sector - 1) * 256;
        const ram = Array.from({ length: 256 }, (_, i) => machine.ram.read(record.before.x - 256 + i));
        assert.deepEqual(ram, [...image.slice(offset, offset + 256)], "all bytes, including the last, reached RAM before NMI");
      }
    }
    for (const access of record.accesses) {
      if (access.kind === "write" && access.address === 0xff48) commands.push(access.value);
      if (access.kind === "read" && access.address === 0xff4b) {
        assert.equal(record.before.pc, 0xd881); reads.push(access.value);
      }
    }
    return record;
  }
  function run(count: number): void { for (let i = 0; i < count; i++) step(); }
  function until(done: () => boolean, limit = 3_000_000): number {
    for (let count = 1; count <= limit; count++) { step(); if (done()) return count; }
    assert.fail(`Disk BASIC did not reach its stop: ${cocoScreenText(machine)}`);
  }
  function line(text: string, limit?: number): void {
    input.send(cocoTextInput(text + "\n"));
    until(() => input.settled); run(20_000);
    until(() => machine.disk.inspect().phase === 0 && /\nOK(?:\n█)?$/.test(cocoScreenText(machine)), limit);
  }
  function snapshot() { return { machine: machine.snapshot(), input: input.snapshot() }; }
  function restore(state: ReturnType<typeof snapshot>): void {
    machine = create6809CocoDisk(bindings, state.machine);
    input = createCocoKeyboardTransport(machine.pias, machine.clock.hertz!, state.input);
  }

  run(720_000);
  assert.match(cocoScreenText(machine), /^DISK EXTENDED COLOR BASIC 1\.1/);
  for (const offset of [0, 1, 0x123, 0x1eff]) assert.equal(machine.memory.read(0xc000 + offset), machine.memory.read(0xe000 + offset));
  const boot = snapshot();
  input.send(cocoTextInput("DIR\n"));
  until(() => reads.length === 128);
  const checkpoint = JSON.parse(JSON.stringify(snapshot())) as ReturnType<typeof snapshot>;
  assert.equal(checkpoint.machine.disk.circuit.phase, 3);
  assert.notEqual(checkpoint.machine.disk.microsecondPhase, 0);
  reads = []; commands = [];
  const count = until(() => input.settled && /ANSWER\s+BAS\s+0 A 1\nOK(?:\n█)?$/.test(cocoScreenText(machine)));
  const completed = snapshot(), remainingReads = reads, remainingCommands = commands;
  restore(checkpoint); reads = []; commands = []; run(count);
  assert.deepEqual(snapshot(), completed); assert.deepEqual(reads, remainingReads); assert.deepEqual(commands, remainingCommands);
  assert.equal((reads.length + 128) % 256, 0); assert.ok(idle > 0); assert.ok(nmis > 0);
  line('LOAD "ANSWER"'); line("LIST");
  assert.match(cocoScreenText(machine), /10 PRINT 42\n20 END\nOK/);
  line("RUN"); assert.match(cocoScreenText(machine), /RUN\n 42\nOK/);
  assert.ok(commands.includes(0x80), "the ROM issued single-sector Read commands");
  assert.deepEqual(reads.slice(-256), [...image.slice(0, 256)], "the file bytes came from physical track 0, sector 1");

  line('SAVE "DENIED"');
  assert.match(cocoScreenText(machine), /\?WP ERROR\nOK/);
  assert.deepEqual(machine.disk.snapshot().image, [...image]);
  restore(boot); machine.disk.mount(null); commands = [];
  line("DIR", 12_000_000);
  assert.match(cocoScreenText(machine), /\?IO ERROR\nOK/);
  assert.ok(commands.includes(0xd0), "the ROM aborted its empty-drive timeout with Force Interrupt");
});
