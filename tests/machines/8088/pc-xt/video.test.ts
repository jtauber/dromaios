import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create8088PcXt, romImages } from "../../../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { advanceXtOscillatorTicks, stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";
import { cgaColours, renderXtTextFrame } from "../../../../src/machines/8088/pc-xt/video.js";

async function fixture(columns = 80) {
  // Synthetic glyph A: each row has a different single dot; no historical ROM bytes.
  const bytes = new Uint8Array(8192);
  bytes.set([0x80, 0x40, 0x20, 0x10, 8, 4, 2, 1], 0x1800 + 65 * 8);
  const font = await RomImage.verify(bytes, romImages.font, async () => romImages.font.sha256);
  const bindings = { bios: null, basic: null, font }, machine = create8088PcXt(bindings);
  [columns === 80 ? 113 : 56, columns, columns === 80 ? 90 : 45, 10, 31, 6, 25, 28,
    2, 7, 6, 7, 0, 0, 0, 0].forEach((value, i) => {
    machine.ports.writePort(0x3d4, i); machine.ports.writePort(0x3d5, value);
  });
  machine.ports.writePort(0x3d8, columns === 80 ? 0x29 : 0x28);
  machine.video.write(0, 65); machine.video.write(1, 0x9e);
  return { machine, bindings };
}

test("CGA rendering uses physical RAM, original font layout, RGBI attributes, and cursor scan lines", async () => {
  for (const columns of [40, 80]) {
    const { machine } = await fixture(columns), before = machine.snapshot();
    const frame = renderXtTextFrame(machine);
    assert.equal(frame.width, columns * 8); assert.equal(frame.height, 200);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      assert.equal(frame.pixels[y * frame.width + x], y >= 6 || x === y ? 14 : 1);
    }
    assert.deepEqual(machine.snapshot(), before); // No guest reads, time, cursor changes, or memory writes.
    frame.pixels.fill(15); assert.notEqual(renderXtTextFrame(machine).pixels[8], 15);
    assert.equal(cgaColours[6], "#AA5500"); assert.equal(cgaColours[14], "#FFFF55");
    machine.ports.writePort(0x3d4, 10); machine.ports.writePort(0x3d5, 0x26); // Hide cursor.
    machine.ports.writePort(0x3d8, columns === 80 ? 9 : 8); // Disable blinking: bright-blue background.
    assert.equal(renderXtTextFrame(machine).pixels[1], 9);
    machine.ports.writePort(0x3d8, columns === 80 ? 13 : 12); // Composite colour-burst bit does not change RGBI.
    assert.equal(renderXtTextFrame(machine).pixels[1], 9);
    machine.ports.writePort(0x3d8, columns === 80 ? 1 : 0);
    assert.ok(renderXtTextFrame(machine).pixels.every(pixel => pixel === 0));
  }
});

test("CGA rendering retains display-start wrapping and blink phase through a whole-machine snapshot", async () => {
  const { machine, bindings } = await fixture();
  machine.ports.writePort(0x3d4, 12); machine.ports.writePort(0x3d5, 0x1f);
  machine.ports.writePort(0x3d4, 13); machine.ports.writePort(0x3d5, 0xff);
  machine.ports.writePort(0x3d4, 10); machine.ports.writePort(0x3d5, 0x26);
  machine.video.write(0x3ffe, 65); machine.video.write(0x3fff, 0x2f);
  advanceXtOscillatorTicks(machine, 912 * 262 * 16 + 7);
  const saved = machine.snapshot(), restored = create8088PcXt(bindings, saved);
  const frame = renderXtTextFrame(machine);
  assert.equal(frame.pixels[0], 15); assert.equal(frame.pixels[1], 2);
  assert.equal(frame.pixels[8], 1); // Wrapped A's blinking attribute hides its foreground.
  assert.deepEqual(renderXtTextFrame(restored), frame);
  assert.deepEqual(machine.snapshot(), saved);
  for (const target of [machine, restored]) advanceXtOscillatorTicks(target, 912 * 262 * 16);
  assert.equal(renderXtTextFrame(restored).pixels[8], 14);
  assert.deepEqual(restored.snapshot(), machine.snapshot());
});

test("CGA machine wiring advances on instructions, idle halt, and DMA grants; reset preserves storage", async () => {
  const { machine, bindings } = await fixture(), { io } = machine;
  // Channel 0 single-read refresh with a pending request from PIT channel 1.
  io.write(11, 0x58); io.write(10, 0); io.write(0x43, 0x54); io.write(0x41, 4);
  machine.ram.write(0, 0xf4); // HLT; IF=0, so subsequent boundaries idle until the next PIT pulse.
  const before = machine.snapshot(), result = stepTimedXtCpu(machine);
  assert.ok(result.refresh); assert.equal(result.record.outcome, "halted");
  const expected = create8088PcXt(bindings, before);
  advanceXtOscillatorTicks(expected, result.oscillatorTicks);
  assert.deepEqual(machine.cga.snapshot(), expected.cga.snapshot());
  assert.equal(machine.io.oscillatorTicks, result.oscillatorTicks);
  const idle = stepTimedXtCpu(machine); assert.equal(idle.record.instruction, null);
  assert.equal(machine.cga.snapshot().phase, machine.io.oscillatorTicks % 16);
  const display = machine.cga.snapshot(); machine.cpu.reset(); assert.deepEqual(machine.cga.snapshot(), display);
  machine.reset(); assert.equal(machine.cga.snapshot().phase, 0); assert.equal(machine.cga.snapshot().mode, 0);
  assert.equal(machine.video.read(0), 65); assert.equal(machine.font.loaded, true);
  assert.throws(() => create8088PcXt({ ...bindings, font: null }, before), /identity/);
});

test("CGA observation rejects missing fonts and unsupported display profiles without altering the machine", async () => {
  const { machine } = await fixture(), saved = machine.snapshot();
  const absent = create8088PcXt({ bios: null, basic: null, font: null }, { ...saved, font: null });
  assert.throws(() => renderXtTextFrame(absent), /character ROM/);
  for (const [index, value] of [[1, 79], [6, 24], [9, 15], [8, 1], [10, 0x46]]) {
    machine.ports.writePort(0x3d4, index!); machine.ports.writePort(0x3d5, value!);
    const before = machine.snapshot(); assert.throws(() => renderXtTextFrame(machine), /requires/);
    assert.deepEqual(machine.snapshot(), before);
    machine.ports.writePort(0x3d5, saved.cga.crtc[index!]!);
  }
  machine.ports.writePort(0x3d8, 0x2b); assert.throws(() => renderXtTextFrame(machine), /requires/);
});

test("the original CGA font renders all 256 characters with its declared default glyph bank", {
  skip: !process.env.XT_CGA_ROM && "Set XT_CGA_ROM to the selected IBM MDA/CGA character ROM.",
}, async () => {
  const bytes = readFileSync(process.env.XT_CGA_ROM!);
  const font = await RomImage.verify(bytes, romImages.font, async b => createHash("sha256").update(b).digest("hex"));
  const { machine } = await fixture(); machine.font.install(font);
  machine.ports.writePort(0x3d4, 10); machine.ports.writePort(0x3d5, 0x26);
  for (let character = 0; character < 256; character++) {
    machine.video.write(character * 2, character); machine.video.write(character * 2 + 1, 0x0f);
  }
  const before = machine.snapshot(), { width, pixels } = renderXtTextFrame(machine);
  for (let character = 0; character < 256; character++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const expected = bytes[0x1800 + character * 8 + y]! & (0x80 >>> x) ? 15 : 0;
    const index = (Math.floor(character / 80) * 8 + y) * width + character % 80 * 8 + x;
    assert.equal(pixels[index], expected);
  }
  assert.deepEqual(machine.snapshot(), before);
});
