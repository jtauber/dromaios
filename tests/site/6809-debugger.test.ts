import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6809 } from "../../src/components/cpus/generated/6809-cpu.js";
import { Ram } from "../../src/components/memory/ram.js";
import { createInstructionDebugger } from "../../site/interactive/instruction-debugger.js";
import { create6809DebugObserver } from "../../site/interactive/6809-debugger.js";
import { decode6809 } from "../../site/interactive/6809-disassembly.js";
import { instructionShape } from "../../site/instruction-shape.js";
import { catalogue6809 as catalogue, chapter6809, state6809 } from "./6809-inspection-fixture.js";

function program(parts: Readonly<Record<number, readonly number[]>>, s = 0x7000) {
  const ram = new Ram(65536);
  for (const [address, bytes] of Object.entries(parts)) bytes.forEach((byte, index) => ram.write((+address + index) & 0xffff, byte));
  const cpu = new Cpu6809(ram, state6809({ pc: 0x2000, s })), policy = createInstructionDebugger(100);
  const observer = create6809DebugObserver(policy, catalogue), location = () => ({ address: cpu.snapshot().pc, space: "ram" });
  const shape = () => decode6809(address => ram.read(address), cpu.snapshot().pc, catalogue).shape;
  function step() { const before = location(), record = cpu.step(); observer.observe(record, before, location()); return record; }
  function interrupt(source: "irq" | "firq") { const before = location(), record = cpu.interrupt(source); observer.observe(record, before, location()); return record; }
  function run() { let count = 0; while (!policy.beforeStep(location())) { assert.ok(count++ < 101); step(); } return count; }
  return { ram, cpu, policy, observer, location, shape, step, interrupt, run,
    over() { policy.over(location(), shape()?.stack?.flow); return run(); },
    out() { policy.out(location()); return run(); },
  };
}
const nested = { 0x2000: [0xbd, 0x21, 0, 0x12], 0x2100: [0x17, 0, 0xfd, 0x39], 0x2200: [0x4c, 0x39] };

test("6809 calls, interrupts, stack returns and stack replacement come from effects, independent of names", () => {
  const entries = Object.values(chapter6809.families).flat();
  for (const [opcode, expected] of [[0x8d, "call"], [0x17, "call"], [0x9d, "call"], [0xad, "call"], [0xbd, "call"],
    [0x39, "stack-return"], [0x3b, "stack-return"], [0x3f, "interrupt"], [0x103f, "interrupt"], [0x113f, "interrupt"]] as const) {
    const definition = { ...entries.find(([code]) => code === opcode)![1], name: "renamed" };
    assert.equal(instructionShape(definition.steps, opcode > 255 ? 2 : 1, 0x84, ["s", "u"]).stack?.flow, expected);
  }
  for (let mask = 0; mask < 256; mask++) for (const [opcode, register] of [[0x35, "s"], [0x37, "u"]] as const) {
    const row = decode6809(address => [opcode, mask][address], 0, catalogue);
    assert.deepEqual(row.shape?.stack, mask & 128 ? { flow: "stack-return", register } : undefined);
    assert.equal(row.shape?.replacedStacks?.includes(register === "s" ? "u" : "s") ?? false, !!(mask & 64));
  }
  for (const [bytes, replaced] of [[[0x1f, 0x14], true], [[0x1f, 0x41], false], [[0x32, 0xe4], false], [[0x32, 0x84], true]] as const) {
    assert.equal(decode6809(address => bytes[address], 0, catalogue).shape?.replacedStacks?.includes("s") ?? false, replaced);
  }
});

test("shared Step over/out follows 6809 nested calls, relative calls, tail jumps, and wrapped stacks", () => {
  for (const s of [0x7000, 0, 1]) {
    const p = program({ ...nested, 0x2200: [0x7e, 0x23, 0], 0x2300: [0x4c, 0x39] }, s);
    assert.equal(p.over(), 6); assert.equal(p.policy.stop?.kind, "over");
    assert.equal(p.cpu.snapshot().pc, 0x2003); assert.equal(p.cpu.snapshot().s, s);
    assert.equal(p.policy.frames.length, 0); assert.equal(p.cpu.snapshot().a, 0x1a);
  }
  const p = program({ ...nested, 0x2100: [0x8d, 0x0e, 0x39], 0x2110: [0x12, 0x39] });
  p.step(); p.step(); assert.equal(p.policy.frames.length, 2);
  assert.equal(p.policy.frames[1]?.entry.address, 0x2110);
  assert.equal(p.out(), 2); assert.equal(p.cpu.snapshot().pc, 0x2102);
  assert.equal(p.out(), 1); assert.equal(p.cpu.snapshot().pc, 0x2003);
});

test("register-pull returns match actual observed callers; arbitrary U-stack returns cannot consume an S frame", () => {
  const p = program({ ...nested, 0x2100: [0x34, 2, 0x4f, 0x35, 0x82] }); // save A; CLRA; PULS A,PC
  assert.equal(p.over(), 4); assert.equal(p.cpu.snapshot().a, 0x19); assert.equal(p.policy.stop?.kind, "over");
  const q = program({ ...nested, 0x2100: [0x37, 0x80] });
  q.ram.write(0x6000, 0x20); q.ram.write(0x6001, 3);
  q.over(); assert.equal(q.policy.stop?.kind, "tracking-lost"); assert.equal(q.policy.canStepOut, false);
});

test("indexed calls use the stack position after addressing; altered returns and explicit replacement stop tracking", () => {
  const p = program({ 0x2000: [0xad, 0xf1], 0x7000: [0x21, 0], 0x2100: [0x39] }); // JSR [,S++]
  assert.equal(p.over(), 2); assert.equal(p.policy.stop?.kind, "over"); assert.equal(p.cpu.snapshot().s, 0x7002);
  for (const body of [[0x10, 0xce, 0x60, 0], [0x6c, 0x61, 0x39]]) { // LDS #$6000; or INC 1,S / RTS
    const q = program({ ...nested, 0x2100: body }); q.over();
    assert.equal(q.policy.stop?.kind, "tracking-lost"); assert.equal(q.policy.canStepOut, false);
  }
});

test("software and external interrupt frames nest in calls and RTI restores full and short frames", () => {
  const p = program({ ...nested, 0x2100: [0x3f, 0x39], 0x2300: [0x3b], 0xfffa: [0x23, 0] });
  assert.equal(p.over(), 4); assert.equal(p.policy.stop?.kind, "over");
  for (const source of ["irq", "firq"] as const) {
    const q = program({ ...nested, 0x2100: [0x1c, 0xaf, 0x39], 0x2300: [0x3b], 0xfff6: [0x23, 0, 0x23, 0] });
    q.policy.over(q.location(), "call"); q.step(); q.step();
    assert.equal(q.interrupt(source).outcome, "accepted");
    assert.deepEqual(q.policy.frames.map(frame => frame.kind), ["call", "interrupt"]);
    assert.equal(q.policy.frames[1]?.returnAddress, 0x2102);
    q.run(); assert.equal(q.policy.stop?.kind, "over"); assert.equal(q.cpu.snapshot().pc, 0x2003);
  }
});

test("CWAI reuses its observed frame; restoring a waiting state never invents caller history", () => {
  for (const reset of [false, true]) {
    const p = program({ ...nested, 0x2100: [0x3c, 0xaf, 0x39], 0x2300: [0x3b], 0xfff6: [0x23, 0] });
    p.step(); p.step(); assert.equal(p.cpu.snapshot().waitMode, "cwai");
    if (reset) { p.policy.reset(); p.observer.reset(); }
    assert.equal(p.interrupt("firq").outcome, "accepted");
    if (reset) {
      assert.equal(p.policy.frames.length, 0); assert.match(p.policy.trackingNote!, /not observed/);
      assert.throws(() => p.policy.out(p.location()), /No observed caller/);
    } else {
      assert.equal(p.policy.frames.length, 2); assert.equal(p.policy.frames[1]?.stack, 0x6ffe);
      p.out(); assert.equal(p.cpu.snapshot().pc, 0x2102); assert.equal(p.cpu.snapshot().s, 0x6ffe);
      p.out(); assert.equal(p.cpu.snapshot().pc, 0x2003);
    }
  }
});

test("debug observations use captured bytes even after code changes and perform no bus reads", () => {
  const p = program(nested), before = p.location(), record = p.cpu.step();
  p.ram.write(0x2000, 0x12); p.ram.read = () => { throw new Error("Debugger must not read memory"); };
  p.observer.observe(record, before, p.location());
  assert.equal(p.policy.frames[0]?.returnAddress, 0x2003); assert.equal(p.policy.frames[0]?.stack, 0x7000);
});
