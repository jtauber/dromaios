import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Cpu8088 } from "../../src/components/cpus/generated/8088-cpu.js";
import { RomImage } from "../../src/machines/rom-image.js";
import { create8088PcXt, romImages } from "../../src/machines/generated/8088/pc-xt.js";
import { stepTimedXtCpu } from "../../src/machines/8088/pc-xt/interrupts.js";
import { createXtSession } from "../../site/interactive/xt-session.js";
import { createXtIoTrace } from "../../site/interactive/xt-io-trace.js";
import { createXtDebugger, parseXtDebugAddress } from "../../site/interactive/xt-debugger.js";
import { xtRomGuide as guide } from "./xt-inspection-fixture.js";
import { waitingForKey } from "../machines/8088/pc-xt/rom-console.js";

function fixture(bytes: readonly number[]) {
  const machine = create8088PcXt({ bios: null, basic: null, font: null });
  machine.cpu = new Cpu8088(machine.memory, { ...machine.cpu.snapshot(), cs: 0, ip: 0x2000, ss: 0x1000, sp: 0x8000,
    ax: 0x1234, dx: 0xffff }, { ports: { readPort: port => port === 0xffff ? 0x56 : 0x78, writePort() {} } });
  bytes.forEach((byte, i) => machine.ram.write(0x2000 + i, byte));
  return machine;
}

test("XT port trace retains ordered byte transfers, exact callers, boundary times and bounded history", () => {
  const machine = fixture([0xef, 0xed, 0xb0, 0xcf, 0x90]), trace = createXtIoTrace(3);
  const first = stepTimedXtCpu(machine).record;
  trace.observe(first, machine.io.clock.ticks); assert.deepEqual(trace.entries(), []);
  trace.recording = true; trace.observe(first, machine.io.clock.ticks);
  assert.deepEqual(trace.entries().map(e => e.transfer), [
    { kind: "output", port: 0xffff, value: 0x34 }, { kind: "output", port: 0, value: 0x12 },
  ]);
  const second = stepTimedXtCpu(machine).record; trace.observe(second, machine.io.clock.ticks);
  assert.equal(trace.captured, 4); assert.equal(trace.discarded, 1);
  assert.deepEqual(trace.entries().map(e => [e.sequence, e.transfer]), [
    [2, { kind: "output", port: 0, value: 0x12 }], [3, { kind: "input", port: 0xffff, value: 0x56 }],
    [4, { kind: "input", port: 0, value: 0x78 }],
  ]);
  assert.deepEqual(trace.entries()[1]!.caller, { address: 0x2001, space: "CS:IP 0000:2001" });
  assert.equal(trace.entries()[2]!.ticks, machine.io.clock.ticks);
  trace.observe(stepTimedXtCpu(machine).record, machine.io.clock.ticks); // CF is MOV's immediate, not IRET.
  assert.equal(trace.captured, 4);
  trace.clear(); assert.equal(trace.recording, true); assert.equal(trace.captured, 0); assert.equal(trace.discarded, 0);
  assert.throws(() => createXtIoTrace(0), /capacity/);
});

test("XT trace identifies software entry, NMI, pending traps and prefixed IRET without inventing INTA", () => {
  for (const source of ["software", "nmi", "trap"] as const) {
    const machine = fixture([0xcd, 0x20]), trace = createXtIoTrace(); trace.recording = true;
    const vector = source === "software" ? 0x20 : source === "nmi" ? 2 : 1;
    [0, 0x30, 0, 0].forEach((byte, i) => machine.ram.write(vector * 4 + i, byte));
    machine.ram.write(0x3000, 0x2e); machine.ram.write(0x3001, 0xcf);
    if (source === "trap") machine.cpu = new Cpu8088(machine.memory, { ...machine.cpu.snapshot(), trapPending: true });
    const entry = source === "nmi" ? machine.cpu.interruptTimed("nmi") : machine.cpu.stepTimed();
    assert.notEqual(entry.outcome, "ignored");
    if (entry.outcome === "ignored") assert.fail("NMI was not accepted");
    trace.observe(entry, 100); trace.observe(machine.cpu.stepTimed(), 200);
    assert.deepEqual(trace.entries().map(e => e.transfer.kind), ["interrupt", "iret"]);
    const interrupt = trace.entries()[0]!.transfer;
    assert.equal(interrupt.kind, "interrupt");
    if (interrupt.kind === "interrupt") { assert.equal(interrupt.source, source); assert.equal(interrupt.vector, vector); }
    const returned = trace.entries()[1]!.transfer;
    assert.equal(returned.kind, "iret");
    if (returned.kind === "iret") assert.equal(returned.target.space, source === "software" ? "CS:IP 0000:2002" : "CS:IP 0000:2000");
  }
});

test("PIC inspection is detached and cannot read the guest bus, acknowledge a key, copy a disk or advance time", t => {
  const machine = fixture([0xe4, 0x60]), trace = createXtIoTrace(); trace.recording = true;
  const record = stepTimedXtCpu(machine).record;
  for (const [port, value] of [[0x20, 0x13], [0x21, 8], [0x21, 9], [0x21, 0xff], [0x63, 0x99], [0x61, 0x4c]]) machine.io.write(port!, value!);
  machine.io.offerScanCode(0x1e);
  const masked = machine.io.interruptState(); assert.equal(masked.pic.irr, 2); assert.equal(masked.vector, null);
  machine.io.write(0x21, 0xfd);
  const before = machine.snapshot();
  t.mock.method(machine.io, "snapshot", () => assert.fail("Copied the board and its media"));
  const accessed = () => assert.fail("Inspection executed a device transfer");
  t.mock.method(machine.memory, "read", accessed); t.mock.method(machine.ports, "readPort", accessed);
  t.mock.method(machine.io, "read", accessed); t.mock.method(machine.io, "acknowledge", accessed);
  for (let i = 0; i < 20; i++) {
    trace.observe(record, machine.io.clock.ticks);
    const state = machine.io.interruptState();
    assert.equal(state.vector, 9); assert.equal(state.pic.irr, 2); assert.equal(state.pic.isr, 0);
    (state.pic as { irr: number }).irr = 0;
  }
  t.mock.restoreAll(); assert.deepEqual(machine.snapshot(), before);
});

test("a real keypress follows the chapter's IRQ1 stops through IN, receiver clear, EOI and IRET, with exact replay", {
  skip: !(process.env.XT_BIOS_ROM && process.env.XT_BASIC_ROM && process.env.XT_CGA_ROM)
    && "Set XT_BIOS_ROM, XT_BASIC_ROM and XT_CGA_ROM for the original keyboard walkthrough.",
}, async () => {
  const image = (slot: keyof typeof romImages, path: string) => RomImage.verify(readFileSync(path), romImages[slot],
    async bytes => createHash("sha256").update(bytes).digest("hex"));
  const bindings = { bios: await image("bios", process.env.XT_BIOS_ROM!), basic: await image("basic", process.env.XT_BASIC_ROM!),
    font: await image("font", process.env.XT_CGA_ROM!) };
  const session = createXtSession(bindings); session.powerOn("quick");
  let booted = false;
  for (let i = 0; i < 8_000_000; i++) { session.step(); if (waitingForKey(session.machine)) { booted = true; break; } }
  assert.ok(booted);
  session.keyboard.down("KeyA"); session.keyboard.up("KeyA");
  const start = session.snapshot(), trace = createXtIoTrace(), debug = createXtDebugger(() => session.machine);
  trace.recording = true;
  let count = 0;
  const step = () => { const record = debug.capture(() => session.step()); count++;
    trace.observe(record, session.machine.io.clock.ticks); return record; };
  const tour = guide.walkthroughs.find(tour => tour.id === "keyboard-irq")!;
  function reach(index: number): void {
    debug.runTo(parseXtDebugAddress(tour.steps[index]!.execution!));
    while (!debug.beforeStep()) step();
    assert.equal(debug.stop?.kind, "target");
  }
  reach(0);
  const frame = debug.frames.at(-1)!;
  assert.equal(frame.kind, "interrupt"); assert.equal(session.machine.io.interruptState().pic.isr & 2, 2);
  assert.equal(session.machine.cpu.snapshot().flags.if, false);
  assert.ok(trace.entries().some(e => e.transfer.kind === "acknowledge" && e.transfer.value === 9));
  reach(1); debug.step(); const read = step();
  assert.ok(read.accesses.some(a => a.kind === "input" && a.port === 0x60 && a.value === 0x1e));
  const saved = session.snapshot(), savedCount = count, savedSequence = trace.captured;
  reach(2); debug.step(); step();
  assert.equal(session.machine.io.interruptState().pic.levels & 2, 0);
  assert.equal(session.machine.io.interruptState().pic.isr & 2, 2);
  reach(3); debug.step(); const eoi = step();
  assert.ok(eoi.accesses.some(a => a.kind === "output" && a.port === 0x20 && a.value === 0x20));
  assert.equal(session.machine.io.interruptState().pic.isr & 2, 0); assert.equal(debug.frames.at(-1)!.id, frame.id);
  assert.deepEqual([0x41c, 0x41e, 0x41f].map(a => session.machine.ram.read(a)), [0x20, 0x61, 0x1e]);
  reach(4); debug.step(); step();
  assert.equal(debug.frames.length, 0); assert.equal(session.machine.cpu.snapshot().pc, frame.returnAddress);
  assert.equal(session.machine.cpu.snapshot().flags.if, true);
  assert.equal(trace.entries().at(-1)!.transfer.kind, "iret");
  const completed = count, end = session.snapshot(), history = trace.entries().filter(e => e.sequence > savedSequence).map(({ sequence, ...event }) => event);

  session.restore(saved); debug.reset(); trace.clear(); count = savedCount;
  // Re-run the same remaining boundaries, without relying on an unobserved frame after restore.
  const plain = createXtSession(bindings); plain.restore(start);
  for (let i = 0; i < completed; i++) plain.step();
  assert.deepEqual(plain.snapshot(), end);
  const remaining = completed - savedCount;
  for (let i = 0; i < remaining; i++) step();
  assert.deepEqual(session.snapshot(), end);
  assert.deepEqual(trace.entries().map(({ sequence, ...event }) => event), history);
  debug.dispose();
});
