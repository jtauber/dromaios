import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { romImages } from "../../src/machines/generated/8088/pc-xt-ega.js";
import { egaRgb, renderEgaGraphicsFrame } from "../../src/machines/8088/pc-xt/video.js";
import type { IbmEga } from "../../src/components/devices/ibm-ega.js";
import { RomImage } from "../../src/machines/rom-image.js";
import { createXtEgaSession, type XtBoundary } from "../../site/interactive/xt-session.js";
import { egaPixelAt, xtEgaPixelReadout } from "../../site/interactive/xt-ega-pixel.js";
import { createXtDebugger, parseXtDebugAddress } from "../../site/interactive/xt-debugger.js";
import { matchesXtDosObservation, type XtDosObservation } from "../../site/interactive/xt-dos-observation.js";
import { createXtDosCalls } from "../../site/interactive/xt-dos-services.js";
import { createXtDiskActivity } from "../../site/interactive/xt-disk-activity.js";
import { createXtDosFileLinks } from "../../site/interactive/xt-dos-file-links.js";
import { inspectFat12, readFat12File } from "../../site/interactive/fat12.js";
import { xtRomGuide } from "./xt-inspection-fixture.js";
import { ultimaSteps } from "../helpers/ultima-v-guide.js";
import { runInput } from "../machines/8088/pc-xt/rom-console.js";

const steps = ultimaSteps<XtDosObservation>("ultima-v-ega-driver");
const entry = steps[0]!, mode = steps[1]!, logo = steps[2]!;
const { XT_BIOS_ROM, XT_BASIC_ROM, XT_EGA_ROM, XT_ULTIMA_EGA_PROGRAM } = process.env;

test("a resized 4:3 monitor selects native EGA dots and excludes the surround", () => {
  const rect = { left: 16.5, top: 12.5, width: 480, height: 360 };
  assert.deepEqual(egaPixelAt(rect, 16.5, 12.5), { x: 0, y: 0 });
  assert.deepEqual(egaPixelAt(rect, 496, 372), { x: 319, y: 199 });
  assert.deepEqual(egaPixelAt(rect, 245, 148), { x: 152, y: 75 });
  for (const [x, y] of [[16, 13], [17, 12], [496.5, 42], [42, 372.5]] as const) {
    assert.equal(egaPixelAt(rect, x, y), undefined);
  }
});

test("the EGA mode stop requires both the driver's INT instruction and the mode request", () => {
  const machine = createXtEgaSession().machine, state = { ...machine.cpu.snapshot(), ax: 13 };
  const match = () => matchesXtDosObservation(mode.expect, machine, state);
  machine.ram.write(0x9dae6, 0xcd); machine.ram.write(0x9dae7, 0x10);
  assert.ok(match());
  state.ax = 0x0f00; assert.equal(match(), false);
  state.ax = 13; machine.ram.write(0x9dae7, 0x21); assert.equal(match(), false);
});

test("Ultima V enters EGA.DRV, sets mode 0Dh and draws the first eight Origin logo pixels", {
  skip: !(XT_BIOS_ROM && XT_BASIC_ROM && XT_EGA_ROM && XT_ULTIMA_EGA_PROGRAM) && "Set the XT firmware and XT_ULTIMA_EGA_PROGRAM.",
}, async () => {
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const rom = (slot: keyof typeof romImages, path: string) => RomImage.verify(readFileSync(path), romImages[slot], async b => hash(b));
  const session = createXtEgaSession({ bios: await rom("bios", XT_BIOS_ROM!), basic: await rom("basic", XT_BASIC_ROM!),
    option: await rom("option", XT_EGA_ROM!) });
  const disk = readFileSync(XT_ULTIMA_EGA_PROGRAM!), volume = inspectFat12(disk);
  const file = readFat12File(disk, volume, volume.entries.find(e => e.name === "EGA.DRV")!);
  assert.equal(hash(file), "93f9c50d836d7abfb62ea14c51bbf9d86b9e4173ae31dd0ea585a742f4802604");
  session.insertDisk("ULTIMA-EGA-PROGRAM.IMG", disk); session.powerOn("cold");
  const { machine } = session, base = 0x9d270;
  // Run POST uninstrumented. Start the lab history before Ultima opens the file to measure it.
  const boot = runInput(machine, [], { limit: entry.boundaryLimit, until: (_, { after }) =>
    after.cs === 0x0c6f && after.ip === 0x1658 && after.ah === 0x3d
    && String.fromCharCode(...Array.from({ length: 8 }, (_, i) => machine.ram.read(after.ds * 16 + after.dx + i))) === "EGA.DRV\0" });
  const activity = createXtDiskActivity(() => machine.io);
  const links = createXtDosFileLinks(() => machine.io, activity);
  const calls = createXtDosCalls(xtRomGuide.dos, address => address < machine.ram.size ? machine.ram.read(address) : undefined, links.observe);
  const debug = createXtDebugger(() => machine, undefined, calls);
  const capture = () => debug.capture(() => activity.capture(() => session.step()));
  let prior: ReturnType<typeof capture> | undefined;
  for (const step of [entry, mode]) {
    debug.runTo(parseXtDebugAddress(step.execution), { when: () => matchesXtDosObservation(step.expect, machine),
      limit: step === entry ? entry.boundaryLimit! - boot.boundaries : undefined });
    while (!debug.beforeStep()) {
      prior = capture();
      if (step === entry && prior.instruction) assert.ok(prior.before.pc < base || prior.before.pc >= base + file.length,
        "No instruction in the driver may execute before the entry stop.");
    }
    assert.equal(debug.stop?.kind, "target", step.title);
    const read = calls.entries().find(call => call.filename === "EGA.DRV" && call.service.function === "3F")!;
    assert.equal(read.result?.carry, false); assert.equal(read.result.ax, file.length);
    assert.deepEqual([read.buffer?.segment, read.buffer?.offset], [0x9d27, 0]);
    const link = links.get(read)!;
    assert.deepEqual(link.range, { offset: 0, length: file.length });
    const { offset, length } = step.fileRange!, pc = machine.cpu.snapshot().pc;
    assert.equal(pc, base + offset);
    const region = link.regions.find(r => r.fileOffset! <= offset && offset + length <= r.fileOffset! + r.length)!;
    const transfer = link.transfers.find(t => t.fileOffset! <= offset && offset + length <= t.fileOffset! + t.bytes)!;
    const image = region.offset + offset - region.fileOffset!;
    assert.equal(image, step === entry ? 0x42803 : 0x43076);
    assert.equal(transfer.offset + offset - transfer.fileOffset!, image);
    assert.equal(transfer.address + offset - transfer.fileOffset!, pc);
    assert.deepEqual([...disk.subarray(image, image + length)], Array.from({ length }, (_, i) => machine.ram.read(pc + i)));
    if (step === entry) {
      assert.deepEqual([prior!.before.cs, prior!.before.ip, prior!.instruction?.bytes], [0x0c6f, 0x08c1, [0xff, 0x1e, 0x50, 0x53]]);
      assert.deepEqual(Uint8Array.from({ length: file.length }, (_, i) => machine.ram.read(base + i)), file);
      const jump = capture();
      assert.deepEqual([jump.instruction?.bytes, jump.after.ip], [[0xe9, 0x62, 0x08], 0x0868]);
    }
  }
  assert.equal(machine.ram.read(0x449), 3);
  debug.over();
  const interrupt = capture();
  assert.deepEqual([interrupt.instruction?.bytes, interrupt.before.ax, interrupt.after.cs], [[0xcd, 0x10], 13, 0xc000]);
  while (!debug.beforeStep()) capture();
  assert.equal(debug.stop?.kind, "over");
  assert.deepEqual([machine.cpu.snapshot().cs, machine.cpu.snapshot().ip, machine.ram.read(0x449)], [0x9d27, 0x0878, 13]);
  // Start with a black frame. Between here and the stop, only a write to the
  // displayed page or a display register can light a dot (no blink in mode 0Dh).
  assertBlackPageZero(machine.ega);
  debug.runTo(parseXtDebugAddress(logo.execution), { when: () => matchesXtDosObservation(logo.expect, machine) });
  while (!debug.beforeStep()) checkEarlierVideoWrite(machine.ega, capture());
  assert.equal(debug.stop?.kind, "target");
  const before = machine.ega.snapshot();
  assert.deepEqual([before.seq[2], before.gc[5], before.gc[8], before.attr[0x12]], [9, 0, 255, 15]);
  const selectedDot = () => xtEgaPixelReadout(machine.ega, 159, 75);
  assert.match(selectedDot(), /bit 0: 0 0 0 0 · index 0 · palette\[0\] = \$00 · #000000$/);
  const paint = capture();
  assert.deepEqual(paint.instruction?.bytes, [...file.slice(logo.fileRange!.offset, logo.fileRange!.offset + 2)]);
  assert.deepEqual(paint.accesses.filter(a => "address" in a && a.address >= 0xa0000), [
    { kind: "read", address: 0xa8012, value: 0 }, { kind: "read", address: 0xa8013, value: 255 },
    { kind: "write", address: 0xa0bca, value: 0 }, { kind: "write", address: 0xa0bcb, value: 255 },
  ]);
  assert.deepEqual([paint.after.ip, paint.after.si, paint.after.di, paint.after.cx], [0x1c1a, 0x14, 0xbcc, 10]);
  assert.equal(matchesXtDosObservation(logo.expect, machine), false);

  // Reconstruct the dot independently from the four physical plane bytes.
  const x = 152, y = 75, offset = 40 * y + (x >>> 3), shift = 7 - (x & 7);
  const planes = (state: typeof before) => [0, 1, 2, 3].map(p => state.planes[p * 65536 + offset]!);
  const after = machine.ega.snapshot(), bytes = planes(after);
  assert.deepEqual(planes(before), [0, 0, 0, 0]); assert.deepEqual(bytes, [255, 0, 0, 255]);
  const index = bytes.reduce((v, byte, p) => v | ((byte >>> shift) & 1) << p, 0);
  const pins = after.attr[index & after.attr[0x12]!]!;
  assert.deepEqual([index, pins, machine.ega.rgbiOutput], [9, 0x39, true]);
  const expected = new Uint8Array(320 * 200);
  expected.fill(pins, y * 320 + x, y * 320 + x + 8);
  const frame = renderEgaGraphicsFrame(machine.ega);
  assert.deepEqual(frame.pixels, expected);
  assert.deepEqual(egaRgb(frame.pixels[y * 320 + x]!, machine.ega.rgbiOutput), [85, 85, 255]);
  assert.deepEqual(machine.ega.inspectGraphicsPixel(x, y), { offset, bit: shift, planeBytes: bytes, index: 9, paletteIndex: 9, pins });
  assert.equal(selectedDot(), "Pixel (159,75) · plane offset $0BCB · P0–P3: FF 00 00 FF · bit 0: 1 0 0 1 · index 9 · palette[9] = $39 · #5555FF");
  assert.match(xtEgaPixelReadout(machine.ega, 160, 75), /bit 7: 0 0 0 0 · index 0 · palette\[0\] = \$00 · #000000$/);
  debug.dispose(); activity.dispose();
});

function assertBlackPageZero(ega: IbmEga): void {
  const { seq, gc, crt, attr } = ega.snapshot();
  // Check the assumptions behind the dirty address range below: planar, A000,
  // no panning, start zero, 40 bytes per row. Fail if the game ever flips pages.
  assert.ok(ega.graphicsSupported);
  assert.deepEqual([seq[4]! & 4, (gc[6]! >> 2) & 3, crt[12], crt[13], crt[19], attr[19]! & 7], [4, 1, 0, 0, 20, 0]);
  assert.ok(!renderEgaGraphicsFrame(ega).pixels.some(Boolean));
}

function checkEarlierVideoWrite(ega: IbmEga, record: XtBoundary): void {
  // A register change can expose different storage without a CPU write to it.
  if (record.accesses.some(a => a.kind === "output" && a.port >= 0x3b0 && a.port <= 0x3df)) {
    assertBlackPageZero(ega);
  } else if (record.accesses.some(a => a.kind === "write" && a.address >= 0xa0000 && a.address < 0xa0000 + 8000)) {
    assert.ok(!renderEgaGraphicsFrame(ega).pixels.some(Boolean));
  }
}
