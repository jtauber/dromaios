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
const commands: number[] = [], controls: number[] = [];
let disketteInterrupts = 0;

before(async () => {
  if (!available) return;
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  bindings = {
    bios: await RomImage.verify(readFileSync(process.env.XT_BIOS_ROM!), romImages.bios, digest),
    basic: await RomImage.verify(readFileSync(process.env.XT_BASIC_ROM!), romImages.basic, digest),
    font: null,
  };
  const machine = create8088PcXt(bindings); machine.reset();
  for (let step = 0; step < 25000000; step++) {
    const { record } = stepTimedXtCpu(machine);
    if (record.outcome !== "executed" && record.outcome !== "accepted") assert.fail(`POST stopped at ${record.before.pc.toString(16)}`);
    if (record.outcome === "accepted" && record.vector === 14) disketteInterrupts++;
    assert.notEqual(record.after.pc, 0xfe58a, "Original POST entered the diskette 601 error path.");
    for (const access of record.accesses) if (access.kind === "output") {
      if (access.port === 0x3f2) controls.push(access.value);
      if (access.port === 0x3f5) commands.push(access.value);
    }
    if (record.after.pc === 0xfe597) { afterDiskettePost = machine.snapshot(); return; }
  }
  assert.fail("Original POST did not finish its diskette tests within the instruction budget.");
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
