import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../src/components/cpus/generated/8088-cpu.js";
import { create8088PcXt } from "../../src/machines/generated/8088/pc-xt.js";
import { stepTimedXtCpu } from "../../src/machines/8088/pc-xt/interrupts.js";
import { createXtDebugger } from "../../site/interactive/xt-debugger.js";
import { createXtDosCalls } from "../../site/interactive/xt-dos-services.js";
import { matchesXtDosEvent, matchesXtEvent, type XtEventStop } from "../../site/interactive/xt-event-stops.js";
import { xtRomGuide } from "./xt-inspection-fixture.js";

function fixture(ah = 0x3f, carry = false) {
  let machine = create8088PcXt({ bios: null, basic: null, font: null });
  machine.cpu = new Cpu8088(machine.memory, { ...machine.cpu.snapshot(), cs: 0x100, ip: 0, ss: 0x200, sp: 0x100,
    ax: ah << 8, ds: 0x300, dx: 0, cx: 4, bx: 5 });
  const put = (address: number, bytes: readonly number[]) => bytes.forEach((byte, i) => machine.ram.write(address + i, byte));
  put(0x84, [0, 0, 0, 4]); put(0x1000, [0xcd, 0x21, 0x90]); put(0x3000, [65, 66, 36]);
  // Return AX=2 or error 6, setting the caller's saved flags before IRET.
  put(0x4000, [0xb8, carry ? 6 : 2, 0, 0x36, 0xc6, 0x06, 0xfe, 0, +carry, 0xcf]);
  const calls = createXtDosCalls(xtRomGuide.dos, address => machine.ram.read(address));
  const debug = createXtDebugger(() => machine, 100, calls);
  const step = () => debug.capture(() => stepTimedXtCpu(machine).record);
  const drain = () => { for (let n = 0; n < 100 && !debug.beforeStep(); n++) step(); assert.ok(debug.stop); };
  return { get machine() { return machine; }, calls, debug, step, drain, put,
    restore(state: ReturnType<typeof machine.snapshot>) { machine = create8088PcXt({ bios: null, basic: null, font: null }, state); debug.reset(); },
  };
}
const stop = (phase: "call" | "return" | "error", fn?: number): XtEventStop => ({ kind: "dos", phase, ...(fn !== undefined && { function: fn }), enabled: true });

test("DOS stops follow complete entry and exact return, interrupt Step over/out, and resume once", () => {
  const f = fixture(); f.debug.setEventStops([stop("call", 0x3f), stop("return", 0x3f)]);
  f.debug.over(); f.drain();
  assert.equal(f.debug.stop!.kind, "event"); assert.equal(f.debug.dosHit!.state, "pending");
  assert.equal(f.machine.cpu.snapshot().pc, 0x4000); assert.equal(f.machine.cpu.snapshot().sp, 0xfa);
  assert.equal(f.debug.frames.length, 1); assert.equal(f.debug.eventHit, undefined);
  const entered = f.debug.dosHit!;
  assert.equal(matchesXtDosEvent(stop("return"), entered), false);
  assert.equal(matchesXtDosEvent(stop("call", 0x40), entered), false);
  assert.equal(matchesXtDosEvent({ kind: "iret" }, entered), false);
  assert.equal(matchesXtEvent(stop("call"), { kind: "iret", target: { address: 0x1002, space: "CS:IP 0100:0002" } }), false);
  f.debug.out(); f.drain();
  assert.equal(f.debug.stop!.kind, "event"); assert.equal(f.debug.dosHit!.result!.ax, 2);
  assert.equal(f.debug.dosHit!.id, entered.id); assert.equal(entered.state, "pending");
  assert.equal(f.machine.cpu.snapshot().pc, 0x1002); assert.equal(f.debug.frames.length, 0);
  f.debug.step(); f.step(); assert.equal(f.debug.stop!.kind, "step"); assert.equal(f.debug.dosHit, undefined);
  assert.equal(f.machine.cpu.snapshot().pc, 0x1003); f.debug.dispose();
});

test("DOS errors follow declared carry semantics; disabled, nonreturning and unsupported services do not invent results", () => {
  for (const ah of [0x3c, 0x3d, 0x3e, 0x3f, 0x40, 9, 0x4d, 0x4c, 0xff]) {
    const f = fixture(ah, true); f.debug.setEventStops([stop("error"), { ...stop("call"), enabled: false }]);
    f.debug.runTo({ address: 0x1002 }); f.drain();
    const reportsError = [0x3c, 0x3d, 0x3e, 0x3f, 0x40].includes(ah);
    assert.equal(f.debug.stop!.kind, reportsError ? "event" : "target");
    assert.equal(f.debug.dosHit?.result?.ax, reportsError ? 6 : undefined);
    if (reportsError) assert.equal(f.debug.dosHit!.result!.buffer, undefined);
    if (ah === 0x4c) {
      const call = f.calls.entries()[0]!;
      assert.equal(matchesXtDosEvent(stop("call"), call), true);
      assert.equal(matchesXtDosEvent(stop("return"), call), false);
    }
    f.debug.dispose();
  }
  const success = fixture(); success.debug.setEventStops([stop("error")]);
  success.debug.runTo({ address: 0x1002 }); success.drain(); assert.equal(success.debug.stop!.kind, "target"); success.debug.dispose();
});

test("RAM and raw interrupt stops retain priority while DOS still captures entry and return", () => {
  const f = fixture(); f.debug.setEventStops([stop("call"), stop("return"), { kind: "interrupt", vector: 0x21, enabled: true }]);
  f.debug.setWatchpoints([{ address: 0x20fe, enabled: true }]); f.debug.run(); f.drain();
  assert.equal(f.debug.stop!.kind, "watchpoint"); assert.equal(f.debug.dosHit, undefined); assert.equal(f.calls.entries().length, 1);
  f.debug.setWatchpoints([]); f.debug.run(); f.drain(); assert.equal(f.debug.dosHit!.state, "returned");
  f.machine.cpu = new Cpu8088(f.machine.memory, { ...f.machine.cpu.snapshot(), cs: 0x100, ip: 0, ax: 0x3f00 });
  f.debug.run(); f.drain(); assert.equal(f.debug.eventHit!.event.kind, "interrupt"); assert.equal(f.debug.dosHit, undefined);
  assert.equal(f.calls.entries().at(-1)!.state, "pending"); f.debug.dispose();
});

test("checkpoint restoration keeps DOS stop preferences, clears pending calls, and replays captured returns exactly", () => {
  const f = fixture(), before = f.machine.snapshot(), points = [stop("call"), stop("return")];
  f.debug.setEventStops(points); f.debug.run(); f.drain(); const during = f.machine.snapshot();
  f.debug.run(); f.drain(); const after = f.machine.snapshot(), result = f.debug.dosHit!.result;
  f.restore(during); assert.deepEqual(f.debug.eventStops, points); assert.equal(f.debug.dosHit, undefined);
  assert.deepEqual(f.calls.entries(), []);
  f.debug.runTo({ address: 0x1002 }); f.drain(); assert.equal(f.debug.stop!.kind, "target");
  assert.equal(f.debug.dosHit, undefined); assert.deepEqual(f.machine.snapshot(), after);
  f.restore(before); f.debug.run(); f.drain(); assert.deepEqual(f.machine.snapshot(), during);
  f.debug.run(); f.drain(); assert.deepEqual(f.machine.snapshot(), after); assert.deepEqual(f.debug.dosHit!.result, result);
  // Clearing the inspection history has the same pairing rule as restoration.
  f.restore(before); f.debug.run(); f.drain(); f.calls.reset();
  f.debug.runTo({ address: 0x1002 }); f.drain(); assert.equal(f.debug.stop!.kind, "target"); f.debug.dispose();
});
