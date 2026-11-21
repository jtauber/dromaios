import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { romImages } from "../../src/machines/generated/8088/pc-xt-ega.js";
import { Cpu8088 } from "../../src/components/cpus/generated/8088-cpu.js";
import { stepTimedXtCpu } from "../../src/machines/8088/pc-xt/interrupts.js";
import { egaRgb, renderEgaGraphicsFrame } from "../../src/machines/8088/pc-xt/video.js";
import type { IbmEga } from "../../src/components/devices/ibm-ega.js";
import { RomImage } from "../../src/machines/rom-image.js";
import { createXtEgaSession, type XtBoundary } from "../../site/interactive/xt-session.js";
import { egaPixelAt, xtEgaPixelReadout } from "../../site/interactive/xt-ega-pixel.js";
import { createXtPaletteCapture } from "../../site/interactive/xt-ega-palette.js";
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
const entry = steps[0]!, mode = steps[1]!, prepare = steps[2]!, logo = steps[3]!;
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

test("a plane watch follows physical storage across aperture changes and checkpoint restore", () => {
  const session = createXtEgaSession(), debug = createXtDebugger(() => session.machine);
  const watch = { space: "P2", address: 0x13, enabled: true };
  debug.setPlaneWatchpoints([watch]);
  const { machine } = session;
  machine.ega.writePort(0x3c2, 3);
  const reg = (port: number, i: number, v: number) => { session.machine.ega.writePort(port, i); session.machine.ega.writePort(port + 1, v); };
  reg(0x3c4, 4, 4); reg(0x3ce, 8, 255); reg(0x3ce, 6, 12); // Planar CPU writes through B8000.
  machine.cpu = new Cpu8088(machine.memory, { ...machine.cpu.snapshot(), cs: 0, ip: 0x2000, es: 0xb800, di: 0x13, ax: 0xf0 });
  [0x26, 0x88, 0x05, 0xeb, 0xfb].forEach((v, i) => machine.ram.write(0x2000 + i, v)); // MOV ES:[DI],AL; JMP back.
  const save = session.snapshot();
  function step() { debug.step(); return debug.capture(() => stepTimedXtCpu(session.machine).record); }
  const planeHit = () => debug.planeHit;
  reg(0x3c4, 2, 1); step();
  assert.equal(planeHit(), undefined); // Only P0 took the write.
  step(); reg(0x3c4, 2, 4); step();
  assert.deepEqual([debug.planeHit?.write.address, debug.planeHit?.write.offset], [0x18013, 0x13]);
  assert.equal(debug.stop?.kind, "watchpoint");
  step(); step(); assert.match(debug.stop!.detail!, /P2:\$0013 through \$B8013 · \$F0 → \$F0/);
  session.restore(save); debug.reset(); assert.equal(debug.planeHit, undefined);
  assert.deepEqual(debug.planeWatchpoints, [watch]);
  reg(0x3c4, 2, 4); step(); assert.equal(debug.stop?.kind, "watchpoint");
  assert.equal(session.machine.ega.planeByte(2, 0x13), 240);
  debug.setPlaneWatchpoints([{ ...watch, enabled: false }]);
  step(); step(); assert.equal(debug.planeHit, undefined);
  for (const invalid of [{ ...watch, address: 0x10000 }, { ...watch, space: "P4" }]) {
    assert.throws(() => debug.setPlaneWatchpoints([invalid]), RangeError);
  }
  debug.dispose();
});

function planarMachine() {
  const { machine } = createXtEgaSession(), { ega } = machine;
  function reg(port: number, index: number, value: number) { ega.writePort(port, index); ega.writePort(port + 1, value); }
  ega.writePort(0x3c2, 3);
  reg(0x3c4, 1, 1); reg(0x3ce, 6, 5);
  for (const [index, value] of [[1, 39], [0x12, 199], [0x13, 20], [0x17, 0xe3], [0x18, 255]] as const) reg(0x3d4, index, value);
  reg(0x3c0, 0x30, 1); reg(0x3c0, 0x32, 15);
  return { machine, reg };
}

test("the watched dot follows a new CRTC start address and traces the matching byte of STOSW", () => {
  const { machine, reg } = planarMachine();
  reg(0x3c0, 0x29, 6); // Index 9 appears brown.
  reg(0x3c4, 2, 15); reg(0x3c4, 4, 4); reg(0x3ce, 5, 2); reg(0x3ce, 8, 0x40);
  machine.cpu = new Cpu8088(machine.memory, { ...machine.cpu.snapshot(), cs: 0, ip: 0x2000,
    dx: 0x3d4, ax: 0x020d, es: 0xa000, di: 1 }, { ports: machine.ports });
  // Move display start to byte 2 while the dot is black. Store FF at byte 1 and 09 at byte 2.
  [0xef, 0xb8, 0xff, 0x09, 0xab].forEach((byte, i) => machine.ram.write(0x2000 + i, byte));
  const debug = createXtDebugger(() => machine, 4);
  debug.runUntilPixelChanges(1, 0);
  while (!debug.beforeStep()) debug.capture(() => stepTimedXtCpu(machine).record);
  const hit = debug.pixelHit!;
  assert.deepEqual([hit.record.before.ip, hit.after.colour], [0x2004, "#AA5500"]);
  assert.deepEqual(hit.store, { source: "CPU", operand: { kind: "register", name: "AH", value: 9 }, write: {
    address: 2, offset: 2, value: 9, writeMode: 2, enabledPlanes: 15, bitMask: 0x40,
    before: [0, 0, 0, 0], after: [0x40, 0, 0, 0x40],
  } });
  debug.dispose();
});

test("MOVS traces the selected source byte through segment overrides, offset wrap and 20-bit bus wrap", () => {
  for (const [opcode, segment, si, addresses, x, offset] of [
    [0xa4, 0xffff, 0x0020, [0x00010], 0, 0x0020],
    [0xa5, 0x2345, 0xffff, [0x3344f, 0x23450], 8, 0x0000],
  ] as const) {
    const { machine, reg } = planarMachine();
    reg(0x3c0, 0x29, 6); reg(0x3c4, 2, 15); reg(0x3c4, 4, 4); reg(0x3ce, 5, 2); reg(0x3ce, 8, 255);
    const start = machine.cpu.snapshot();
    machine.cpu = new Cpu8088(machine.memory, { ...start, cs: 0, ip: 0x2000, ss: segment, si,
      es: 0xa000, di: 0, cx: 2, flags: { ...start.flags, df: true } }, { ports: machine.ports });
    [0x3e, 0x36, 0xf3, opcode].forEach((byte, i) => machine.ram.write(0x2000 + i, byte));
    // Both source bytes of the word are identical. Only their position distinguishes them.
    for (const address of addresses) machine.ram.write(address, 9);
    const debug = createXtDebugger(() => machine);
    debug.runUntilPixelChanges(x, 0);
    debug.capture(() => stepTimedXtCpu(machine).record);
    assert.deepEqual(debug.pixelHit?.store?.operand, { kind: "memory", address: addresses.at(-1), segment, offset, value: 9 });
    debug.dispose();
  }
});

test("a pixel trace keeps the plane selected for a MOVS read, including an odd/even source", () => {
  const { machine, reg } = planarMachine();
  reg(0x3c0, 0x29, 6); reg(0x3c4, 4, 4); reg(0x3ce, 8, 255);
  reg(0x3c4, 2, 8); machine.ega.write(0x4009, 0xff);
  reg(0x3ce, 4, 2); reg(0x3ce, 5, 0x10); // Odd CPU address selects P3 of the P2/P3 pair.
  reg(0x3c4, 2, 9); // Destination writes enable P0 and P3.
  machine.cpu = new Cpu8088(machine.memory, { ...machine.cpu.snapshot(), cs: 0, ip: 0x2000,
    ds: 0xa800, si: 0x13, es: 0xa000, di: 0 });
  machine.ram.write(0x2000, 0xa4);
  const debug = createXtDebugger(() => machine);
  debug.runUntilPixelChanges(0, 0);
  debug.capture(() => stepTimedXtCpu(machine).record);
  reg(0x3ce, 4, 0); reg(0x3ce, 5, 0);
  assert.deepEqual(debug.pixelHit?.store?.operand, { kind: "memory", segment: 0xa800, offset: 0x13, address: 0xa8013,
    value: 0xff, planeByte: { plane: 3, offset: 0x4009 } });
  debug.dispose();
});

test("when DMA and the CPU write the same byte, the stop traces the write that changed the monitor colour", () => {
  const { machine, reg } = planarMachine();
  reg(0x3c0, 0x21, 7); reg(0x3c0, 0x23, 7); // Different plane bits, same grey.
  reg(0x3c4, 2, 15); reg(0x3c4, 4, 4); reg(0x3ce, 5, 2); reg(0x3ce, 8, 255);
  machine.cpu = new Cpu8088(machine.memory, { ...machine.cpu.snapshot(), cs: 0, ip: 0x2000,
    ax: 3, es: 0xa000, di: 0 }, { ports: machine.ports });
  machine.ram.write(0x2000, 0xaa); // STOSB supplies colour index 3 after DMA has supplied index 1.
  const debug = createXtDebugger(() => machine);
  debug.runUntilPixelChanges(0, 0);
  debug.capture(() => {
    machine.memory.write(0xa0000, 1);
    return { ...stepTimedXtCpu(machine).record, dma: { channel: 2, address: 0xa0000, value: 1,
      direction: "disk-to-memory", offset: 0, terminal: true, oscillatorTicks: 12 } };
  });
  const hit = debug.pixelHit!;
  assert.deepEqual([hit.before.index, hit.after.index, hit.after.colour], [0, 3, "#AAAAAA"]);
  assert.deepEqual(hit.store, { source: "DMA2", write: {
    address: 0, offset: 0, value: 1, writeMode: 2, enabledPlanes: 15, bitMask: 255,
    before: [0, 0, 0, 0], after: [255, 0, 0, 0],
  } });
  debug.dispose();
});

test("a pixel stop ignores RGBI-equivalent palette writes and retains the instruction that changes the colour", () => {
  const { machine } = planarMachine(), { ega } = machine;
  machine.cpu = new Cpu8088(machine.memory, { ...machine.cpu.snapshot(), cs: 0, ip: 0x2000, dx: 0x3c0 }, { ports: machine.ports });
  // OUT to palette entry zero with video enabled. $28 still displays black; $17 displays white.
  const program = [0xb0, 0x20, 0xee, 0xb0, 0x28, 0xee, 0xb0, 0x20, 0xee, 0xb0, 0x17, 0xee, 0x90];
  program.forEach((byte, i) => machine.ram.write(0x2000 + i, byte));
  const debug = createXtDebugger(() => machine, 16);
  const palette = createXtPaletteCapture(machine)!;
  const run = () => { while (!debug.beforeStep()) debug.capture(() => palette.capture(() => stepTimedXtCpu(machine).record)); };
  debug.runUntilPixelChanges(42, 23);
  run();
  const hit = debug.pixelHit!;
  assert.equal(debug.stop?.kind, "event");
  assert.deepEqual([hit.record.before.ip, hit.record.after.ip, hit.record.instruction?.bytes], [0x200b, 0x200c, [0xee]]);
  assert.deepEqual([hit.before.pins, hit.after.pins, hit.before.colour, hit.after.colour], [0x28, 0x17, "#000000", "#FFFFFF"]);
  assert.deepEqual(hit.before.planeBytes, hit.after.planeBytes);
  assert.equal(hit.afterBlanking, false);
  assert.equal(hit.store, undefined);
  assert.equal(hit.paletteWrite, hit.record.paletteWrite);
  assert.deepEqual(hit.paletteWrite!.transfer, { kind: "output", port: 0x3c0, value: 0x17, paletteIndex: 0, before: 0x28, after: 0x17 });
  assert.deepEqual(egaRgb(renderEgaGraphicsFrame(ega).pixels[23 * 320 + 42]!, true), [255, 255, 255]);

  // A new request uses the current dot. Ordinary stops and checkpoint reset discard it.
  debug.setBreakpoints([{ address: 0x200d, enabled: true }]);
  debug.runUntilPixelChanges(42, 23); run();
  assert.equal(debug.stop?.kind, "breakpoint"); assert.equal(debug.pixelHit, undefined); assert.equal(debug.pixelTarget, undefined);
  debug.runUntilPixelChanges(42, 23); debug.reset();
  assert.equal(debug.pixelTarget, undefined); assert.equal(debug.pixelHit, undefined);
  // Switch to text mode. There is no longer a planar sample at this coordinate.
  [0xb0, 0x30, 0xee, 0xb0, 0, 0xee].forEach((byte, i) => machine.ram.write(0x200d + i, byte));
  debug.runUntilPixelChanges(42, 23); run();
  assert.equal(debug.stop?.kind, "pause"); assert.match(debug.stop.detail!, /left mode 0Dh/);
  assert.equal(debug.pixelHit, undefined); assert.equal(debug.pixelTarget, undefined);
  palette.dispose(); debug.dispose();
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
  const stopKind = () => debug.stop?.kind;
  assert.equal(stopKind(), "over");
  assert.deepEqual([machine.cpu.snapshot().cs, machine.cpu.snapshot().ip, machine.ram.read(0x449)], [0x9d27, 0x0878, 13]);
  // Start with a black frame. Between here and the stop, only a write to the
  // displayed page or a display register can light a dot (no blink in mode 0Dh).
  assertBlackPageZero(machine.ega);
  debug.setPlaneWatchpoints([{ address: 0x8013, space: "P0", enabled: true }]);
  const earlier = [];
  do {
    debug.runTo(parseXtDebugAddress(prepare.execution), { when: () => matchesXtDosObservation(prepare.expect, machine) });
    while (!debug.beforeStep()) checkEarlierVideoWrite(machine.ega, capture());
    const hit = debug.planeHit;
    if (hit && hit.write.before[0] !== hit.write.after[0]) earlier.push([hit.record.before.cs, hit.record.before.ip, hit.write.before[0], hit.write.after[0]]);
  } while (stopKind() === "watchpoint");
  assert.equal(debug.stop?.kind, "target", prepare.title);
  assert.deepEqual(earlier, [[0x9d27, 0x19aa, 0, 0xf0]]);
  assert.equal(machine.ega.planeByte(0, 0x8013), 0xf0);
  debug.step();
  const offscreen = capture();
  assert.equal(debug.stop?.kind, "watchpoint");
  const prepared = debug.planeHit!;
  assert.equal(prepared.record, offscreen);
  assert.deepEqual([offscreen.before.cs, offscreen.before.ip, offscreen.before.ah, offscreen.after.ip], [0x9d27, 0x197d, 15, 0x1980]);
  assert.deepEqual(offscreen.instruction?.bytes, [0x26, 0x08, 0x25]);
  assert.deepEqual(offscreen.instruction.bytes, [...file.slice(prepare.fileRange!.offset, prepare.fileRange!.offset + 3)]);
  assert.deepEqual(offscreen.instruction.bytes, [...disk.subarray(0x4417d, 0x44180)]);
  assert.deepEqual(offscreen.accesses.slice(3), [{ kind: "read", address: 0xa8013, value: 0xf0 }, { kind: "write", address: 0xa8013, value: 255 }]);
  assert.deepEqual(prepared.write, { address: 0x8013, offset: 0x8013, value: 255, writeMode: 0, enabledPlanes: 15, bitMask: 255,
    before: [240, 240, 240, 240], after: [255, 255, 255, 255] });
  assertBlackPageZero(machine.ega);
  // Keep watching through the copy: any intervening store to the source plane byte must stop us.
  debug.runTo(parseXtDebugAddress(logo.execution), { when: () => matchesXtDosObservation(logo.expect, machine) });
  while (!debug.beforeStep()) checkEarlierVideoWrite(machine.ega, capture());
  assert.equal(debug.stop?.kind, "target");
  const before = machine.ega.snapshot();
  assert.deepEqual([before.seq[2], before.gc[4], before.gc[5], before.gc[8], before.attr[0x12]], [9, 0, 0, 255, 15]);
  const selectedDot = () => xtEgaPixelReadout(machine.ega, 159, 75);
  assert.match(selectedDot(), /bit 0: 0 0 0 0 · index 0 · palette\[0\] = \$00 · #000000$/);
  const neighbour = createXtDebugger(() => machine);
  neighbour.runUntilPixelChanges(160, 75); debug.runUntilPixelChanges(159, 75);
  assert.equal(debug.beforeStep(), false); assert.equal(neighbour.beforeStep(), false);
  const paint = neighbour.capture(capture);
  assert.equal(debug.beforeStep(), true); assert.equal(debug.stop?.kind, "event");
  assert.equal(neighbour.beforeStep(), false); assert.equal(neighbour.pixelHit, undefined);
  neighbour.dispose();
  const hit = debug.pixelHit!;
  assert.equal(hit.record, paint);
  assert.deepEqual(hit.store, { source: "CPU", operand: { kind: "memory", segment: 0xa800, offset: 0x13,
    address: 0xa8013, value: 255, planeByte: { plane: 0, offset: 0x8013 } }, write: {
    address: 0x0bcb, offset: 0x0bcb, value: 255, writeMode: 0, enabledPlanes: 9, bitMask: 255,
    before: [0, 0, 0, 0], after: [255, 0, 0, 255],
  } });
  assert.deepEqual([hit.record.before.cs, hit.record.before.ip, hit.record.instruction?.bytes], [0x9d27, 0x1c1a, [0xf3, 0xa5]]);
  assert.deepEqual([hit.before.colour, hit.after.colour, hit.before.pins, hit.after.pins], ["#000000", "#5555FF", 0, 0x39]);
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
