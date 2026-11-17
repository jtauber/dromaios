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
import { fat12FileRegions, inspectFat12, readFat12File } from "../../site/interactive/fat12.js";
import { createXtDosCalls, type DosCall } from "../../site/interactive/xt-dos-services.js";
import { dosCallLines } from "../../site/interactive/xt-dos-explanation.js";
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
  const activity = createXtDiskActivity(() => session.machine.io);
  const dosCalls = createXtDosCalls(xtRomGuide.dos, address => address < session.machine.ram.size ? session.machine.ram.read(address) : undefined);
  const debug = createXtDebugger(() => session.machine, undefined, dosCalls);
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
  const printed = dosCalls.entries().find(call => call.service.function === "09")!;
  assert.equal(Buffer.from(printed.buffer!.bytes).toString("ascii"), "Hello from HELLO.COM on drive A.\r\n");
  assert.equal(printed.state, "returned"); assert.equal(printed.result!.ax, 0x0924);
  assert.doesNotMatch(dosCallLines(printed, xtRomGuide.dos, printed).join("\n"), /Succeeded|Error /);
  assert.equal(dosCalls.entries().find(call => call.service.function === "4C")!.state, "no-return");
  assert.equal(dosCalls.entries().find(call => call.service.function === "4D")!.result!.ax, 0);
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

  // All DOS results are paired with the observed caller, without using loader or kernel addresses.
  function command(text: string, functions: readonly number[], checkpointCall: (call: DosCall) => boolean) {
    dosCalls.reset(); session.keyboard.paste(text + "\n");
    debug.setEventStops([...functions.flatMap(fn => (["call", "return"] as const).map(phase =>
      ({ kind: "dos" as const, phase, function: fn, enabled: true }))), { kind: "dos", phase: "error", function: 0x3e, enabled: true }]);
    debug.run();
    const hits: DosCall[] = [];
    let halfway: { state: XtSessionState; boundaries: number } | undefined;
    for (let n = 0; n < 3_000_000; n++) {
      debug.capture(() => session.step());
      if (debug.beforeStep()) {
        assert.equal(debug.stop!.kind, "event"); const call = debug.dosHit!; hits.push(call);
        if (!halfway && checkpointCall(call) && call.state === "pending") halfway = { state: session.snapshot(), boundaries: n + 1 };
        debug.run(); // Resume crosses this completed event once, without matching the history again.
      }
      if (n % 512 === 0 && !session.keyboard.pasteRemaining && !session.keyboard.queuedBytes && lastLine() === "A>") {
        assert.ok(halfway); return { hits, halfway, boundaries: n + 1 };
      }
    }
    assert.fail(screen(session.machine).join("\n"));
  }
  function recover(completed: ReturnType<typeof command>): readonly DosCall[] {
    const end = session.snapshot(), points = debug.eventStops, hits: DosCall[] = [];
    session.restore(completed.halfway.state); debug.reset(); debug.run();
    assert.deepEqual(debug.eventStops, points); assert.deepEqual(dosCalls.entries(), []);
    for (let n = completed.halfway.boundaries; n < completed.boundaries; n++) {
      debug.capture(() => session.step());
      if (debug.beforeStep()) { assert.equal(debug.stop!.kind, "event"); hits.push(debug.dosHit!); debug.run(); }
    }
    assert.deepEqual(session.snapshot(), end, "Stopping and restoring mid-call preserve every guest byte and clock");
    assert.equal(lastLine(), "A>"); return hits;
  }
  const readStops = command("TYPE README.TXT", [0x3d, 0x3f], call => call.service.function === "3F");
  const opened = dosCalls.entries().find(call => call.service.function === "3D")!;
  assert.equal(Buffer.from(opened.buffer!.bytes).toString("ascii"), "README.TXT");
  assert.equal(opened.result!.ax, 5); assert.equal(opened.result!.carry, false);
  const reads = dosCalls.entries().filter(call => call.service.function === "3F");
  assert.deepEqual(reads.map(call => call.result!.ax), [58, 0]);
  assert.ok(reads.every(call => call.buffer!.length === 65024 && !call.result!.carry));
  const readmeText = "Dromaios XT data disk.\r\nDOS read this file from drive A.\r\n";
  assert.equal(Buffer.from(reads[0]!.result!.buffer!.bytes).toString("ascii"), readmeText);
  assert.deepEqual(reads[1]!.result!.buffer!.bytes, []);
  const invalidClose = dosCalls.entries().find(call => call.service.function === "3E" && call.result?.carry)!;
  assert.equal(invalidClose.result!.ax, 6);
  assert.match(dosCallLines(invalidClose, xtRomGuide.dos, invalidClose).join("\n"), /Error 0006 · Invalid handle/);
  assert.deepEqual(readStops.hits.filter(call => call.service.function === "3F").map(call => [call.state, call.result?.ax]),
    [["pending", undefined], ["returned", 58], ["pending", undefined], ["returned", 0]]);
  assert.ok(readStops.hits.some(call => call.service.function === "3E" && call.result?.carry && call.result.ax === 6));
  const replayReads = recover(readStops).filter(call => call.service.function === "3F");
  assert.deepEqual(replayReads.map(call => [call.state, call.result?.ax]), [["pending", undefined], ["returned", 0]],
    "The first read's uncaptured return is ignored after restoration; the next read still stops at EOF");
  until(() => !session.machine.io.disketteMotorOn);
  session.insertDisk("DATA.IMG", disk, { writable: true });
  const writeStops = command("ECHO HELLO>SAVE.TXT", [0x3c, 0x40],
    call => call.service.function === "40" && Buffer.from(call.buffer!.bytes).toString("ascii") === "HELLO");
  const created = dosCalls.entries().find(call => call.service.function === "3C")!;
  assert.equal(Buffer.from(created.buffer!.bytes).toString("ascii"), "SAVE.TXT");
  assert.equal(created.result!.carry, false); assert.equal(created.result!.ax, 5);
  const written = dosCalls.entries().find(call => call.service.function === "40" && Buffer.from(call.buffer!.bytes).toString("ascii") === "HELLO")!;
  assert.equal(written.arguments.find(arg => arg.register === "BX")!.value, 1, "Standard output is redirected to SAVE.TXT");
  assert.equal(written.result!.ax, 5); assert.equal(written.result!.carry, false);
  const following = dosCalls.entries().find(call => call.id > written.id && call.service.function === "40")!;
  assert.equal(Buffer.from(following.buffer!.bytes).toString("ascii"), "\r\n"); assert.equal(following.result!.ax, 2);
  const exported = session.machine.io.exportDiskette(), savedVolume = inspectFat12(exported);
  const savedFile = savedVolume.entries.find(file => file.name === "SAVE.TXT")!;
  assert.equal(Buffer.from(readFat12File(exported, savedVolume, savedFile)).toString("ascii"), "HELLO\r\n");
  assert.equal(Buffer.from(reads[0]!.result!.buffer!.bytes).toString("ascii"), readmeText, "History retains captured bytes after reuse of guest RAM");
  assert.deepEqual(writeStops.hits.filter(call => call.id >= written.id && call.id <= following.id).map(call => [call.state, call.result?.ax]),
    [["pending", undefined], ["returned", 5], ["pending", undefined], ["returned", 2]]);
  const replayWrites = recover(writeStops).filter(call => call.service.function === "40");
  assert.deepEqual(replayWrites.slice(0, 2).map(call => [call.state, call.result?.ax]), [["pending", undefined], ["returned", 2]]);
  assert.ok(replayWrites.every(call => Buffer.from(call.buffer!.bytes).toString("ascii") !== "HELLO"), "The restored HELLO write has no captured call");
  assert.deepEqual(session.machine.io.exportDiskette(), exported, "The writable image survives a mid-write restoration");
  activity.dispose(); debug.dispose();
});
