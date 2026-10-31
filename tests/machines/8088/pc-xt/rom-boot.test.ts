import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { create8088PcXt, romImages } from "../../../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";

type Machine = ReturnType<typeof create8088PcXt>;
type Snapshot = ReturnType<Machine["snapshot"]>;
const available = Boolean(process.env.XT_BIOS_ROM && process.env.XT_BASIC_ROM);
const optional = { skip: !available && "Set XT_BIOS_ROM and XT_BASIC_ROM to the selected original firmware." };
let bindings: Parameters<typeof create8088PcXt>[0];
let afterDiskettePost: Snapshot;
let atBasicPrompt: Snapshot;
const commands: number[] = [], controls: number[] = [];
let disketteInterrupts = 0, keyboardInterrupts = 0;
let secondKeyboardReset = false, basicEntry = false;

function screen(machine: Machine): string[] {
  // BASIC also prints character FF, the blank nonbreaking-space glyph in the CGA ROM.
  return Array.from({ length: 25 }, (_, row) => String.fromCharCode(...Array.from({ length: 80 }, (_, column) =>
    machine.video.read((row * 80 + column) * 2)).map(code => code === 0xff ? 0x20 : code)).trimEnd());
}

function waitingForKey(machine: Machine): boolean {
  // Original INT 16h/AH=00 blocking loop, with its BIOS circular buffer empty.
  return machine.cpu.snapshot().pc === 0xfe842
    && machine.ram.read(0x41a) === machine.ram.read(0x41c)
    && machine.ram.read(0x41b) === machine.ram.read(0x41d);
}

before(async () => {
  if (!available) return;
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  bindings = {
    bios: await RomImage.verify(readFileSync(process.env.XT_BIOS_ROM!), romImages.bios, digest),
    basic: await RomImage.verify(readFileSync(process.env.XT_BASIC_ROM!), romImages.basic, digest),
    font: null,
  };
  const machine = create8088PcXt(bindings); machine.reset();
  for (let step = 0; step < 27000000; step++) {
    const { record } = stepTimedXtCpu(machine);
    if (record.outcome !== "executed" && record.outcome !== "accepted") assert.fail(`POST stopped at ${record.before.pc.toString(16)}`);
    if (record.outcome === "accepted" && record.vector === 14 && !afterDiskettePost) disketteInterrupts++;
    if (record.outcome === "accepted" && record.vector === 9) keyboardInterrupts++;
    assert.notEqual(record.after.pc, 0xfe58a, "Original POST entered the diskette 601 error path.");
    assert.notEqual(record.after.pc, 0xfe3d7, "Original POST entered the keyboard 301 error path.");
    if (record.after.pc === 0xfe3b7) {
      secondKeyboardReset = true;
      assert.notEqual(record.after.cx, 0, "The second keyboard reset must complete before the BIOS timeout.");
      assert.equal(record.after.bl, 0xaa);
    }
    for (const access of record.accesses) if (!afterDiskettePost && access.kind === "output") {
      if (access.port === 0x3f2) controls.push(access.value);
      if (access.port === 0x3f5) commands.push(access.value);
    }
    if (record.after.pc === 0xfe597) afterDiskettePost = machine.snapshot();
    if (record.after.pc === 0xf6000) basicEntry = true;
    if (basicEntry && waitingForKey(machine)) { atBasicPrompt = machine.snapshot(); return; }
  }
  assert.fail("Original firmware did not reach the ROM BASIC keyboard wait within the instruction budget.");
});

test("original XT firmware completes POST and empty-drive bootstrap into ROM BASIC without host input", optional, () => {
  assert.ok(afterDiskettePost); assert.ok(secondKeyboardReset); assert.ok(basicEntry);
  assert.equal(keyboardInterrupts, 2, "Each of POST's two keyboard resets must deliver one native IRQ1.");
  const machine = create8088PcXt(bindings, atBasicPrompt);
  assert.deepEqual(screen(machine).slice(0, 5), ["The IBM Personal Computer Basic", "Version C1.10 Copyright IBM Corp 1981",
    "62940 Bytes free", "Ok", ""]);
  assert.equal(machine.ram.read(0x441), 0x80); // Original bootstrap's final empty-drive read timed out.
  assert.equal(atBasicPrompt.io.diskette.phase, 3); assert.equal(atBasicPrompt.io.keyboard.full, false);
  assert.equal(atBasicPrompt.io.keyboard.self_test_pending, false);
});

// IBM's 83-key make/break codes: Shift+PRINT, space, 2, Shift+'=', 2, Enter.
// These are keyboard bytes, never characters injected into BIOS or BASIC RAM.
const printCodes = [0x2a, 0x19, 0x99, 0x13, 0x93, 0x17, 0x97, 0x31, 0xb1, 0x14, 0x94, 0xaa,
  0x39, 0xb9, 0x03, 0x83, 0x2a, 0x0d, 0x8d, 0xaa, 0x03, 0x83, 0x1c, 0x9c];

function finishInput(machine: Machine, remaining: readonly number[], batchSize: number) {
  const queue = [...remaining];
  let instructions = 0, interrupts = 0;
  while (instructions < 200000) {
    for (let batch = 0; batch < batchSize; batch++) {
      if (queue.length && machine.io.offerScanCode(queue[0]!)) queue.shift();
      const { record } = stepTimedXtCpu(machine); instructions++;
      assert.ok(record.outcome === "executed" || record.outcome === "accepted");
      if (record.outcome === "accepted" && record.vector === 9) interrupts++;
      if (!queue.length && waitingForKey(machine)) {
        assert.deepEqual(screen(machine).slice(3, 8), ["Ok", "PRINT 2+2", " 4", "Ok", ""]);
        return { instructions, interrupts };
      }
    }
  }
  assert.fail("ROM BASIC did not evaluate the keyboard input and return to its input wait.");
}

test("ROM BASIC evaluates native keyboard input and restores a pending key identically across execution batches", optional, () => {
  const machine = create8088PcXt(bindings, atBasicPrompt);
  assert.equal(machine.io.offerScanCode(printCodes[0]!), true);
  const pending = machine.snapshot(), remaining = printCodes.slice(1);
  assert.equal(pending.io.keyboard.full, true); assert.equal(pending.io.pic.irr & 2, 2);
  assert.equal(machine.io.offerScanCode(remaining[0]!), false, "An unconsumed key must not be overwritten.");
  assert.deepEqual(machine.snapshot(), pending);
  const result = finishInput(machine, remaining, 1);
  assert.equal(result.interrupts, printCodes.length);
  for (const batchSize of [37, 4096]) {
    const restored = create8088PcXt(bindings, pending);
    assert.deepEqual(finishInput(restored, remaining, batchSize), result);
    assert.deepEqual(restored.snapshot(), machine.snapshot());
  }
  assert.equal(machine.ram.read(0x417) & 3, 0, "Shift must be released in the BIOS keyboard flags.");
});

test("original XT diskette POST resets, specifies, recalibrates and seeks an empty drive through native IRQ6", optional, () => {
  assert.deepEqual(controls, [8, 12, 28, 12]);
  assert.deepEqual(commands, [8, 3, 0xcf, 2, 7, 0, 8, 15, 0, 1, 8, 15, 0, 34, 8]);
  assert.equal(disketteInterrupts, 4);
  assert.equal(afterDiskettePost.io.diskette.cylinder, 34); assert.equal(afterDiskettePost.io.diskette.pcn, 34);
  assert.equal(afterDiskettePost.io.diskette.dor, 12); assert.equal(afterDiskettePost.io.diskette.phase, 0);
  assert.equal(afterDiskettePost.io.pic.isr & 0x40, 0); assert.equal(afterDiskettePost.io.pic.levels & 0x40, 0);
  assert.equal(afterDiskettePost.ram[0x441], 0); assert.equal(afterDiskettePost.ram[0x442], 0x20);
  assert.equal(afterDiskettePost.ram[0x443], 34);
});

function caller(ax: number): Machine {
  // Run a small RAM caller after unmodified POST has built the IVT/BDA and devices.
  // MOV AX/BX/CX/DX, immediate; INT 13h; HLT. No BIOS data or handler is substituted.
  const machine = create8088PcXt(bindings, { ...afterDiskettePost, cpu: { ...afterDiskettePost.cpu,
    cs: 0x1000, ip: 0, ds: 0, es: 0, ss: 0, sp: 0x8000,
    flags: { ...afterDiskettePost.cpu.flags, if: true, df: false },
  } });
  [0xb8, ax & 255, ax >>> 8, 0xbb, 0, 0x7c, 0xb9, 1, 0, 0xba, 0, 0, 0xcd, 0x13, 0xf4]
    .forEach((byte, index) => machine.ram.write(0x10000 + index, byte));
  return machine;
}
function runCaller(machine: Machine, observe?: (machine: Machine) => void): void {
  for (let step = 0; step < 1500000; step++) {
    const { record } = stepTimedXtCpu(machine);
    assert.ok(record.outcome === "executed" || record.outcome === "accepted");
    observe?.(machine);
    if (record.after.cs === 0x1000 && record.after.ip === 14) return;
  }
  assert.fail("Original INT 13h did not return within the instruction budget.");
}

test("original INT 13h times out an empty read without a DMA transfer and resumes identically from the wait", optional, () => {
  const machine = caller(0x0201), buffer = afterDiskettePost.ram.slice(0x7c00, 0x7e00);
  let waiting: Snapshot | undefined;
  runCaller(machine, current => {
    if (!waiting && current.ports.readPort(0x3f4) === 0x10) waiting = current.snapshot();
  });
  assert.ok(waiting, "The BIOS must issue READ DATA and enter the no-index wait.");
  assert.equal(waiting.io.dma.address[2], 0x7c00); assert.equal(waiting.io.dma.count[2], 0x1ff);
  assert.equal(waiting.io.dma.mode[2], 0x44); assert.equal(waiting.io.dma.mask & 4, 0);
  const resumed = create8088PcXt(bindings, waiting); runCaller(resumed);
  assert.deepEqual(resumed.snapshot(), machine.snapshot());
  assert.equal(machine.cpu.snapshot().ah, 0x80); assert.equal(machine.cpu.snapshot().flags.cf, true);
  assert.equal(machine.ram.read(0x441), 0x80); assert.equal(machine.ports.readPort(0x3f4), 0x10);
  assert.equal(machine.io.snapshot().dma.address[2], 0x7c00); assert.equal(machine.io.snapshot().dma.count[2], 0x1ff);
  assert.equal(machine.io.snapshot().dma.terminal & 4, 0);
  assert.deepEqual(machine.snapshot().ram.slice(0x7c00, 0x7e00), buffer);
  assert.equal(machine.io.snapshot().diskette.interrupt, false);
});

test("original INT 13h reset drains the controller result and reprograms Specify", optional, () => {
  const machine = caller(0); runCaller(machine);
  assert.equal(machine.cpu.snapshot().ah, 0); assert.equal(machine.cpu.snapshot().flags.cf, false);
  const { diskette, pic } = machine.io.snapshot();
  assert.equal(diskette.phase, 0); assert.equal(diskette.interrupt, false); assert.equal(diskette.cylinder, 34);
  assert.equal(diskette.srt_hut, 0xcf); assert.equal(diskette.hlt, 2); assert.equal(pic.isr & 0x40, 0);
});
