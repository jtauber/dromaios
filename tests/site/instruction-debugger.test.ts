import assert from "node:assert/strict";
import { test } from "node:test";
import { createInstructionDebugger, decodeInstructionBreakpoints } from "../../site/interactive/instruction-debugger.js";
import { apple2DebugLocation, apple2DebugStep } from "../../site/interactive/apple2-debugger.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { instructionCatalogue6502 } from "../../site/6502-instruction-catalogue.js";
import { families } from "../../src/components/cpus/semantics/generated/6502.js";
import { Cpu6502 } from "../../src/components/cpus/generated/6502-cpu.js";
import { Ram } from "../../src/components/memory/ram.js";
import { createExecutionController } from "../../site/interactive/execution-controller.js";

const catalogue = instructionCatalogue6502(Object.values(families).flat());
const at = (address: number, space = "ram") => ({ address, space });
function program(parts: Readonly<Record<number, readonly number[]>>, budget = 100, sp = 0xff) {
  const ram = new Ram(65536);
  for (const [address, bytes] of Object.entries(parts)) bytes.forEach((byte, index) => ram.write(Number(address) + index, byte));
  const cpu = new Cpu6502(ram, { pc: 0x200, sp, x: 2, a: 0, y: 0, flags: { n: false, v: false, d: false, i: false, z: false, c: false } });
  const debug = createInstructionDebugger(budget), location = () => at(cpu.snapshot().pc);
  function step() {
    const before = location(), record = cpu.step(); assert.equal(record.outcome, "executed");
    debug.observe(apple2DebugStep(record, before, location(), catalogue));
    return record;
  }
  function run(maximum = 100): number {
    let count = 0;
    while (!debug.beforeStep(location())) { assert.ok(count++ < maximum, "Debugger should stop"); step(); }
    return count;
  }
  return { cpu, ram, debug, location, step, run };
}
const nested = { 0x200: [0x20, 0, 3, 0xea], 0x300: [0x20, 0, 4, 0x60], 0x400: [0xe8, 0x60] };

test("the chapter identifies only the four stacked control transfers, independently of their names", () => {
  assert.deepEqual(Object.entries(catalogue).filter(([, info]) => info?.stackFlow).map(([opcode, info]) => [+opcode, info?.stackFlow]),
    [[0, "interrupt"], [32, "call"], [64, "interrupt-return"], [96, "return"]]);
  const renamed = Object.values(families).flat().map(([opcode, definition]) => [opcode, { ...definition, name: "renamed" }] as const);
  assert.equal(instructionCatalogue6502(renamed)[0x20]?.stackFlow, "call");
});

test("Step over follows nested calls and tail jumps, including wrapped stack pointers", () => {
  for (const sp of [0xff, 0, 1]) {
    const p = program({ ...nested, 0x400: [0x4c, 0, 5], 0x500: [0xe8, 0x60] }, 100, sp);
    p.debug.over(p.location(), catalogue[0x20]?.stackFlow);
    assert.equal(p.run(), 6);
    assert.equal(p.debug.stop?.kind, "over"); assert.equal(p.cpu.snapshot().pc, 0x203);
    assert.equal(p.cpu.snapshot().sp, sp); assert.equal(p.cpu.snapshot().x, 3);
    assert.equal(p.debug.canStepOut, false);
  }
});

test("observed frames expose callers, entries and return addresses, and retain history limitations", () => {
  const p = program(nested); p.step(); p.step();
  assert.deepEqual(p.debug.frames.map(({ caller, entry, returnAddress, stack, kind }) => ({ caller, entry, returnAddress, stack, kind })), [
    { caller: at(0x200), entry: at(0x300), returnAddress: 0x203, stack: 0xff, kind: "call" },
    { caller: at(0x300), entry: at(0x400), returnAddress: 0x303, stack: 0xfd, kind: "call" },
  ]);
  const captured = p.debug.frames;
  p.step(); p.step(); assert.equal(p.debug.frames.length, 1); assert.equal(captured.length, 2);
  p.ram.write(0x303, 0x9a); p.step();
  assert.equal(p.debug.frames.length, 0); assert.match(p.debug.trackingNote!, /stack pointer/);
  // Later observations can form a new partial stack; the loss notice remains.
  p.ram.write(0x304, 0x20); p.ram.write(0x305, 0); p.ram.write(0x306, 4); p.step();
  assert.equal(p.debug.frames.length, 1); assert.match(p.debug.trackingNote!, /stack pointer/);
  p.debug.reset(); assert.deepEqual(p.debug.frames, []); assert.equal(p.debug.trackingNote, undefined);
});

test("observed call mappings are snapshots, and BRK records its padding-byte continuation", () => {
  const p = program({ 0x200: [0, 0], 0xfffe: [0, 3] });
  const before = at(0x200, "rom"), after = at(0x300, "lc-bank1"), record = p.cpu.step();
  p.debug.observe(apple2DebugStep(record, before, after, catalogue));
  before.space = after.space = "changed";
  assert.deepEqual(p.debug.frames[0], { id: 0, kind: "interrupt", caller: at(0x200, "rom"), entry: at(0x300, "lc-bank1"), returnAddress: 0x202, stack: 0xff });
});

test("Step out uses observed frames even after manual stepping, and supports recursion", () => {
  const p = program({ 0x200: [0x20, 0, 3], 0x300: [0xca, 0xf0, 3, 0x20, 0, 3, 0x60] });
  assert.throws(() => p.debug.out(p.location()), /No observed caller/);
  for (let i = 0; i < 4; i++) p.step(); // Enter the recursive call.
  p.debug.out(p.location()); assert.equal(p.run(), 3);
  assert.equal(p.cpu.snapshot().pc, 0x306); assert.equal(p.debug.stop?.kind, "out");
  assert.equal(p.debug.canStepOut, true);
  p.debug.out(p.location()); assert.equal(p.run(), 1); assert.equal(p.cpu.snapshot().pc, 0x203);
});

test("Step over an ordinary instruction performs one step, including a self-jump", () => {
  const p = program({ 0x200: [0x4c, 0, 2] });
  p.debug.over(p.location(), catalogue[0x4c]?.stackFlow);
  assert.equal(p.run(), 1); assert.equal(p.debug.stop?.kind, "step");
});

test("stepping crosses a newly added current breakpoint and stops on its next encounter", () => {
  const p = program({ 0x200: [0x4c, 0, 2] });
  p.debug.setBreakpoints([{ address: 0x200, enabled: true }]);
  p.debug.over(p.location()); assert.equal(p.run(), 1); assert.equal(p.debug.stop?.kind, "breakpoint");
});

test("Step over requires the return even when a call enters its own continuation address", () => {
  const p = program({ 0x200: [0x20, 3, 2, 0x60] });
  p.debug.over(p.location(), "call"); assert.equal(p.run(), 2);
  assert.equal(p.debug.stop?.kind, "over"); assert.equal(p.cpu.snapshot().pc, 0x203);
});

test("a breakpoint interrupts a large scheduled batch, and reset rejects its queued continuation", () => {
  const p = program(nested), jobs: (() => void)[] = [];
  const execution = createExecutionController({ step: p.step, canStep: () => true, pauseBeforeStep: () => p.debug.beforeStep(p.location()),
    onChange() {}, batchSize: 10000, schedule(callback) { jobs.push(callback); return () => {}; } });
  p.debug.setBreakpoints([{ address: 0x400, enabled: true }]);
  p.debug.run(p.location()); execution.run(); jobs.shift()!();
  assert.equal(execution.steps, 2); assert.equal(execution.running, false); assert.equal(p.cpu.snapshot().pc, 0x400);
  p.debug.run(p.location()); execution.run();
  execution.reset(); p.debug.reset(); jobs.shift()!();
  assert.equal(execution.steps, 0); assert.equal(p.cpu.snapshot().pc, 0x400);
});

test("BRK/RTI nest inside a stepped call without being mistaken for JSR/RTS", () => {
  const p = program({ 0x200: [0x20, 0, 3], 0x300: [0, 0, 0x60], 0x400: [0x40], 0xfffe: [0, 4] });
  p.debug.over(p.location(), "call"); assert.equal(p.run(), 4);
  assert.equal(p.debug.stop?.kind, "over"); assert.equal(p.cpu.snapshot().pc, 0x203);
});

test("a changed return address or stack replacement stops stepping with a reason", () => {
  for (const body of [[0xee, 0xfe, 1, 0x60], [0xa2, 0x40, 0x9a]]) {
    const p = program({ 0x200: [0x20, 0, 3], 0x300: body });
    p.debug.over(p.location(), "call"); p.run();
    assert.equal(p.debug.stop?.kind, "tracking-lost"); assert.equal(p.debug.canStepOut, false);
    assert.match(p.debug.stop!.detail!, /return|stack/);
  }
});

test("persistent breakpoints stop before execution and Continue crosses just one encounter", () => {
  const p = program({ 0x200: [0x4c, 0, 2] });
  p.debug.setBreakpoints([{ address: 0x200, enabled: true }]);
  p.debug.run(p.location()); assert.equal(p.run(), 0);
  p.debug.run(p.location()); assert.equal(p.run(), 1);
  p.debug.step(p.location()); p.step(); assert.equal(p.debug.beforeStep(p.location()), true);
  assert.equal(p.debug.stop?.kind, "step");
  assert.equal(p.debug.breakpoints[0]?.enabled, true);
});

test("a breakpoint interrupts Step over, retains callers, and cancels the temporary request", () => {
  const p = program(nested);
  p.debug.setBreakpoints([{ address: 0x400, enabled: true }]);
  p.debug.over(p.location(), "call"); assert.equal(p.run(), 2);
  assert.equal(p.debug.stop?.kind, "breakpoint"); assert.equal(p.debug.request, undefined);
  p.debug.out(p.location()); assert.equal(p.run(), 2);
  assert.equal(p.cpu.snapshot().pc, 0x303); assert.equal(p.debug.stop?.kind, "out");
});

test("mapping filters, disabled stops, and same-address remapping do not bypass breakpoints", () => {
  const debug = createInstructionDebugger();
  debug.setBreakpoints([{ address: 0xd000, space: "rom", enabled: true }, { address: 0x200, enabled: false }]);
  debug.run(at(0xd000, "lc-bank1")); assert.equal(debug.beforeStep(at(0xd000, "lc-bank1")), false);
  assert.equal(debug.beforeStep(at(0x200)), false);
  assert.equal(debug.beforeStep(at(0xd000, "rom")), true);
  debug.run(at(0xd000, "lc-bank1")); assert.equal(debug.beforeStep(at(0xd000, "rom")), true);
});

test("one-shot targets are mapping-aware, immediate at PC, and take precedence over their budget", () => {
  const p = program({ 0x200: [0xea, 0xea, 0xea] }, 2);
  p.debug.runTo(p.location(), 0x202); assert.equal(p.run(), 2); assert.equal(p.debug.stop?.kind, "target");
  p.debug.runTo(p.location(), 0x202); assert.equal(p.run(), 0);
  p.debug.runTo(p.location(), 0xfd21, "rom"); assert.equal(p.debug.beforeStep(at(0xfd21, "lc-upper")), false);
  assert.equal(p.debug.beforeStep(at(0xfd21, "rom")), true);
  for (const address of [-1, Number.MAX_SAFE_INTEGER + 1, NaN, 1.5]) assert.throws(() => p.debug.runTo(p.location(), address));
});

test("step requests that cannot finish stop at the instruction budget", () => {
  const p = program({ 0x200: [0x20, 0, 3], 0x300: [0x4c, 0, 3] }, 3);
  p.debug.over(p.location(), "call"); assert.equal(p.run(), 3);
  assert.equal(p.debug.stop?.kind, "limit"); assert.equal(p.debug.canStepOut, true);
});

test("pause cancels temporary requests; errors and reset clear callers but preserve breakpoints", () => {
  const p = program(nested); p.step(); p.debug.out(p.location());
  p.debug.setBreakpoints([{ address: 0x400, enabled: true }]);
  p.debug.pause(p.location()); assert.equal(p.debug.request, undefined); assert.equal(p.debug.canStepOut, true);
  p.debug.fail(p.location(), "read failed"); assert.equal(p.debug.stop?.kind, "error"); assert.equal(p.debug.canStepOut, false);
  p.debug.reset(); assert.equal(p.debug.stop, undefined); assert.equal(p.debug.breakpoints.length, 1);
});

test("breakpoint preferences reject malformed, duplicate, oversized and unknown mapping entries", () => {
  const points = [{ address: 0xfd21, space: "rom", enabled: true }, { address: 0x300, enabled: false }];
  assert.deepEqual(decodeInstructionBreakpoints(JSON.stringify(points), ["rom"], 0xffff), points);
  assert.deepEqual(decodeInstructionBreakpoints(JSON.stringify([...points, ...points, { address: 0, space: "unknown", enabled: true }]), ["rom"], 0xffff), points);
  for (const value of ["oops", "null", "{}", JSON.stringify(Array(65).fill(points[0])), '[{"address":-1,"enabled":true}]']) {
    assert.deepEqual(decodeInstructionBreakpoints(value, ["rom"], 0xffff), []);
  }
});

test("Apple II mapping checks do not touch keyboard, disk, or language-card soft switches", () => {
  const { machine } = createApple2Session();
  const original = { keyboard: machine.keyboard.snapshot(), disk: machine.disk.snapshot(), language: machine.language.snapshot() };
  machine.cpu = new Cpu6502(machine.memory, { ...machine.cpu.snapshot(), pc: 0xfd21 });
  assert.deepEqual(apple2DebugLocation(machine), at(0xfd21, "rom"));
  assert.deepEqual({ keyboard: machine.keyboard.snapshot(), disk: machine.disk.snapshot(), language: machine.language.snapshot() }, original);
  machine.language.read(0);
  assert.deepEqual(apple2DebugLocation(machine), at(0xfd21, "lc-upper"));
});
