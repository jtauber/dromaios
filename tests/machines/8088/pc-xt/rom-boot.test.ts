import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { create8088PcXt, romImages } from "../../../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";

import { enterLine, expectLastRows, runInput, scanCodes, screen, waitingForKey } from "./rom-console.js";

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

function caller(ax: number, cx = 1, dx = 0, es = 0): Machine {
  // Run a small RAM caller after unmodified POST has built the IVT/BDA and devices.
  // MOV AX/BX/CX/DX, immediate; INT 13h; HLT. No BIOS data or handler is substituted.
  const machine = create8088PcXt(bindings, { ...afterDiskettePost, cpu: { ...afterDiskettePost.cpu,
    cs: 0x1000, ip: 0, ds: 0, es, ss: 0, sp: 0x8000,
    flags: { ...afterDiskettePost.cpu.flags, if: true, df: false },
  } });
  installCall(machine, 0, ax, 0x7c00, cx, dx);
  return machine;
}
function installCall(machine: Machine, ip: number, ax: number, bx: number, cx: number, dx: number): void {
  [0xb8, ax & 255, ax >>> 8, 0xbb, bx & 255, bx >>> 8, 0xb9, cx & 255, cx >>> 8, 0xba, dx & 255, dx >>> 8, 0xcd, 0x13, 0xf4]
    .forEach((byte, index) => machine.ram.write(0x10000 + ip + index, byte));
}
function runCaller(machine: Machine, observe?: (machine: Machine, step: ReturnType<typeof stepTimedXtCpu>) => void, returnIp = 14): void {
  for (let step = 0; step < 1500000; step++) {
    const boundary = stepTimedXtCpu(machine), { record } = boundary;
    assert.ok(record.outcome === "executed" || record.outcome === "accepted");
    observe?.(machine, boundary);
    if (record.after.cs === 0x1000 && record.after.ip === returnIp) return;
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

test("original XT INT 13h reads a complete sector through DMA2 and IRQ6 and resumes from byte 256", optional, () => {
  const machine = caller(0x0201, 0x0203, 0x0100, 0x2000); // C=2, H=1, R=3 into ES:BX = 2000:7C00.
  const start = 0x27c00, image = new Uint8Array(368640);
  const sector = Uint8Array.from({ length: 512 }, (_, i) => (i * 13 + (i >>> 8) * 7 + 0x5a) & 255);
  image.set(sector, 47 * 512); // 18 sectors/cylinder, 9/side, one-based sector numbers.
  machine.io.setDiskette(image);
  machine.ram.write(start - 1, 0x3d); machine.ram.write(start + 512, 0x4e);
  let transferred = 0, completionIrqs = 0, calculatedSectors: number | undefined, midway: Snapshot | undefined;
  runCaller(machine, (current, { record, dma }) => {
    if (dma?.channel === 2) {
      assert.equal(dma.address, start + transferred); assert.equal(dma.value, sector[transferred]);
      if (++transferred === 256) midway = current.snapshot();
    }
    if (record.before.pc === 0xfefc4) calculatedSectors = record.before.al; // NUM_TRANS returning to the ROM caller.
    if (transferred === 512 && record.outcome === "accepted" && record.vector === 14) completionIrqs++;
  });
  assert.equal(transferred, 512); assert.equal(completionIrqs, 1);
  assert.ok(midway); assert.equal(midway.io.dma.count[2], 255);
  assert.deepEqual(midway.ram.slice(start, start + 256), Array.from(sector.slice(0, 256)));
  const end = machine.snapshot(), cpu = machine.cpu.snapshot();
  assert.equal(cpu.flags.cf, false); assert.equal(cpu.ah, 0);
  assert.equal(calculatedSectors, 1); assert.equal(cpu.al, 0); // The final GET_PARM clears AX before fetching the motor timeout.
  assert.deepEqual(end.ram.slice(start - 1, start + 513), [0x3d, ...sector, 0x4e]);
  assert.deepEqual(end.ram.slice(0x442, 0x449), [4, 0, 0, 2, 1, 4, 2]); // ROM's seven FDC result bytes.
  assert.equal(end.io.dma.address[2], 0x7e00); assert.equal(end.io.dma.count[2], 0xffff);
  assert.equal(end.io.dma.terminal & 4, 4); assert.equal(end.io.diskette.phase, 0);
  const resumed = create8088PcXt(bindings, midway); runCaller(resumed);
  assert.deepEqual(resumed.snapshot(), end);
});

test("original XT INT 13h writes exactly one sector through DMA2 and reads it into another buffer", optional, () => {
  const machine = caller(0x0301, 0x0203, 0x0100, 0x2000); // C=2, H=1, R=3; ES:BX=2000:7C00.
  const disk = new Uint8Array(360 * 1024).fill(0xa5), offset = 47 * 512;
  const sector = Uint8Array.from({ length: 512 }, (_, i) => (i * 29 + (i >>> 8) + 3) & 255);
  sector.forEach((byte, i) => machine.ram.write(0x27c00 + i, byte));
  machine.io.setDiskette(disk, { writable: true });
  const before = machine.io.snapshot().disketteImage!;
  let transferred = 0, completionIrqs = 0, midway: Snapshot | undefined;
  runCaller(machine, (current, { record, dma }) => {
    if (dma?.channel === 2) {
      assert.equal(dma.address, 0x27c00 + transferred); assert.equal(dma.value, sector[transferred]);
      if (++transferred === 256) midway = current.snapshot();
    }
    if (transferred === 512 && record.outcome === "accepted" && record.vector === 14) completionIrqs++;
  });
  assert.equal(transferred, 512); assert.equal(completionIrqs, 1);
  const end = machine.snapshot();
  assert.equal(end.cpu.flags.cf, false); assert.equal(machine.cpu.snapshot().ah, 0); assert.equal(end.ram[0x441], 0);
  assert.deepEqual(end.ram.slice(0x442, 0x449), [4, 0, 0, 2, 1, 4, 2]);
  assert.equal(end.io.dma.mode[2], 0x48); assert.equal(end.io.dma.terminal & 4, 4);
  assert.equal(end.io.dma.address[2], 0x7e00); assert.equal(end.io.dma.count[2], 0xffff);
  const expected = new Uint8Array(disk.length).fill(0xa5); expected.set(sector, offset);
  assert.deepEqual(Uint8Array.from(end.io.disketteImage!), expected);
  assert.ok(disk.every(byte => byte === 0xa5)); assert.ok(before.every(byte => byte === 0xa5));
  assert.ok(midway); assert.equal(midway.io.diskette.writable, true); assert.equal(midway.io.dma.count[2], 255);
  assert.deepEqual(midway.io.disketteImage!.slice(offset, offset + 257), [...sector.slice(0, 256), 0xa5]);
  const restored = create8088PcXt(bindings, midway); runCaller(restored);
  assert.deepEqual(restored.snapshot(), end);

  // Continue on the same drive. AH=02h fills a different ES:BX buffer from the written sector.
  installCall(machine, 14, 0x0201, 0x8000, 0x0203, 0x0100);
  runCaller(machine, undefined, 28);
  assert.equal(machine.cpu.snapshot().flags.cf, false); assert.equal(machine.cpu.snapshot().ah, 0);
  assert.deepEqual(machine.snapshot().ram.slice(0x28000, 0x28200), [...sector]);
});

test("original XT INT 13h reports BIOS error 03h on protected media without a channel-2 grant", optional, () => {
  const machine = caller(0x0301);
  const image = process.env.XT_DOS_DISK ? readFileSync(process.env.XT_DOS_DISK) : new Uint8Array(360 * 1024).fill(0xa5);
  machine.io.setDiskette(image);
  runCaller(machine, (_, { dma }) => assert.notEqual(dma?.channel, 2));
  const end = machine.snapshot();
  assert.equal(end.cpu.flags.cf, true); assert.equal(machine.cpu.snapshot().ah, 3); assert.equal(end.ram[0x441], 3);
  assert.equal(end.ram[0x443], 2); // ST1.Not Writable
  assert.equal(end.io.dma.count[2], 0x1ff);
  assert.deepEqual(end.io.disketteImage, [...image]);
});

test("original XT bootstrap reads sector one and executes it at 0000:7C00", optional, () => {
  const machine = create8088PcXt(bindings, afterDiskettePost), disk = new Uint8Array(368640);
  disk.set([0xb8, 0x88, 0x51, 0xf4]); // MOV AX,5188h; HLT
  disk.set([0x55, 0xaa], 510);
  machine.io.setDiskette(disk);
  let transferred = 0, bootstrap = false;
  for (let i = 0; i < 1500000; i++) {
    const { dma, record } = stepTimedXtCpu(machine);
    if (record.before.pc === 0xfe6f2) bootstrap = true;
    if (dma?.channel === 2) {
      assert.equal(dma.address, 0x7c00 + transferred); assert.equal(dma.value, disk[transferred++]);
    }
    if (record.before.pc === 0x7c00) {
      assert.equal(bootstrap, true); assert.equal(transferred, 512);
      assert.equal(record.before.cs, 0); assert.equal(record.after.ax, 0x5188);
      assert.deepEqual(machine.snapshot().ram.slice(0x7c00, 0x7e00), Array.from(disk.slice(0, 512)));
      return;
    }
  }
  assert.fail("The original XT bootstrap did not execute the mounted boot sector.");
});
