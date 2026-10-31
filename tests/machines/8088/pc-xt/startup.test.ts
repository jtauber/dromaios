import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create8088PcXt, romImages } from "../../../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";
import { renderXtTextFrame } from "../../../../src/machines/8088/pc-xt/video.js";

const optional = { skip: !(process.env.XT_BIOS_ROM && process.env.XT_BASIC_ROM)
  && "Set XT_BIOS_ROM and XT_BASIC_ROM to the selected XT BIOS and ROM BASIC images." };
type Machine = ReturnType<typeof create8088PcXt>;
function atVideo(machine: Machine): boolean {
  const { cs, ip } = machine.cpu.snapshot(); return cs === 0xf000 && ip === 0xe242;
}

test("original XT firmware passes early POST and CGA video tests from reset, with a repeatable saved continuation", optional, async () => {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const biosBytes = readFileSync(process.env.XT_BIOS_ROM!);
  const bindings = {
    font: process.env.XT_CGA_ROM ? await RomImage.verify(readFileSync(process.env.XT_CGA_ROM), romImages.font, digest) : null,
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

  function finishVideo(target: Machine, inspect: boolean) {
    const status = new Set<number>();
    let sawBar = false, sawSuccess = false;
    for (let step = 0; step < 750000; step++) {
      const { cs, ip } = target.cpu.snapshot();
      if (cs === 0xf000 && ip === 0xe30a) {
        assert.ok(sawBar); assert.ok(sawSuccess);
        assert.ok([...status].some(value => value & 8)); assert.ok([...status].some(value => !(value & 8)));
        assert.ok([...status].some(value => value & 1)); assert.ok([...status].some(value => !(value & 1)));
        return;
      }
      assert.notEqual(ip, 0xe2f0, "POST must not enter the CRT error path.");
      if (cs === 0xf000 && ip === 0xe305) sawSuccess = true;
      if (cs === 0xf000 && ip === 0xe2cd) {
        sawBar = true;
        for (let column = 0; column < 40; column++) {
          assert.equal(target.video.read(column * 2), 0x20); assert.equal(target.video.read(column * 2 + 1), 0x70);
        }
        if (inspect && target.font.loaded) {
          const before = target.snapshot(), frame = renderXtTextFrame(target);
          assert.equal(frame.width, 640); assert.equal(frame.height, 200);
          assert.ok(frame.pixels.slice(0, 320).every(pixel => pixel === 7));
          assert.ok(frame.pixels.slice(320, 640).every(pixel => pixel === 0));
          assert.deepEqual(target.snapshot(), before);
        }
      }
      const { record } = stepTimedXtCpu(target);
      assert.equal(record.outcome, "executed", `Video POST stopped at ${ip.toString(16)}`);
      for (const access of record.accesses) if (access.kind === "input" && access.port === 0x3da) status.add(access.value);
    }
    assert.fail("Video POST did not reach F000:E30A within its execution budget.");
  }
  finishVideo(machine, true); finishVideo(restored, false);
  assert.deepEqual(restored.snapshot(), machine.snapshot());
  assert.equal(machine.ram.read(0x449), 3); assert.equal(word(0x44a), 80);
  assert.equal(word(0x44c), 4096); assert.equal(word(0x463), 0x3d4);
  assert.equal(machine.cga.snapshot().mode, 0x29); assert.equal(machine.cga.textSupported(), true);
  assert.deepEqual(machine.cga.snapshot().crtc, [113, 80, 90, 10, 31, 6, 25, 28, 2, 7, 6, 7, 0, 0, 0, 0]);
  for (let cell = 0; cell < 8192; cell++) {
    assert.equal(machine.video.read(cell * 2), 0x20); assert.equal(machine.video.read(cell * 2 + 1), 7);
  }
});
