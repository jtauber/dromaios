import assert from "node:assert/strict";
import { test } from "node:test";
import { XtIo } from "../../../../src/machines/8088/pc-xt/io.js";
import { create8088PcXt } from "../../../../src/machines/generated/8088/pc-xt.js";
import { advanceXtOscillatorTicks, stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";

function fixture() {
  const machine = create8088PcXt({ bios: null, basic: null, font: null });
  // Single PIC, base vector 8, mask everything except IRQ6.
  for (const [port, byte] of [[0x20, 0x13], [0x21, 8], [0x21, 9], [0x21, 0xbf]] as const) machine.ports.writePort(port, byte);
  return machine;
}

test("XT diskette ports, clock phase, controller acknowledgement and PIC EOI remain separate", () => {
  const machine = fixture(), { ports, io } = machine;
  ports.writePort(0x3f2, 0x0c);
  advanceXtOscillatorTicks(machine, 29323); // floor(ticks / 14.31818) = 2047 us.
  assert.equal(io.irq, false); assert.equal(ports.readPort(0x3f4), 0);
  const saved = machine.snapshot(), resumed = create8088PcXt({ bios: null, basic: null, font: null }, saved);
  for (const current of [machine, resumed]) {
    advanceXtOscillatorTicks(current, 1); // Exactly crosses the 2048-us boundary.
    assert.equal(current.io.irq, true); assert.equal(current.io.acknowledge(), 14);
    assert.equal(current.io.snapshot().diskette.interrupt, true);
    current.ports.writePort(0x20, 0x20); assert.equal(current.io.irq, false); // No new edge while FDC stays high.
    current.ports.writePort(0x3f5, 8);
    assert.equal(current.io.snapshot().pic.levels & 0x40, 0);
    assert.equal(current.ports.readPort(0x3f5), 0xc0); assert.equal(current.ports.readPort(0x3f5), 0);
    assert.equal(current.ports.readPort(0x3f4), 0x80);
    current.ports.writePort(0x3f2, 8); current.ports.writePort(0x3f2, 0x0c);
    advanceXtOscillatorTicks(current, 29324); assert.equal(current.io.irq, true);
  }
  assert.deepEqual(resumed.snapshot(), machine.snapshot());
  const pending = io.snapshot();
  assert.throws(() => new XtIo({ ...pending, pic: { ...pending.pic, levels: pending.pic.levels ^ 0x40 } }), /wiring/);
  assert.throws(() => io.setInterruptLine(6, false), /belong/);
});

test("XT timed CPU and halt boundaries deliver native IRQ6 without DMA activity or hidden memory writes", () => {
  const machine = fixture(), { ports, io, ram } = machine;
  // CLI; MOV SP,8000; STI; HLT; HLT. IRQ6 handler: IRET (controller remains pending).
  [0xfa, 0xbc, 0, 0x80, 0xfb, 0xf4, 0xf4].forEach((byte, i) => ram.write(i, byte));
  ram.write(14 * 4, 0); ram.write(14 * 4 + 1, 2); ram.write(0x200, 0xcf);
  ports.writePort(0x3f2, 0x0c);
  const dma = io.snapshot().dma;
  let accepted = false, halted = false;
  for (let step = 0; step < 3000; step++) {
    const { record } = stepTimedXtCpu(machine);
    if (record.outcome === "halted") halted = true;
    if (record.outcome === "accepted") {
      assert.equal(record.vector, 14); assert.equal(record.after.ip, 0x200);
      assert.deepEqual(record.accesses.flatMap(access => access.kind === "write" ? [access.address] : []),
        [0x7ffe, 0x7fff, 0x7ffc, 0x7ffd, 0x7ffa, 0x7ffb]);
      accepted = true; break;
    }
  }
  assert.equal(accepted, true); assert.equal(halted, true); assert.deepEqual(io.snapshot().dma, dma);
  ports.writePort(0x3f5, 8); ports.readPort(0x3f5); ports.readPort(0x3f5); ports.writePort(0x20, 0x20);
  for (const byte of [0xe6, 0, 0, 0, 1, 2, 9, 0x2a, 0xff]) ports.writePort(0x3f5, byte);
  const before = machine.snapshot(); advanceXtOscillatorTicks(machine, 1431818);
  assert.equal(ports.readPort(0x3f4), 0x10); assert.equal(io.irq, false);
  assert.deepEqual(io.snapshot().dma, dma); assert.deepEqual(machine.snapshot().ram, before.ram);
  const diskette = io.snapshot().diskette; machine.cpu.reset(); assert.deepEqual(io.snapshot().diskette, diskette);
  machine.reset(); assert.equal(io.snapshot().diskette.dor, 0); assert.equal(io.snapshot().diskette.phase, 0);
});

test("XT channel 2 writes to the latched page, wraps within it and honors the BIOS count", () => {
  const { io, ports, memory } = fixture(), bytes = new Uint8Array(368640);
  bytes.set([0xa6, 0x3b, 0x75], 512);
  assert.throws(() => io.setDiskette(new Uint8Array(512)), /360 KiB/);
  io.setDiskette(bytes); bytes.fill(0); // The drive owns the inserted bytes.
  ports.writePort(0x3f2, 0x1c); io.advanceOscillatorTicks(29324);
  ports.writePort(0x3f5, 8); ports.readPort(0x3f5); ports.readPort(0x3f5);
  // DMA2 single write, address FFFE, count 2 (three bytes), page A19:A16 = 3.
  for (const [port, byte] of [[0x0c, 0], [4, 0xfe], [4, 0xff], [5, 2], [5, 0], [0x0b, 0x46], [0x81, 0xf3]] as const) {
    ports.writePort(port, byte);
  }
  assert.equal(ports.readPort(0x81), 0xff);
  for (const byte of [0xe6, 0, 0, 0, 2, 2, 9, 0x2a, 0xff]) ports.writePort(0x3f5, byte);
  io.advanceOscillatorTicks(470);
  assert.equal(io.serviceDma(memory), undefined); assert.equal(ports.readPort(8) & 0x40, 0x40);
  assert.throws(() => io.setDiskette(new Uint8Array(512)), /360 KiB/); // Preserve the pending read.
  const swapped = new XtIo(io.snapshot());
  swapped.setDiskette(bytes); // Ejecting the old disk interrupts the read before this one is inserted.
  assert.equal(swapped.read(8) & 0x40, 0); assert.equal(swapped.read(0xf5), 0x40); assert.equal(swapped.read(0xf5), 4);
  ports.writePort(0x0a, 2);
  // OUT1 goes high as the timer is programmed. DACK0 must leave DREQ2 pending.
  ports.writePort(0x0b, 0x58); ports.writePort(0x0a, 0);
  ports.writePort(0x43, 0x54); ports.writePort(0x41, 18);
  assert.equal(io.serviceDma(memory)?.channel, 0); assert.equal(memory.read(0x3fffe), 0);
  ports.writePort(0x0a, 4); // Mask further refresh for this explicit grant sequence.
  for (const [address, value] of [[0x3fffe, 0xa6], [0x3ffff, 0x3b], [0x30000, 0x75]] as const) {
    assert.deepEqual(io.serviceDma(memory), { channel: 2, address, value, oscillatorTicks: 15 });
    assert.equal(memory.read(address), value);
    io.advanceOscillatorTicks(470);
  }
  assert.equal(memory.read(0x40000), 0);
  assert.equal(io.serviceDma(memory), undefined); assert.equal(ports.readPort(8) & 4, 4); assert.equal(ports.readPort(8) & 4, 0);
  const saved = io.snapshot();
  assert.equal(saved.dma.mask & 4, 4); assert.equal(saved.dma.count[2], 0xffff);
  io.setDiskette(null); assert.equal(new XtIo(saved).snapshot().disketteImage![512], 0xa6);
  assert.throws(() => new XtIo({ ...saved, disketteImage: null }), /match/);
});

test("XT restores empty-drive checkpoints written before the media and DMA-page fields existed", () => {
  const { io } = fixture();
  io.write(0xf2, 0x1c); io.advanceOscillatorTicks(29324); io.write(0xf5, 8);
  assert.equal(io.read(0xf5), 0xc0); // One unread Sense Interrupt result.
  const { disketteImage, diskettePage, diskette, ...board } = io.snapshot();
  const { results, result_index, byte_us, byte_offset, media, ...controller } = diskette;
  const old = { ...board, diskette: { ...controller, result: 0, result_pcn: 0 } };
  const restored = new XtIo(old as never);
  assert.equal(restored.read(0xf5), 0); assert.equal(restored.read(0xf4), 0x80);
  assert.equal(restored.snapshot().disketteImage, null); assert.equal(restored.snapshot().diskettePage, 0);
});
