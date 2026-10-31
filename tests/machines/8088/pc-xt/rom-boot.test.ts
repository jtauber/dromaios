import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { create8088PcXt, romImages } from "../../../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";

import { enterLine, expectLastRows, runInput, scanCodes, screen, waitingForKey } from "./rom-basic-input.js";

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

test("ROM BASIC evaluates immediate commands and edits repeated, shifted input at the keyboard", optional, () => {
  const machine = create8088PcXt(bindings, atBasicPrompt);
  assert.equal(runInput(machine, printCodes).keyboardInterrupts, printCodes.length);
  expectLastRows(machine, "Ok", "PRINT 2+2", " 4", "Ok");
  enterLine(machine, "PRINT 2+3"); expectLastRows(machine, "PRINT 2+3", " 5", "Ok");
  enterLine(machine, "PRINT 77\b\b12"); expectLastRows(machine, "PRINT 12", " 12", "Ok");
  assert.equal(machine.ram.read(0x417) & 3, 0, "Shift must be released in the BIOS keyboard flags.");
});

const program = ["10 A=2", "20 A=A+3", "30 PRINT A"];
test("ROM BASIC lists, replaces, runs, and clears a stored program; pending input resumes identically", optional, () => {
  const machine = create8088PcXt(bindings, atBasicPrompt);
  for (const line of program) enterLine(machine, line);
  enterLine(machine, "LIST"); expectLastRows(machine, "LIST", ...program, "Ok");
  enterLine(machine, "RUN"); expectLastRows(machine, "RUN", " 5", "Ok");

  enterLine(machine, "20 A=A+4");
  enterLine(machine, "LIST"); expectLastRows(machine, "LIST", "10 A=2", "20 A=A+4", "30 PRINT A", "Ok");
  // R has already been echoed. U's make is pending in the receiver/PIC with Shift held;
  // the host still owns U's break, the Shift release, N, and Enter.
  runInput(machine, [...scanCodes("R"), 0x2a]);
  assert.equal(machine.io.offerScanCode(0x16), true);
  const remaining = [0x96, 0xaa, ...scanCodes("N\n")];
  const pending = machine.snapshot(), saved = JSON.stringify({ machine: pending, remaining });
  assert.equal(pending.io.keyboard.full, true); assert.equal(pending.io.pic.irr & 2, 2);
  assert.equal(machine.ram.read(0x417) & 2, 2);
  assert.equal(machine.io.offerScanCode(remaining[0]!), false);
  assert.throws(() => create8088PcXt({ ...bindings, basic: null }, pending), /identity/);
  assert.deepEqual(machine.snapshot(), pending);
  const result = runInput(machine, remaining, { batchSize: 1 });
  assert.equal(result.keyboardInterrupts, remaining.length + 1);
  expectLastRows(machine, "RUN", " 6", "Ok");
  for (const batchSize of [37, 4096]) {
    const session = JSON.parse(saved) as { machine: Snapshot; remaining: number[] };
    const restored = create8088PcXt(bindings, session.machine);
    assert.deepEqual(runInput(restored, session.remaining, { batchSize }), result);
    assert.deepEqual(restored.snapshot(), machine.snapshot());
  }

  enterLine(machine, "NEW"); enterLine(machine, "LIST"); expectLastRows(machine, "NEW", "Ok", "LIST", "Ok");
});

test("Ctrl-Break interrupts a running ROM BASIC program and the same session accepts another command", optional, () => {
  const machine = create8088PcXt(bindings, atBasicPrompt);
  enterLine(machine, "10 GOTO 10");
  runInput(machine, scanCodes("RUN\n"), { until: boundaries => boundaries >= 50_000 });
  assert.ok(!waitingForKey(machine));
  const ctrlBreak = [0x1d, 0x46, 0xc6, 0x9d];
  assert.equal(runInput(machine, ctrlBreak).keyboardInterrupts, ctrlBreak.length);
  expectLastRows(machine, "RUN", "^C", "Break in 10", "Ok");
  assert.equal(machine.ram.read(0x417) & 4, 0, "Ctrl must be released.");
  enterLine(machine, "PRINT 2+3"); expectLastRows(machine, "PRINT 2+3", " 5", "Ok");
});

test("CPU reset and fresh XT power-on have different effects on a live ROM BASIC session", optional, () => {
  const machine = create8088PcXt(bindings, atBasicPrompt);
  enterLine(machine, "10 GOTO 10");
  assert.equal(machine.io.offerScanCode(0x1d), true);
  const { cpu: original, ...board } = machine.snapshot();
  machine.cpu.reset();
  const { cpu: reset, ...retained } = machine.snapshot();
  assert.deepEqual(retained, board);
  assert.deepEqual([reset.cs, reset.ip], [0xffff, 0]); assert.equal(reset.flags.if, false);
  const fresh = create8088PcXt(bindings); fresh.reset();
  const powerOn = fresh.snapshot();
  assert.deepEqual([powerOn.cpu.cs, powerOn.cpu.ip], [0xffff, 0]);
  for (const register of ["ax", "bx", "cx", "dx", "sp", "bp", "si", "di"] as const) {
    assert.equal(reset[register], original[register]); assert.equal(powerOn.cpu[register], 0);
  }
  assert.ok(powerOn.ram.every(byte => byte === 0) && powerOn.video.every(byte => byte === 0));
  assert.equal(fresh.io.keyboardPending, false); assert.equal(fresh.io.oscillatorTicks, 0);
});

test("Ctrl-Alt-Del runs the original warm POST and starts a fresh BASIC workspace", optional, () => {
  const machine = create8088PcXt(bindings, atBasicPrompt);
  enterLine(machine, "10 GOTO 10");
  const ticks = machine.io.oscillatorTicks;
  runInput(machine, [0x1d, 0x38, 0x53], { until: () => machine.cpu.snapshot().pc === 0xfe05b });
  assert.deepEqual([machine.ram.read(0x472), machine.ram.read(0x473)], [0x34, 0x12]);
  assert.ok(machine.io.oscillatorTicks > ticks); // Firmware jumped; the host did not reset the board.
  runInput(machine, [], { limit: 5_000_000, until: () => machine.cpu.snapshot().pc === 0xf6000 });
  runInput(machine, []);
  assert.deepEqual(screen(machine).slice(0, 5), screen(create8088PcXt(bindings, atBasicPrompt)).slice(0, 5));
  // Release the three keys once POST has finished polling for stuck keys.
  runInput(machine, [0xd3, 0xb8, 0x9d]);
  assert.equal(machine.ram.read(0x417) & 0x0c, 0);
  enterLine(machine, "LIST"); expectLastRows(machine, "Ok", "LIST", "Ok");
  enterLine(machine, "PRINT 2+3"); expectLastRows(machine, "PRINT 2+3", " 5", "Ok");
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
