import assert from "node:assert/strict";
import { test } from "node:test";
import { create6809Coco } from "../../src/machines/generated/6809/coco.js";
import { Cpu6809 } from "../../src/components/cpus/generated/6809-cpu.js";
import { stepCoco } from "../../src/machines/6809/coco/runtime.js";
import { createCocoDebugger, cocoDebugLocation, decodeCocoAddressStops } from "../../site/interactive/coco-debugger.js";
import { createExecutionController } from "../../site/interactive/execution-controller.js";
import { previewCocoInstruction } from "../../site/interactive/coco-instruction-preview.js";
import { catalogue6809 as catalogue, state6809 } from "./6809-inspection-fixture.js";

function fixture(bytes: readonly number[], budget = 100) {
  let machine = create6809Coco({ firmware: null, extended: null });
  machine.cpu = new Cpu6809(machine.memory, state6809({ pc: 0x2000, dp: 0, a: 0x20, b: 0x34, d: 0x2034, s: 0x3100 }));
  bytes.forEach((byte, index) => machine.ram.write(0x2000 + index, byte));
  const debug = createCocoDebugger(() => machine, budget), jobs: (() => void)[] = [];
  const step = () => debug.capture(() => stepCoco(machine));
  const execution = createExecutionController({ step, canStep: () => true, pauseBeforeStep: debug.beforeStep,
    onChange() {}, batchSize: 10000, schedule(callback) { jobs.push(callback); return () => {}; } });
  return { get machine() { return machine; }, debug, execution, jobs, step,
    replace() { machine = create6809Coco({ firmware: null, extended: null }); debug.reset(); },
    run() { debug.run(); execution.run(); jobs.shift()!(); },
    runTo(address: number) { debug.runTo(address); execution.run(); jobs.shift()!(); },
    single() { debug.step(); execution.step(); },
  };
}

test("CoCo breakpoints stop before a large batch, continue once, and stop again on a loop", () => {
  const p = fixture([0x4c, 0x7e, 0x20, 0]); // INCA; JMP $2000
  p.debug.setBreakpoints([{ address: 0x2000, enabled: true }]);
  const before = p.machine.snapshot(); p.run();
  assert.equal(p.execution.steps, 0); assert.equal(p.debug.stop?.kind, "breakpoint");
  assert.deepEqual(p.machine.snapshot(), before);
  p.run(); assert.equal(p.execution.steps, 2); assert.equal(p.machine.cpu.snapshot().a, 0x21);
  assert.equal(p.execution.running, false); assert.equal(p.debug.stop?.kind, "breakpoint");
  p.single(); assert.equal(p.execution.steps, 3); assert.equal(p.debug.stop?.kind, "step");
  assert.equal(p.machine.cpu.snapshot().pc, 0x2001);
  p.debug.setBreakpoints([{ address: 0x2000, enabled: false }]); p.runTo(0x2001);
  assert.equal(p.execution.steps, 3); assert.equal(p.debug.stop?.kind, "target");
});

test("RAM watchpoints stop after unchanged stores and after every byte of a multi-byte store", () => {
  const p = fixture([0xb7, 0x12, 0x10, 0xb7, 0x12, 0x10, 0xfd, 0x30, 0, 0x12]);
  p.debug.setWatchpoints([{ address: 0x1210, enabled: true }]); p.run();
  assert.equal(p.execution.steps, 1); assert.equal(p.machine.cpu.snapshot().pc, 0x2003);
  assert.equal(p.debug.hit?.address, 0x1210); assert.equal(p.debug.hit?.before, 0); assert.equal(p.debug.hit?.after, 0x20);
  assert.match(p.debug.stop!.detail!, /Instruction \$2000 wrote RAM \$1210: \$00 → \$20/);
  p.run(); assert.equal(p.execution.steps, 2);
  assert.equal(p.debug.hit?.before, 0x20); assert.equal(p.debug.hit?.after, 0x20);
  p.debug.setWatchpoints([{ address: 0x3001, enabled: true }, { address: 0x3000, enabled: true }]); p.run();
  assert.equal(p.execution.steps, 3); assert.equal(p.debug.hit?.address, 0x3000, "first completed write, not first configured watch");
  assert.equal(p.machine.cpu.snapshot().pc, 0x2009);
  assert.equal(p.machine.ram.read(0x3000), 0x20); assert.equal(p.machine.ram.read(0x3001), 0x34);
  assert.equal(p.execution.running, false);
});

test("reads, disabled watches, ROM/device writes and host edits cannot claim a RAM write stop", () => {
  const p = fixture([0xb6, 0x12, 0x10, 0xb7, 0xa0, 0, 0xb7, 0xff, 0x20, 0xb7, 0x12, 0x10, 0x12]);
  p.debug.setWatchpoints([{ address: 0x1210, enabled: false }]);
  p.machine.ram.write(0x1210, 0x20); assert.equal(p.debug.hit, undefined);
  p.runTo(0x200c); assert.equal(p.execution.steps, 4); assert.equal(p.debug.stop?.kind, "target");
  p.debug.setWatchpoints([{ address: 0x1210, enabled: true }]);
  p.machine.cpu = new Cpu6809(p.machine.memory, { ...p.machine.cpu.snapshot(), pc: 0x2000 });
  p.runTo(0x2009); assert.equal(p.execution.steps, 7); assert.equal(p.debug.hit, undefined);
  assert.equal(p.debug.stop?.kind, "target");
  assert.throws(() => p.debug.setWatchpoints([{ address: 0x8000, enabled: true }]), /7FFF/);
  assert.equal(p.debug.watchpoints[0]?.address, 0x1210);
});

test("a watchpoint interrupts a target and reports interrupt stack writes as interrupt entry", () => {
  const p = fixture([0xb7, 0x12, 0x10, 0x12]);
  p.debug.setWatchpoints([{ address: 0x1210, enabled: true }]); p.runTo(0x2003);
  assert.equal(p.debug.stop?.kind, "watchpoint"); assert.equal(p.debug.request, undefined);
  p.debug.setWatchpoints([{ address: 0x30ff, enabled: true }]);
  p.machine.cpu = new Cpu6809(p.machine.memory, { ...p.machine.cpu.snapshot(), flags: { ...p.machine.cpu.snapshot().flags, f: false } });
  p.machine.pias.write(0x21, 5); p.machine.pias.setCarrierDetect(false);
  assert.equal(p.machine.pias.firq, true);
  p.runTo(0x2004);
  assert.equal(p.debug.hit?.record.instruction, null); assert.equal(p.debug.stop?.kind, "watchpoint");
  assert.match(p.debug.stop!.detail!, /FIRQ.*PC \$2003.*RAM \$30FF/);
  assert.equal(p.machine.cpu.snapshot().s, 0x30fd, "complete short interrupt frame before stopping");
});

test("watching and previewing never read the guest bus or acknowledge pending PIA interrupts", () => {
  const p = fixture([0xb7, 0x12, 0x10]);
  p.machine.pias.write(1, 5); p.machine.pias.setHorizontalSync(false); p.machine.pias.setKey("A", true);
  const before = p.machine.snapshot();
  p.machine.memory.read = () => { throw new Error("No debugger bus reads"); };
  p.debug.setBreakpoints([{ address: 0x2000, enabled: true }]);
  p.debug.setWatchpoints([{ address: 0x1210, enabled: true }]);
  assert.deepEqual(cocoDebugLocation(p.machine), { address: 0x2000, space: "ram" });
  p.run(); assert.equal(p.debug.stop?.kind, "breakpoint");
  previewCocoInstruction(p.machine, catalogue);
  assert.deepEqual(p.machine.snapshot(), before); assert.equal(p.debug.hit, undefined);
});

test("reset preserves preferences, detaches replaced RAM, and ignores partial writes on execution failure", () => {
  const p = fixture([0xb7, 0x12, 0x10]);
  p.debug.setWatchpoints([{ address: 0x1210, enabled: true }]); p.run();
  p.debug.setBreakpoints([{ address: 0x2000, enabled: true }]);
  const old = p.machine; p.replace();
  assert.equal(Boolean(p.debug.stop), false); assert.equal(p.debug.hit, undefined);
  assert.equal(p.debug.breakpoints.length, 1); assert.equal(p.debug.watchpoints.length, 1);
  p.machine.cpu = new Cpu6809(p.machine.memory, state6809({ pc: 0x2000 })); p.machine.ram.write(0x2000, 0x12);
  p.debug.capture(() => { old.ram.write(0x1210, 0x99); return stepCoco(p.machine); });
  assert.equal(p.debug.hit, undefined, "detached hardware must not produce a stop");
  assert.throws(() => p.debug.capture(() => { p.machine.ram.write(0x1210, 0x44); throw new Error("Failed after a write"); }), /Failed/);
  assert.equal(p.machine.ram.read(0x1210), 0x44); assert.equal(p.debug.hit, undefined); assert.equal(p.debug.stop?.kind, "error");
  assert.match(p.debug.stop!.detail!, /Failed after a write/);
});

test("targets retain their boundary budget and debugger preferences reject invalid or oversized addresses", () => {
  const p = fixture([0x20, 0xfe], 3); p.runTo(0x2002);
  assert.equal(p.execution.steps, 3); assert.equal(p.debug.stop?.kind, "limit");
  p.debug.runTo(0x2000, "rom"); assert.equal(p.debug.beforeStep(), false);
  p.debug.pause(); assert.equal(p.debug.request, undefined); assert.equal(p.debug.stop?.kind, "pause");
  const points = [{ address: 0x1210, enabled: true }, { address: 0x7fff, enabled: false }];
  assert.deepEqual(decodeCocoAddressStops(JSON.stringify([...points, points[0], { address: 0x8000, enabled: true }, { address: 1, space: "rom", enabled: true }]), 0x7fff), points);
  for (const text of ["{", "null", "{}", JSON.stringify(Array(65).fill(points[0])), '[{"address":0,"enabled":1}]']) {
    assert.deepEqual(decodeCocoAddressStops(text, 0x7fff), []);
  }
  for (const address of [-1, 0x10000, .5, NaN]) assert.throws(() => p.debug.setBreakpoints([{ address, enabled: true }]));
  assert.throws(() => p.debug.setWatchpoints([points[0]!, points[0]!]), /distinct/);
  p.debug.dispose();
});
