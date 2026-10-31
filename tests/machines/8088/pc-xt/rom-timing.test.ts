import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { XtIo } from "../../../../src/machines/8088/pc-xt/io.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";
import { flags, initialState } from "../../../components/cpus/8088/helpers.js";

const optional = { skip: !process.env.XT_BIOS_ROM && "Set XT_BIOS_ROM to the selected 11/08/82 XT BIOS image." };
function fixture(ip: number) {
  const bios = readFileSync(process.env.XT_BIOS_ROM!);
  assert.equal(bios.length, 8192);
  assert.equal(createHash("sha256").update(bios).digest("hex"),
    "2798f8a9a7dcab651ede40373d35269ad573b75acf811115c263e034ef80a1f2");
  const ram = new Ram(0x100000), io = new XtIo();
  const memory = { size: ram.size,
    read: (address: number) => address >= 0xfe000 ? bios[address - 0xfe000]! : ram.read(address),
    write: (address: number, value: number) => { if (address < 0xfe000) ram.write(address, value); },
  };
  const cpu = new Cpu8088(memory, initialState({ ax: 0, bx: 0, cx: 0, dx: 0, cs: 0xf000, ds: 0, es: 0, ss: 0,
    ip, flags: flags(64) }), { ports: {
    readPort: port => { const byte = io.read(port); assert.ok(typeof byte === "number"); return byte; },
    writePort: (port, value) => { assert.notEqual(io.write(port, value), "bus-error"); },
  } });
  return { cpu, io, ram };
}

function runTo(machine: ReturnType<typeof fixture>, target: number, refreshes: number[] = []) {
  const records = [];
  for (let step = 0; step < 10000; step++) {
    if (machine.cpu.snapshot().cs === 0xf000 && machine.cpu.snapshot().ip === target) return records;
    const { record, refresh } = stepTimedXtCpu(machine); records.push(record);
    if (refresh) refreshes.push(refresh.address);
    assert.ok(record.outcome === "executed" || record.outcome === "accepted", `BIOS stopped at ${record.before.ip.toString(16)}`);
  }
  assert.fail("Original BIOS timing check did not reach its success exit.");
}

test("original XT channel-1 counter-bit test passes with instruction-driven time", optional, () => {
  // Enter after the CPU/RAM tests, with CX=BX=0; DMA is not involved in this counter test.
  const machine = fixture(0xe0e1), records = runTo(machine, 0xe10e);
  assert.equal(machine.cpu.snapshot().bl, 0);
  const reads = records.flatMap(record => record.accesses.flatMap(access => access.kind === "input" && access.port === 0x41 ? [access.value] : []));
  assert.ok(reads.length > 2); assert.ok(new Set(reads).size > 2);
  assert.equal(machine.io.oscillatorTicks, records.reduce((sum, record) => sum + record.clocks * 3, 0));
});

test("original XT DMA register test and refresh request check pass without ROM patches", optional, () => {
  // The prior counter-bit check programs channel 1; continue through DMA setup to its success exit.
  const machine = fixture(0xe0e1), refreshes: number[] = [];
  machine.io.write(8, 4); // Earlier BIOS instruction disables DMA before the timer test.
  const records = runTo(machine, 0xe165, refreshes);
  const inputs = records.flatMap(record => record.accesses.flatMap(access => access.kind === "input" ? [access] : []));
  for (let port = 0; port < 8; port++) {
    const reads = inputs.flatMap(access => access.port === port ? [access.value] : []);
    assert.deepEqual(reads, [0xff, 0xff, 0, 0]);
  }
  const status = inputs.filter(access => access.port === 8);
  assert.deepEqual(status.map(access => access.value), [0]);
  assert.ok(refreshes.length > 0);
  assert.deepEqual(refreshes, refreshes.map((_, index) => index));
  const dma = machine.io.snapshot().dma;
  assert.deepEqual(dma.mode, [0x58, 0x40, 0x40, 0x40]); assert.equal(dma.mask, 14);
  assert.equal(dma.base_address[0], 0); assert.equal(dma.base_count[0], 0xffff);
  assert.equal(dma.address[0], refreshes.length); assert.equal(dma.count[0], 0xffff - refreshes.length);
  assert.equal(machine.io.oscillatorTicks, records.reduce((sum, record) => sum + record.clocks * 3, 0) + refreshes.length * 12);
});

test("original XT channel-0 fast/slow IRQ test passes through the original POST interrupt handler", optional, () => {
  const machine = fixture(0xe35d);
  // Explicit post-initialization fixture, not a reset-to-POST claim. ROM D11 is the diagnostic ISR.
  [0x23, 0xff, 0, 0xf0].forEach((byte, index) => machine.ram.write(0x20 + index, byte));
  machine.io.write(0x20, 0x13); machine.io.write(0x21, 8); machine.io.write(0x21, 9); machine.io.write(0x21, 0xff);
  const records = runTo(machine, 0xe3a2);
  assert.equal(records.filter(record => record.outcome === "accepted").length, 1);
  assert.ok(records.some(record => record.before.ip === 0xff23));
  assert.ok(records.some(record => record.accesses.some(access => access.kind === "write" && access.address === 0x46b && access.value === 1)));
  assert.equal(machine.ram.read(0x46b), 0); // BIOS cleared the flag before the slower count.
  assert.equal(machine.io.snapshot().pic.imr, 0xff); assert.equal(machine.io.snapshot().pic.isr, 0);
  assert.equal(machine.io.snapshot().pit.channels[0].mode, 3);
  assert.equal(machine.io.oscillatorTicks, records.reduce((sum, record) => sum + record.clocks * 3, 0));
});
