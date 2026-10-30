import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { XtIo } from "../../../../src/machines/8088/pc-xt/io.js";
import { stepXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";

test("the original XT ROM's IRQ1 handler translates make/break and Shift through native hardware", {
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
    readPort: port => { const byte = io.read(port); assert.equal(typeof byte, "number"); return byte as number; },
    writePort: (port, value) => { assert.notEqual(io.write(port, value), "bus-error"); },
  } });
  const machine = { cpu, io };
  for (const [port, value] of [[0x20, 0x13], [0x21, 8], [0x21, 9], [0x21, 0xfd], [0x63, 0x99], [0x61, 0x4c]] as const) {
    io.write(port, value);
  }
  // Isolated handler fixture, not POST: install IRQ1 and an empty BIOS keyboard buffer.
  [0x87, 0xe9, 0, 0xf0].forEach((byte, index) => ram.write(0x24 + index, byte));
  ram.write(0x41a, 0x1e); ram.write(0x41c, 0x1e);
  ram.write(0x1000, 0xeb); ram.write(0x1001, 0xfe); // JMP $: consume the post-IRET shadow.
  const cases = [
    { scan: 0x1e, flags: 0, tail: 0x20 }, { scan: 0x9e, flags: 0, tail: 0x20 },
    { scan: 0x2a, flags: 2, tail: 0x20 }, { scan: 0x1e, flags: 2, tail: 0x22 },
    { scan: 0x9e, flags: 2, tail: 0x22 }, { scan: 0xaa, flags: 0, tail: 0x22 },
  ];
  for (const { scan, flags, tail } of cases) {
    const before = cpu.snapshot();
    assert.equal(io.offerScanCode(scan), true);
    assert.equal(stepXtCpu(machine).outcome, "accepted");
    const transfers = [];
    let steps = 0;
    while (cpu.snapshot().cs !== 0 || cpu.snapshot().ip !== 0x1000) {
      const record = stepXtCpu(machine); assert.equal(record.outcome, "executed");
      transfers.push(...record.accesses.filter(access => access.kind === "input" || access.kind === "output"));
      assert.ok(++steps < 1000, "ROM keyboard handler did not return within its instruction bound.");
    }
    assert.deepEqual(transfers, [
      { kind: "input", port: 0x60, value: scan }, { kind: "input", port: 0x61, value: 0x4c },
      { kind: "output", port: 0x61, value: 0xcc }, { kind: "output", port: 0x61, value: 0x4c },
      { kind: "output", port: 0x20, value: 0x20 },
    ]);
    stepXtCpu(machine);
    assert.deepEqual(cpu.snapshot(), before);
    assert.equal(ram.read(0x417), flags); assert.equal(ram.read(0x41c), tail);
    assert.equal(io.snapshot().pic.isr, 0); assert.equal(io.keyboardPending, false);
  }
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => ram.read(0x41e + index)), [0x61, 0x1e, 0x41, 0x1e]);
});
