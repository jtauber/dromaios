import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { XtIo } from "../../../../src/machines/8088/pc-xt/io.js";
import { stepXtCpu, stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";
import { flags, initialState } from "../../../components/cpus/8088/helpers.js";

function fixture(recognitionDeferred = false) {
  const ram = new Ram(0x100000), io = new XtIo();
  ram.write(0x100, 0x90); ram.write(0x101, 0x90); // NOPs end recognition shadows.
  [0, 2, 0, 0].forEach((byte, i) => ram.write(8 + i, byte)); // NMI -> 0000:0200
  ram.write(0x200, 0xcf); // IRET
  const cpu = new Cpu8088(ram, initialState({ cs: 0, ip: 0x100, ss: 0, sp: 0x800, flags: flags(64), recognitionDeferred }));
  io.write(0x63, 0x99); io.write(0x61, 0x40);
  io.write(0x20, 0x13); io.write(0x21, 8); io.write(0x21, 9); io.write(0x21, 0xfd);
  io.offerScanCode(0x1e);
  io.write(0xa0, 0x80); io.setCheckErrors(true, false);
  return { cpu, io, ram };
}

for (const timed of [false, true]) test(`XT ${timed ? "timed" : "untimed"} entry prioritizes NMI without consuming IRQ1 or a deferred edge`, () => {
  const machine = fixture(true);
  const step = () => timed ? stepTimedXtCpu(machine).record : stepXtCpu(machine);
  assert.equal(step().outcome, "executed");
  assert.equal(machine.io.nmiPending, true); assert.equal(machine.io.irq, true);
  const entered = step(); assert.equal(entered.outcome, "accepted");
  assert.ok("source" in entered); assert.equal(entered.source, "nmi"); assert.equal(entered.vector, 2);
  assert.equal(machine.cpu.snapshot().ip, 0x200);
  assert.equal(machine.io.nmiPending, false); assert.equal(machine.io.irq, true);
  assert.equal(machine.io.snapshot().pic.isr, 0);
  assert.equal(step().outcome, "executed"); // IF=0 while the handler returns.
  assert.equal(machine.cpu.snapshot().interruptDeferred, true); // IRET's IF transition defers INTR one instruction.
  assert.equal(step().outcome, "executed");
  const irq = step(); assert.ok("source" in irq); assert.equal(irq.source, "intr"); assert.equal(irq.vector, 9);
  assert.equal(machine.io.nmiPending, false); // The parity input is still high.
});

test("XT check status follows PPI wiring; CPU reset preserves the board and board reset clears it", () => {
  const machine = fixture(), { io, cpu } = machine;
  assert.equal(io.read(0xa0), "bus-error"); assert.equal(io.read(0x62) & 0xc0, 0x80);
  const saved = io.snapshot(), restored = new XtIo(saved);
  assert.deepEqual(restored.snapshot(), saved);
  assert.throws(() => new XtIo({ ...saved, system: { ...saved.system, control: 0x41 } }), /wiring/);
  restored.write(0x61, 0x50); assert.equal(restored.read(0x62) & 0xc0, 0);
  assert.equal(restored.nmiPending, true);
  cpu.reset(); assert.deepEqual(io.snapshot(), saved);
  io.reset(); assert.equal(io.nmiPending, false); assert.equal(io.snapshot().system.enabled, false);
  io.write(0x63, 0x99); assert.equal(io.read(0x62) & 0xc0, 0);
});
