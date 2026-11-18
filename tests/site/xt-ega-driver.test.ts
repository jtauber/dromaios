import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { romImages } from "../../src/machines/generated/8088/pc-xt-ega.js";
import { RomImage } from "../../src/machines/rom-image.js";
import { createXtEgaSession } from "../../site/interactive/xt-session.js";
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
const [entry, mode] = [steps[0]!, steps[1]!];
const { XT_BIOS_ROM, XT_BASIC_ROM, XT_EGA_ROM, XT_ULTIMA_EGA_PROGRAM } = process.env;

test("the EGA mode stop requires both the driver's INT instruction and the mode request", () => {
  const machine = createXtEgaSession().machine, state = { ...machine.cpu.snapshot(), ax: 13 };
  const match = () => matchesXtDosObservation(mode.expect, machine, state);
  machine.ram.write(0x9dae6, 0xcd); machine.ram.write(0x9dae7, 0x10);
  assert.ok(match());
  state.ax = 0x0f00; assert.equal(match(), false);
  state.ax = 13; machine.ram.write(0x9dae7, 0x21); assert.equal(match(), false);
});

test("Ultima loads EGA.DRV and executes its second jump slot before requesting mode 0Dh", {
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
  for (const step of steps) {
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
  debug.dispose(); activity.dispose();
});
