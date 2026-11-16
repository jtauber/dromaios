import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { makeXtDataDisk } from "../../scripts/make-xt-data-disk.js";
import { romImages } from "../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../src/machines/rom-image.js";
import { createXtSession, type XtSessionState } from "../../site/interactive/xt-session.js";
import { createXtDebugger, parseXtDebugAddress } from "../../site/interactive/xt-debugger.js";
import { matchesXtDosObservation, type XtDosObservation } from "../../site/interactive/xt-dos-observation.js";
import type { XtCheckpoint } from "../../site/interactive/xt-rom-guide.js";
import { createXtDiskActivity } from "../../site/interactive/xt-disk-activity.js";
import { fat12FileRegions, inspectFat12 } from "../../site/interactive/fat12.js";
import { xtFileTransfers } from "../../site/interactive/xt-disk-file-transfers.js";
import { xtRomGuide } from "./xt-inspection-fixture.js";
import { screen } from "../machines/8088/pc-xt/rom-console.js";

const tour = xtRomGuide.walkthroughs.find(tour => tour.id === "hello-com")!;
const steps = tour.steps as readonly (XtCheckpoint & { expect: XtDosObservation })[];
const disk = makeXtDataDisk(), file = [...disk.subarray(7168, 7215)];

test("HELLO.COM's chapter guards reject stale code, wrong registers and an earlier prompt", () => {
  const { machine } = createXtSession(), { cpu, ram, video } = machine;
  file.forEach((byte, index) => ram.write(0xc6b0 + index, byte));
  const guard = steps[4]!.expect;
  assert.equal(matchesXtDosObservation(guard, machine), false);
  const state = { ...cpu.snapshot(), ax: 0x0900, ds: 0xc5b, dx: 0x10c };
  assert.equal(matchesXtDosObservation(guard, machine, state), true);
  ram.write(0xc6b3, 0x90);
  assert.equal(matchesXtDosObservation(guard, machine, state), false);
  ram.write(0xc6b3, 0xb4);
  // Set 80-column text display, then distinguish the old A> from a completed command.
  for (const [index, value] of [[1, 80], [6, 25], [9, 7]] as const) {
    machine.ports.writePort(0x3d4, index); machine.ports.writePort(0x3d5, value);
  }
  machine.ports.writePort(0x3d8, 0x29);
  const line = (row: number, value: string) => [...value.padEnd(80)].forEach((char, col) => video.write((row * 80 + col) * 2, char.charCodeAt(0)));
  line(1, "A>"); assert.equal(matchesXtDosObservation(steps.at(-1)!.expect, machine), false);
  line(0, "Hello from HELLO.COM on drive A.");
  assert.equal(matchesXtDosObservation(steps.at(-1)!.expect, machine), true);
  line(1, "A>HELLO.COM"); assert.equal(matchesXtDosObservation(steps.at(-1)!.expect, machine), false);
});

const { XT_BIOS_ROM, XT_BASIC_ROM, XT_CGA_ROM, XT_DOS_DISK } = process.env;
test("DOS loads HELLO.COM through every named stop, prints, terminates, and replays a mid-sector checkpoint", {
  skip: !(XT_BIOS_ROM && XT_BASIC_ROM && XT_CGA_ROM && XT_DOS_DISK) && "Set the XT firmware and DOS disk paths.",
}, async () => {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const image = (slot: keyof typeof romImages, path: string) => RomImage.verify(readFileSync(path), romImages[slot], digest);
  const bindings = { bios: await image("bios", XT_BIOS_ROM!), basic: await image("basic", XT_BASIC_ROM!), font: await image("font", XT_CGA_ROM!) };
  const dos = readFileSync(XT_DOS_DISK!);
  assert.equal(await digest(dos), "d79f283ebd2cd68e8dede44ed876da13c25024f7000bcb576177820388c424f4");
  const session = createXtSession(bindings);
  session.insertDisk("DOS.IMG", dos); session.powerOn("quick");
  const lastLine = () => screen(session.machine).filter(Boolean).at(-1);
  function until(done: () => boolean, limit = 3_000_000): void {
    for (let n = 0; n < limit; n++) {
      session.step();
      if (n % 512 === 0 && !session.keyboard.pasteRemaining && !session.keyboard.queuedBytes && done()) return;
    }
    assert.fail(screen(session.machine).join("\n"));
  }
  until(() => lastLine() === "Enter new date (mm-dd-yy):", 25_000_000);
  session.keyboard.paste("\n"); until(() => lastLine() === "Enter new time:");
  session.keyboard.paste("\n"); until(() => lastLine() === "A>"); until(() => !session.machine.io.disketteMotorOn);
  session.insertDisk("DATA.IMG", disk);
  const debug = createXtDebugger(() => session.machine), activity = createXtDiskActivity(() => session.machine.io);
  let boundaries = 0, halfway: { state: XtSessionState; boundaries: number } | undefined;
  const copies: { pc: number; address: number; value: number }[] = [];
  let writer = 0;
  const detach = session.machine.ram.observeWrites(write => {
    if (write.address >= 0xc6b0 && write.address < 0xc6df) copies.push({ pc: writer, address: write.address, value: write.after });
  });
  session.keyboard.paste("HELLO.COM\n");
  for (const [index, step] of steps.entries()) {
    const when = () => matchesXtDosObservation(step.expect, session.machine);
    if (step.event) debug.runToEvent(step.event, when);
    else debug.runTo(parseXtDebugAddress(step.execution!), { when });
    while (!debug.beforeStep()) {
      writer = session.machine.cpu.snapshot().pc;
      const record = debug.capture(() => activity.capture(() => session.step())); boundaries++;
      if (!halfway && record.dma?.offset === 7168 + 255) halfway = { state: session.snapshot(), boundaries };
      // Termination must not fall through into the string at 010C.
      if (index === 7) assert.notEqual(record.after.pc, 0xc6bc);
    }
    assert.equal(debug.stop?.kind, step.event ? "event" : "target", step.title);
    assert.ok(when(), step.title);
    const cpu = session.machine.cpu.snapshot(), ram = session.machine.ram;
    const bytes = (address: number, length: number) => Array.from({ length }, (_, i) => ram.read(address + i));
    if (index === 0) {
      assert.equal(debug.eventHit!.event.kind, "dma");
      assert.deepEqual(bytes(0xb3d0, 512), [...disk.subarray(7168, 7680)]);
      assert.equal(copies.length, 0, "The disk transfer has not copied any program bytes");
    } else if (index === 1) {
      assert.deepEqual([cpu.si, cpu.di, cpu.cx], [0x10, 0, 23]);
    } else if (index === 2) {
      assert.deepEqual(bytes(0xc6b0, 47), file);
      assert.deepEqual(bytes(0x1c5aa, 4), [0, 1, 0x5b, 0x0c]);
      assert.deepEqual(copies.map(copy => copy.address), Array.from({ length: 47 }, (_, i) => 0xc6b0 + i));
      assert.deepEqual(copies.map(copy => copy.value), file);
      assert.deepEqual([...new Set(copies.map(copy => copy.pc))], [0x7539, 0x753a]);
    } else if (index === 5) assert.ok(screen(session.machine).includes("Hello from HELLO.COM on drive A."));
    else if (index === 7) assert.equal(lastLine(), "A>");
  }
  detach();
  assert.ok(halfway);
  const end = session.snapshot(), finished = boundaries;
  const volume = inspectFat12(disk), hello = volume.entries.find(e => e.name === "HELLO.COM")!;
  const transfer = xtFileTransfers(fat12FileRegions(volume, hello), activity.entries()).find(t => t.kind === "data")!;
  assert.deepEqual([transfer.offset, transfer.bytes, transfer.address], [7168, 47, 0xb3d0]);
  session.restore(halfway.state); debug.reset(); activity.reset();
  for (let n = halfway.boundaries; n < finished; n++) activity.capture(() => session.step());
  assert.deepEqual(session.snapshot(), end);
  // Replay without inspectors too: neither the stops nor disk recording change the guest.
  const plain = createXtSession(bindings); plain.restore(halfway.state);
  for (let n = halfway.boundaries; n < finished; n++) plain.step();
  assert.deepEqual(plain.snapshot(), end);
  assert.deepEqual(session.machine.io.exportDiskette(), new Uint8Array(disk));
  activity.dispose(); debug.dispose();
});
