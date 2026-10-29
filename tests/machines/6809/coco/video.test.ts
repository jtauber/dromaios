import assert from "node:assert/strict";
import { test } from "node:test";
import { create6809Coco } from "../../../../src/machines/generated/6809/coco.js";
import { cocoDisplayMode, renderCocoFrame, stepCoco } from "../../../../src/machines/6809/coco/runtime.js";
import type { Coco } from "../../../../src/machines/6809/coco/runtime.js";
import { cocoDisplayStatus, cocoScreenText } from "../../../../site/interactive/coco-inspection.js";

// Tandy Technical Reference, printed page 24: independent matched SAM/VDG modes.
const modes = [
  { width: 64, height: 64, bits: 2, v: 1 }, { width: 128, height: 64, bits: 1, v: 1 },
  { width: 128, height: 64, bits: 2, v: 2 }, { width: 128, height: 96, bits: 1, v: 3 },
  { width: 128, height: 96, bits: 2, v: 4 }, { width: 128, height: 192, bits: 1, v: 5 },
  { width: 128, height: 192, bits: 2, v: 6 }, { width: 256, height: 192, bits: 1, v: 6 },
];
function configure(machine: Coco, v: number, pins: number, page = 0): void {
  for (let bit = 0; bit < 3; bit++) machine.sam.write(bit * 2 + ((v >> bit) & 1), 0);
  for (let bit = 0; bit < 7; bit++) machine.sam.write(6 + bit * 2 + ((page >> bit) & 1), 0);
  machine.pias.write(0x23, 0); machine.pias.write(0x22, 0xf8);
  machine.pias.write(0x23, 4); machine.pias.write(0x22, pins);
}
const storedByte = (address: number): number => (address * 73 ^ (address >>> 5)) & 255;

test("all eight CoCo bitmap formats render complete independent rasters in both palettes and across RAM wrapping", () => {
  modes.forEach(({ width, height, bits, v }, gm) => {
    for (const css of [0, 1]) for (const page of [0, 0x30, 0x3f, 0x7f]) {
      const machine = create6809Coco({ firmware: null, extended: null });
      configure(machine, v, 0x80 + gm * 16 + css * 8, page);
      for (let i = 0; i < 0x8000; i++) machine.ram.write(i, storedByte(i));
      machine.pias.setKey("A", true); machine.pias.write(3, 5); machine.pias.setFieldSync(false);
      assert.equal(machine.pias.irq, true);
      const before = machine.snapshot(), reads: number[] = [], read = machine.ram.read.bind(machine.ram);
      machine.ram.read = address => { reads.push(address); return read(address); };
      machine.memory.read = machine.memory.write = () => { throw new Error("Video must not use the CPU bus"); };
      assert.deepEqual(cocoDisplayMode(machine), { kind: "bitmap", width, height, bitsPerPixel: bits });
      assert.equal(cocoDisplayStatus(machine), `${width} × ${height} · ${2 ** bits} colours · CSS ${css} · $${(page * 512).toString(16).toUpperCase().padStart(4, "0")}`);
      assert.equal(cocoScreenText(machine), "");
      const expected = new Uint8Array(256 * 192), pixelsPerByte = 8 / bits, bytesPerRow = width / pixelsPerByte;
      const palette = bits === 1 ? [8, css ? 4 : 0] : css ? [4, 5, 6, 7] : [0, 1, 2, 3];
      // Work backwards from each raster coordinate, rather than mirroring the renderer's byte loops.
      for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) {
        const row = Math.floor(y * height / 192), pixel = Math.floor(x * width / 256);
        const address = (page * 512 + row * bytesPerRow + Math.floor(pixel / pixelsPerByte)) % 0x8000;
        const digits = storedByte(address).toString(2 ** bits).padStart(pixelsPerByte, "0");
        expected[y * 256 + x] = palette[Number(digits[pixel % pixelsPerByte])]!;
      }
      assert.deepEqual(renderCocoFrame(machine), expected, `GM=${gm}, CSS=${css}, F=${page}`);
      assert.deepEqual(reads, Array.from({ length: bytesPerRow * height }, (_, i) => (page * 512 + i) % 0x8000));
      assert.deepEqual(machine.snapshot(), before); assert.equal(machine.pias.irq, true);
    }
  });
});

test("unsupported SAM/VDG pairings and INT/EXT high reject before reading RAM", () => {
  for (const graphics of [false, true]) for (let gm = 0; gm < 8; gm++) for (let v = 0; v < 8; v++) {
    const machine = create6809Coco({ firmware: null, extended: null }); configure(machine, v, (graphics ? 0x80 : 0) + gm * 16);
    machine.ram.read = () => { throw new Error("Unsupported display must not read RAM"); };
    const supported = graphics ? v === modes[gm]!.v : v === 0 && gm % 2 === 0;
    if (supported) assert.equal(cocoDisplayMode(machine).kind, graphics ? "bitmap" : "text");
    else {
      assert.throws(() => renderCocoFrame(machine), /Unsupported CoCo display/);
      assert.match(cocoDisplayStatus(machine), /Unsupported CoCo display/);
      assert.equal(cocoScreenText(machine), "");
    }
  }
});

test("6809 stores select bitmap video through the native bus, snapshots retain it, and text can be restored", () => {
  const initial = create6809Coco({ firmware: null, extended: null }).snapshot();
  const machine = create6809Coco({ firmware: null, extended: null }, { ...initial, cpu: { ...initial.cpu, pc: 0x200 } });
  const program = [
    0x86, 0, 0xb7, 0xff, 0x23, // LDA #0; STA $FF23: DDR selection.
    0x86, 0xf8, 0xb7, 0xff, 0x22, // DDRB drives video bits, lower three remain inputs.
    0x86, 4, 0xb7, 0xff, 0x23, // Select data register.
    0x86, 0xe8, 0xb7, 0xff, 0x22, // CG6, CSS=1.
    0xb7, 0xff, 0xc3, 0xb7, 0xff, 0xc5, // SAM V=110, regardless of written data.
    0xb7, 0xff, 0xcf, 0xb7, 0xff, 0xd1, // F=$30 -> $6000.
    0x86, 0x1b, 0xb7, 0x60, 0, // Four distinct left-to-right colours.
  ];
  program.forEach((byte, i) => machine.ram.write(0x200 + i, byte));
  for (let i = 0; i < 14; i++) assert.equal(stepCoco(machine).outcome, "executed");
  assert.equal(machine.cpu.snapshot().pc, 0x200 + program.length);
  assert.equal(machine.pias.videoPins, 0xef); // The low input bits resolve high.
  assert.equal(machine.sam.videoMode(), 6); assert.equal(machine.sam.displayStart(), 0x6000);
  const frame = renderCocoFrame(machine);
  assert.deepEqual([...frame.slice(0, 8)], [4, 4, 5, 5, 6, 6, 7, 7]);
  const restored = create6809Coco({ firmware: null, extended: null }, machine.snapshot());
  assert.deepEqual(renderCocoFrame(restored), frame);
  configure(restored, 0, 0, 2); restored.ram.write(0x400, 0x41);
  assert.equal(cocoDisplayMode(restored).kind, "text"); assert.match(cocoScreenText(restored), /^A/);
  assert.notDeepEqual(renderCocoFrame(restored), frame);
});
