import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createRomNotes, romCheckpointPosition } from "../../site/interactive/apple2-rom-guide.js";
import type { Apple2RomGuide } from "../../site/interactive/apple2-rom-guide.js";
import { instructionCatalogue6502 } from "../../site/6502-instruction-catalogue.js";
import { families } from "../../src/components/cpus/semantics/generated/6502.js";
import { createInstructionDebugger } from "../../site/interactive/instruction-debugger.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { apple2DebugLocation, apple2DebugStep } from "../../site/interactive/apple2-debugger.js";
import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { readRomFile } from "../../site/interactive/rom-file.js";
import { apple2EditableMemory, editApple2Memory } from "../../site/interactive/apple2-memory-edit.js";
import { apple2StorageReader } from "../../site/interactive/apple2-inspection.js";

const guide: Apple2RomGuide = JSON.parse(readFileSync("docs/software/apple2p-rom.md", "utf8").match(/```json\n([\s\S]*?)```/)![1]!);
const instructions = instructionCatalogue6502(Object.values(families).flat());

test("ROM comments require the exact address, complete instruction bytes, and observed ROM mapping", () => {
  const comment = createRomNotes(guide.notes);
  const row = { address: 0xfbf2, bytes: [0x91, 0x28], complete: true, romMapped: true };
  assert.equal(comment(row), "Store the character at the row pointer plus the cursor column.");
  for (const changed of [{ address: 0xfbf3 }, { bytes: [0x91, 0x2a] }, { bytes: [0x91] },
    { bytes: [0x91, undefined] }, { bytes: [0x91, 0x28, 0] }, { romMapped: false }, { complete: false }]) {
    assert.equal(comment({ ...row, ...changed }), undefined);
  }
  assert.equal(comment({ ...row, romMapped: true }), comment(row), "Captured ROM mapping remains valid even after current mapping changes");
});

test("all authored comments describe a single instruction in the CPU catalogue", () => {
  for (const note of guide.notes) {
    const bytes = note.bytes.split(" ").map(byte => parseInt(byte, 16));
    assert.equal(instructions[bytes[0]!]!.length, bytes.length, note.address);
    assert.equal(createRomNotes(guide.notes)({ address: parseInt(note.address, 16), bytes, complete: true, romMapped: true }), note.text);
  }
});

test("checkpoint position reports only an available paused ROM boundary, not completion or an equivalent RAM address", () => {
  const checkpoint = guide.walkthroughs[0]!.steps[0]!;
  const at = { address: parseInt(checkpoint.address, 16), space: "rom" };
  assert.match(romCheckpointPosition(checkpoint, at, true, false), /^At checkpoint address.*Compare/);
  assert.match(romCheckpointPosition(checkpoint, { ...at, space: "lc-bank1" }, true, false), /^Paused.*lc-bank1/);
  assert.match(romCheckpointPosition(checkpoint, { ...at, address: 0x200 }, true, false), /^Paused at \$0200/);
  assert.match(romCheckpointPosition(checkpoint, at, false, false), /^Execution unavailable/);
  assert.match(romCheckpointPosition(checkpoint, undefined, true, false), /^Execution unavailable/);
  assert.match(romCheckpointPosition(checkpoint, at, true, true), /^Running/);
});

const romPath = process.env.APPLE2_ROM;
test("the guide's authored checkpoints reach reset, echo, carriage return, and scroll through the real ROM", {
  skip: romPath === undefined ? "Set APPLE2_ROM to the selected local firmware" : false,
}, async () => {
  const buffer = new Uint8Array(readFileSync(romPath!)).buffer;
  const container = JSON.parse(readFileSync("src/machines/6502/apple2.md", "utf8").match(/```json\n([\s\S]*?)```/)![1]!);
  const rom = await readRomFile({ name: "local ROM", size: buffer.byteLength, async arrayBuffer() { return buffer; } }, romImages.firmware, container);
  const session = createApple2Session(rom.image), debuggerState = createInstructionDebugger();
  const location = () => apple2DebugLocation(session.machine);
  function step() {
    const before = location(), record = session.step(); assert.equal(record.outcome, "executed");
    debuggerState.observe(apple2DebugStep(record, before, location(), instructions)); return record;
  }
  function checkpoint(tour: number, index: number): void {
    const checkpoint = guide.walkthroughs[tour]!.steps[index]!, address = parseInt(checkpoint.address, 16);
    debuggerState.runTo(location(), address, "rom");
    while (!debuggerState.beforeStep(location())) step();
    assert.equal(debuggerState.stop?.kind, "target", checkpoint.title);
    assert.equal(location().address, address); assert.equal(location().space, "rom");
  }
  // ROM bytes validate the authored comments independently of their renderers.
  const read = apple2StorageReader(session.machine);
  for (const note of guide.notes) {
    const bytes = note.bytes.split(" ").map(byte => parseInt(byte, 16));
    assert.deepEqual(bytes.map((_, i) => read(parseInt(note.address, 16) + i)), bytes, note.address);
  }
  for (let index = 0; index < 4; index++) checkpoint(0, index);
  session.send([65]); step(); step(); checkpoint(0, 4); step(); checkpoint(0, 5);
  const echo = step(); assert.equal(echo.instruction.address, 0xfbf2); assert.equal(session.machine.ram.read(0x501), 0xc1);
  checkpoint(0, 6);
  session.powerOn(); debuggerState.reset(); checkpoint(1, 0); session.send([13]);
  checkpoint(1, 1); assert.equal(session.machine.cpu.snapshot().a, 0x8d);
  checkpoint(1, 2); step(); step(); assert.equal(session.machine.ram.read(0x24), 0);
  checkpoint(1, 3); step(); assert.equal(session.machine.ram.read(0x25), 3);
  checkpoint(1, 4); assert.equal(session.machine.ram.read(0x25), 4);
  for (let line = 0; line < 9; line++) { session.send([13]); step(); checkpoint(2, 0); }
  assert.equal(session.machine.ram.read(0x25), 22);
  session.send([13]); checkpoint(2, 1); assert.equal(session.machine.ram.read(0x25), 23);
  checkpoint(2, 2); const copy = step();
  assert.ok(copy.accesses.some(access => access.kind === "write" && access.address === 0x427));
  checkpoint(2, 3); checkpoint(2, 4); const clear = step();
  assert.ok(clear.accesses.some(access => access.kind === "write" && access.address === 0x7d0 && access.value === 0xa0));
  checkpoint(2, 5); assert.equal(session.pendingInput, 0);
  session.powerOn(); debuggerState.reset(); checkpoint(3, 0);
  const saved = session.snapshot();
  checkpoint(3, 1);
  editApple2Memory(session.machine, apple2EditableMemory(session.machine)(0x24, 1), "08");
  const editedRam = [...saved.hardware.ram]; editedRam[0x24] = 8;
  assert.deepEqual(session.snapshot(), { ...saved, hardware: { ...saved.hardware, ram: editedRam } });
  assert.equal(session.machine.cpu.snapshot().y, 1, "The keyboard loop still holds the previous column");
  session.send([65]); checkpoint(3, 2); step();
  assert.equal(session.machine.cpu.snapshot().y, 8, "STORADV reloads CH");
  checkpoint(3, 3); const movedEcho = step();
  assert.ok(movedEcho.accesses.some(access => access.kind === "write" && access.address === 0x508 && access.value === 0xc1));
  assert.equal(session.machine.ram.read(0x501), 0xa0, "The old cursor cell was restored to a space");
  session.restore(saved); debuggerState.reset(); checkpoint(3, 4);
  assert.deepEqual(session.snapshot(), saved, "Restore returns the complete pre-edit experiment");
  session.send([65]); checkpoint(3, 2); step(); checkpoint(3, 3);
  const originalEcho = step();
  assert.ok(originalEcho.accesses.some(access => access.kind === "write" && access.address === 0x501 && access.value === 0xc1));
});
