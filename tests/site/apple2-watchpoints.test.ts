import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../src/components/cpus/generated/6502-cpu.js";
import { create6502Apple2 } from "../../src/machines/generated/6502/apple2.js";
import { families } from "../../src/components/cpus/semantics/generated/6502.js";
import { instructionCatalogue6502 } from "../../site/6502-instruction-catalogue.js";
import { createApple2ChangeLog } from "../../site/interactive/apple2-change-log.js";
import { apple2DebugLocation, apple2DebugStep } from "../../site/interactive/apple2-debugger.js";
import { createInstructionDebugger } from "../../site/interactive/instruction-debugger.js";
import { createExecutionController } from "../../site/interactive/execution-controller.js";
import { addMemoryWatch, decodeMemoryWatches } from "../../site/interactive/apple2-watches.js";
import type { MemoryWatch, MemoryWatchMode } from "../../site/interactive/apple2-watches.js";
import { apple2Watchpoint, describeApple2Watchpoint } from "../../site/interactive/apple2-watchpoints.js";

const catalogue = instructionCatalogue6502(Object.values(families).flat());
const watch = (address: number, ...stop: MemoryWatchMode[]): MemoryWatch => ({ address, label: "", stop });
function example(bytes: readonly number[]) {
  const machine = create6502Apple2({ firmware: null });
  machine.cpu = new Cpu6502(machine.memory, { ...machine.cpu.snapshot(), pc: 0x200 });
  bytes.forEach((byte, index) => machine.ram.write(0x200 + index, byte));
  const log = createApple2ChangeLog(machine), debug = createInstructionDebugger();
  let watches: readonly MemoryWatch[] = [];
  function step() {
    const before = apple2DebugLocation(machine), record = log.capture(() => machine.cpu.step());
    debug.observe(apple2DebugStep(record, before, apple2DebugLocation(machine), catalogue));
    const hit = apple2Watchpoint(watches, record, catalogue, log.memoryChanges(record));
    if (hit) debug.watchpoint(apple2DebugLocation(machine), describeApple2Watchpoint(hit, record.instruction.address));
    return { record, hit };
  }
  return { machine, log, debug, step, setWatches(values: readonly MemoryWatch[]) { watches = values; } };
}

test("data-read watches exclude all operand fetches, including the late JSR high byte, but include pointers and stack pulls", () => {
  const p = example([0x20, 0x00, 0x03]);
  p.machine.ram.write(0x300, 0x60);
  p.setWatches([watch(0x200, "read"), watch(0x201, "read"), watch(0x202, "read")]);
  assert.equal(p.step().hit, undefined);
  p.setWatches([watch(0x1fe, "read")]);
  assert.deepEqual(p.step().hit, { address: 0x1fe, mode: "read", value: 2 });
  const indirect = example([0xb1, 0x10]); // LDA ($10),Y reads the zero-page pointer.
  indirect.machine.ram.write(0x10, 0x34); indirect.setWatches([watch(0x10, "read")]);
  assert.deepEqual(indirect.step().hit, { address: 0x10, mode: "read", value: 0x34 });
});

test("write watches see unchanged and protected writes; change watches require a real RAM change", () => {
  const p = example([0x8d, 0x00, 0x04, 0x8d, 0x00, 0xd0, 0x8d, 0x00, 0x04, 0x8d, 0x00, 0xd0]);
  p.machine.language.read(2); // ROM mapped, Language Card writes disabled.
  p.setWatches([watch(0x400, "change"), watch(0xd000, "change")]);
  assert.equal(p.step().hit, undefined); assert.equal(p.step().hit, undefined);
  p.setWatches([watch(0x400, "write"), watch(0xd000, "write")]);
  assert.deepEqual(p.step().hit, { address: 0x400, mode: "write", value: 0 });
  assert.deepEqual(p.step().hit, { address: 0xd000, mode: "write", value: 0 });
});

test("changed-byte stops observe both hidden Language Card banks and common upper RAM with recording off", () => {
  const p = example([0xa9, 0x55, 0x8d, 0x00, 0xd0, 0x8d, 0x00, 0xd0, 0x8d, 0x00, 0xe0]);
  p.log.recording = false;
  p.machine.firmware.read = () => { throw new Error("A watchpoint must not read firmware"); };
  p.setWatches([watch(0xd000, "change"), watch(0xe000, "change")]); p.step();
  for (const [region, address] of [["bank2", 0xd000], ["bank1", 0xd000], ["upper", 0xe000]] as const) {
    if (region === "bank1") { p.machine.language.read(9); p.machine.language.read(9); }
    assert.deepEqual(p.step().hit, { address, mode: "change", value: 0x55, change: { region, address, before: 0, after: 0x55 } });
    assert.equal(p.machine.language.ramRead(), false);
  }
  assert.deepEqual(p.log.entries(), []);
  assert.match(p.debug.stop!.detail!, /Instruction \$0208 changed \$E000 \(LC upper\): \$00 → \$55/);
});

test("device watchpoints use the captured value and never replay a keyboard or soft-switch access", () => {
  const p = example([0xad, 0x00, 0xc0, 0x8d, 0x10, 0xc0, 0xad, 0x00, 0xc0]);
  p.machine.keyboard.offer(65);
  let reads = 0, writes = 0;
  const read = p.machine.keyboard.read.bind(p.machine.keyboard), write = p.machine.keyboard.write.bind(p.machine.keyboard);
  p.machine.keyboard.read = address => { reads++; return read(address); };
  p.machine.keyboard.write = (address, value) => { writes++; return write(address, value); };
  p.setWatches([watch(0xc000, "read"), watch(0xc010, "write")]);
  assert.deepEqual(p.step().hit, { address: 0xc000, mode: "read", value: 0xc1 });
  assert.deepEqual(p.step().hit, { address: 0xc010, mode: "write", value: 0xc1 });
  assert.deepEqual(p.step().hit, { address: 0xc000, mode: "read", value: 0x41 });
  assert.equal(reads, 2); assert.equal(writes, 1);
});

test("the earliest watched access wins, including the read before a read-modify-write store", () => {
  const p = example([0xe6, 0x10, 0x20, 0, 3]);
  p.setWatches([watch(0x10, "read", "write", "change")]);
  assert.deepEqual(p.step().hit, { address: 0x10, mode: "read", value: 0 });
  p.setWatches([watch(0x1fe, "change"), watch(0x1ff, "change")]);
  assert.equal(p.step().hit?.address, 0x1ff, "Bus order wins over preference order");
});

test("a watchpoint interrupts Step over inside a scheduled batch, retaining calls and stopping before the next breakpoint", () => {
  const p = example([0x20, 0x00, 0x03]);
  [0xe6, 0x10, 0x60].forEach((byte, i) => p.machine.ram.write(0x300 + i, byte));
  p.setWatches([watch(0x10, "change")]);
  p.debug.setBreakpoints([{ address: 0x302, enabled: true }]);
  const jobs: (() => void)[] = [];
  const execution = createExecutionController({ step: p.step, canStep: () => true,
    pauseBeforeStep: () => p.debug.beforeStep(apple2DebugLocation(p.machine)), onChange() {}, batchSize: 10000,
    schedule(callback) { jobs.push(callback); return () => {}; } });
  p.debug.over(apple2DebugLocation(p.machine), "call"); execution.run(); jobs.shift()!();
  assert.equal(execution.steps, 2); assert.equal(execution.running, false);
  assert.equal(p.debug.stop?.kind, "watchpoint"); assert.equal(p.debug.stop?.location.address, 0x302);
  assert.equal(p.debug.request, undefined); assert.equal(p.debug.canStepOut, true);
  p.debug.run(apple2DebugLocation(p.machine)); execution.run(); jobs.shift()!();
  assert.equal(execution.steps, 2); assert.equal(p.debug.stop?.kind, "breakpoint");
  p.debug.out(apple2DebugLocation(p.machine)); execution.run(); jobs.shift()!();
  assert.equal(execution.steps, 3); assert.equal(p.debug.stop?.kind, "out");
});

test("manual stepping can stop on each write and Run resumes after the completed instruction", () => {
  const p = example([0xe6, 0x10, 0xe6, 0x10, 0xea]); p.setWatches([watch(0x10, "change")]);
  for (let count = 0; count < 2; count++) {
    p.debug.step(apple2DebugLocation(p.machine)); p.step();
    assert.equal(p.debug.beforeStep(apple2DebugLocation(p.machine)), true);
    assert.equal(p.debug.stop?.kind, "watchpoint"); assert.equal(p.machine.ram.read(0x10), count + 1);
  }
  p.debug.run(apple2DebugLocation(p.machine));
  assert.equal(p.debug.beforeStep(apple2DebugLocation(p.machine)), false); assert.equal(p.step().hit, undefined);
});

test("watch preferences preserve legacy display-only rows and stop modes when relabelled, rejecting invalid modes", () => {
  const legacy = { address: 0x32, label: "INVFLG" }, active = watch(0xc010, "read", "write");
  assert.deepEqual(decodeMemoryWatches(JSON.stringify([legacy, active])), [legacy, active]);
  assert.deepEqual(addMemoryWatch([active], "C010", "strobe")[0], { ...active, label: "strobe" });
  for (const stop of [true, "read", ["fetch"], [null], {}]) {
    assert.deepEqual(decodeMemoryWatches(JSON.stringify([{ ...legacy, stop }])), []);
  }
  assert.deepEqual(decodeMemoryWatches(JSON.stringify([{ ...active, stop: ["read", "read"] }]))[0]?.stop, ["read"]);
});
