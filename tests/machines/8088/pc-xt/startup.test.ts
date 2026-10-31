import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create8088PcXt, romImages } from "../../../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";

const optional = { skip: !(process.env.XT_BIOS_ROM && process.env.XT_BASIC_ROM)
  && "Set XT_BIOS_ROM and XT_BASIC_ROM to the selected XT BIOS and ROM BASIC images." };
type Machine = ReturnType<typeof create8088PcXt>;
function atVideo(machine: Machine): boolean {
  const { cs, ip } = machine.cpu.snapshot(); return cs === 0xf000 && ip === 0xe242;
}

test("original XT firmware reaches video initialization from reset, with a repeatable saved continuation", optional, async () => {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const biosBytes = readFileSync(process.env.XT_BIOS_ROM!);
  const bindings = {
    bios: await RomImage.verify(biosBytes, romImages.bios, digest),
    basic: await RomImage.verify(readFileSync(process.env.XT_BASIC_ROM!), romImages.basic, digest),
  };
  const machine = create8088PcXt(bindings);
  assert.ok(machine.snapshot().ram.every(byte => byte === 0));
  machine.reset(); assert.equal(machine.cpu.snapshot().pc, 0xffff0);
  let checkpoint: ReturnType<Machine["snapshot"]> | undefined;
  let steps = 0, refreshes = 0, elapsed = 0, interrupts = 0;
  const diagnostics: number[] = [];
  for (; steps < 1000000 && !atVideo(machine); steps++) {
    const before = machine.cpu.snapshot();
    // Last 16 KiB RAM-clear REP, just before the BIOS builds its IVT and resets the keyboard.
    if (before.cs === 0xf000 && before.ip === 0xe1b4 && before.es === 0x9c00 && before.cx === 4) checkpoint = machine.snapshot();
    const { record, refresh, oscillatorTicks } = stepTimedXtCpu(machine);
    elapsed += oscillatorTicks;
    assert.ok(record.outcome === "executed" || record.outcome === "accepted", `BIOS stopped at ${before.pc.toString(16)}: ${record.outcome}`);
    if (refresh) { assert.equal(refresh.address, refreshes & 0xffff); refreshes++; }
    if (record.outcome === "accepted") {
      assert.ok("source" in record); assert.equal(record.source, "intr"); assert.equal(record.vector, 9);
      assert.equal(record.after.cs, 0xf000); assert.equal(record.after.ip, 0xff23); interrupts++;
    }
    for (const access of record.accesses) if (access.kind === "output" && access.port === 0x60) diagnostics.push(access.value);
  }
  assert.ok(atVideo(machine), "POST did not reach F000:E242 within the execution budget.");
  assert.ok(checkpoint, "POST must clear RAM through the declared REP continuation boundary.");
  assert.deepEqual(diagnostics, [1, 2, 3]); // IBM listing: CPU, timer/DMA, and base RAM tests completed.
  assert.equal(interrupts, 1); assert.ok(refreshes > 0);
  assert.equal(machine.io.oscillatorTicks, elapsed);
  const word = (address: number) => machine.ram.read(address) | machine.ram.read(address + 1) << 8;
  assert.equal(word(0x413), 640); assert.equal(word(0x410), 0x2d);
  for (let vector = 0; vector < 32; vector++) {
    const offset = vector < 16 ? 0xff23 : biosBytes[0x1f03 + 2 * (vector - 16)]! | biosBytes[0x1f04 + 2 * (vector - 16)]! << 8;
    assert.equal(word(vector * 4), offset); assert.equal(word(vector * 4 + 2), 0xf000);
  }
  assert.equal(machine.cpu.snapshot().bl, 0xaa);
  const io = machine.io.snapshot();
  assert.equal(io.pic.imr, 0xff); assert.equal(io.pic.isr, 0); assert.equal(io.keyboard.full, false);
  assert.equal(io.dma.mask, 14); assert.equal(io.dma.mode[0], 0x58);
  assert.equal(io.dma.address[0], refreshes & 0xffff); assert.equal(io.dma.count[0], 0xffff - (refreshes & 0xffff));
  assert.equal(io.system.parity_error, false); assert.equal(io.system.channel_error, false);
  const restored = create8088PcXt(bindings, checkpoint);
  for (let step = 0; step < 100000 && !atVideo(restored); step++) stepTimedXtCpu(restored);
  assert.ok(atVideo(restored)); assert.deepEqual(restored.snapshot(), machine.snapshot());
});
