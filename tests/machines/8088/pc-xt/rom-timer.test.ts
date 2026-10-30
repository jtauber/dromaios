import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { XtIo } from "../../../../src/machines/8088/pc-xt/io.js";
import { stepXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";

test("the original XT IRQ0 routine updates BIOS ticks and sends EOI after a real PIT request", {
  skip: !process.env.XT_BIOS_ROM && "Set XT_BIOS_ROM to the selected 11/08/82 XT BIOS image.",
}, () => {
  const bios = readFileSync(process.env.XT_BIOS_ROM!);
  assert.equal(bios.length, 8192);
  assert.equal(createHash("sha256").update(bios).digest("hex"),
    "2798f8a9a7dcab651ede40373d35269ad573b75acf811115c263e034ef80a1f2");
  const ram = new Ram(0x100000), io = new XtIo();
  const memory = { size: ram.size,
    read: (address: number) => address >= 0xfe000 ? bios[address - 0xfe000]! : ram.read(address),
    write: (address: number, value: number) => { if (address < 0xfe000) ram.write(address, value); },
  };
  const cpu = new Cpu8088(memory, {
    ax: 0x1122, bx: 0x3344, cx: 0x5566, dx: 0x7788, bp: 0x99aa, si: 0xbbcc, di: 0xddee,
    ds: 0x1234, es: 0x5678, ss: 0, sp: 0x8000, cs: 0, ip: 0x1000,
    flags: { cf: false, pf: false, af: false, zf: false, sf: false, tf: false, if: true, df: false, of: false },
    halted: false, waiting: false, interruptDeferred: false, recognitionDeferred: false, trapPending: false,
  }, { ports: {
    readPort: port => { const byte = io.read(port); assert.ok(typeof byte === "number"); return byte; },
    writePort: (port, value) => { assert.notEqual(io.write(port, value), "bus-error"); },
  } });
  // Isolated original-handler fixture, not POST. INT 1C uses the ROM's own dummy IRET.
  [0xa5, 0xfe, 0, 0xf0].forEach((byte, index) => ram.write(0x20 + index, byte));
  [0x53, 0xff, 0, 0xf0].forEach((byte, index) => ram.write(0x70 + index, byte));
  assert.equal(bios[0x1f53], 0xcf);
  ram.write(0x440, 10); // Keep the disk-motor stop path outside this timer fixture.
  ram.write(0x1000, 0xeb); ram.write(0x1001, 0xfe);
  io.write(0x43, 0x36); io.write(0x40, 0); io.write(0x40, 0); // Normal BIOS divisor 65536.
  io.write(0x20, 0x13); io.write(0x21, 8); io.write(0x21, 9); io.write(0x21, 0xfe);
  io.advanceOscillatorTicks(12); // Load on the first pulse.
  const before = cpu.snapshot(), machine = { cpu, io };
  for (let tick = 1; tick <= 3; tick++) {
    io.advanceOscillatorTicks(12 * 65536); // Supplied device interval; no inferred CPU timing.
    assert.equal(stepXtCpu(machine).outcome, "accepted");
    const outputs = []; let steps = 0;
    while (cpu.snapshot().cs !== 0 || cpu.snapshot().ip !== 0x1000) {
      const record = stepXtCpu(machine); assert.equal(record.outcome, "executed");
      outputs.push(...record.accesses.filter(access => access.kind === "output"));
      assert.ok(++steps < 200, "Original timer handler failed to return.");
    }
    assert.deepEqual(outputs, [{ kind: "output", port: 0x20, value: 0x20 }]);
    stepXtCpu(machine); // Consume the post-IRET instruction shadow with JMP $.
    assert.deepEqual(cpu.snapshot(), before);
    assert.equal(ram.read(0x46c), tick); assert.equal(ram.read(0x46d), 0); assert.equal(ram.read(0x440), 10 - tick);
    assert.equal(io.snapshot().pic.isr, 0); assert.equal(io.irq, false);
  }
});
