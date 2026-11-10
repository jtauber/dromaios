import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6809 } from "../../../../src/components/cpus/generated/6809-cpu.js";
import { fixture, flags } from "./timing-fixture.js";

// Motorola MC6809 datasheet figures 9/10 give 19/10 clocks before the next opcode.
// CWAI has already prepared its full frame and needs only the four-clock vector tail.
const entries = [
  { source: "irq", vector: 0xfff8, clocks: 19, bytes: 12 },
  { source: "firq", vector: 0xfff6, clocks: 10, bytes: 3 },
  { source: "nmi", vector: 0xfffc, clocks: 19, bytes: 12 },
] as const;

test("accepted IRQ/FIRQ/NMI costs depend on the pre-entry wait mode, with no additional bus access", () => {
  for (const waitMode of ["none", "sync", "cwai"] as const) for (const entry of entries) {
    const timed = fixture([], { waitMode, s: 1 }), ordinary = fixture([], { waitMode, s: 1 });
    for (const { ram } of [timed, ordinary]) {
      ram.write(entry.vector, 0x40); ram.write(entry.vector + 1, 0x00); ram.accesses.length = 0;
    }
    const { clocks, ...record } = timed.cpu.interruptTimed(entry.source);
    assert.equal(clocks, waitMode === "cwai" ? 4 : entry.clocks);
    assert.equal(record.outcome, "accepted"); assert.equal(record.after.waitMode, "none");
    assert.equal(record.accesses.filter(access => access.kind === "write").length, waitMode === "cwai" ? 0 : entry.bytes);
    assert.deepEqual(record, ordinary.cpu.interrupt(entry.source));
    assert.deepEqual(timed.ram.accesses, ordinary.ram.accesses);
    assert.deepEqual(record.accesses, timed.ram.accesses);
  }
});

test("SYNC pays its minimum once; masked wake-up and repeated waiting polls cost no further clocks", () => {
  for (const source of ["irq", "firq"] as const) {
    const { cpu, ram } = fixture([0x13, 0x12], { flags: { ...flags(), i: true, f: true } });
    const sync = cpu.stepTimed();
    assert.equal(sync.outcome, "waiting"); assert.equal(sync.clocks, 4);
    assert.deepEqual(sync.instruction?.bytes, [0x13]);
    ram.accesses.length = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = cpu.stepTimed();
      assert.equal(wait.clocks, 0); assert.equal(wait.outcome, "waiting");
      assert.equal(wait.instruction, null); assert.deepEqual(wait.accesses, []);
    }
    const wake = cpu.interruptTimed(source);
    assert.equal(wake.clocks, 0); assert.equal(wake.outcome, "resumed");
    assert.equal(wake.after.pc, 0x201); assert.deepEqual(ram.accesses, []);
    assert.equal(cpu.stepTimed().clocks, 2);
  }
});

test("CWAI preparation plus delivery totals 20, reuses the saved frame, and RTI restores it", () => {
  for (const { source, vector } of entries) {
    const { cpu, ram } = fixture([0x3c, 0xaf, 0x12], { flags: { ...flags(), i: true, f: true } });
    ram.write(vector, 0x40); ram.write(vector + 1, 0); ram.write(0x4000, 0x3b);
    const cwai = cpu.stepTimed();
    assert.equal(cwai.clocks, 16); assert.equal(cwai.outcome, "waiting");
    assert.equal(cwai.after.s, 0x7ff4); assert.equal(cwai.after.flags.e, true);
    assert.equal(cpu.stepTimed().clocks, 0);
    const interrupt = cpu.interruptTimed(source);
    assert.equal(interrupt.clocks, 4); assert.equal(cwai.clocks + interrupt.clocks, 20);
    assert.equal(interrupt.after.s, cwai.after.s); assert.equal(interrupt.after.pc, 0x4000);
    assert.deepEqual(interrupt.accesses.map(access => access.address), [vector, vector + 1]);
    const rti = cpu.stepTimed();
    assert.equal(rti.clocks, 15); assert.equal(rti.after.s, 0x8000); assert.equal(rti.after.pc, 0x202);
    assert.equal(cpu.stepTimed().clocks, 2);
  }
});

test("masked or unarmed offers cost zero and cannot wake CWAI; unarmed NMI also leaves SYNC waiting", () => {
  for (const waitMode of ["none", "sync", "cwai"] as const) for (const { source } of entries) {
    const { cpu, ram } = fixture([], { waitMode, nmiArmed: false, flags: { ...flags(), i: true, f: true } });
    const record = cpu.interruptTimed(source);
    assert.equal(record.clocks, 0);
    assert.equal(record.outcome, waitMode === "sync" && source !== "nmi" ? "resumed" : "ignored");
    assert.deepEqual(record.accesses, []); assert.deepEqual(ram.accesses, []);
    assert.equal(record.after.waitMode, record.outcome === "resumed" ? "none" : waitMode);
  }
});

test("timed boundaries reject reentrancy and invalid offers, preserve partial failures, and discard failed totals", () => {
  const { ram, cpu: initial } = fixture([0xa6, 0x91, 0x12]); // LDA [,X++] then NOP.
  let failRead = 0x4001, failWrite = -1;
  const failed = new Error("bus failure");
  const checkBoundary = () => {
    assert.throws(() => cpu.stepTimed(), /reentrant/);
    assert.throws(() => cpu.interruptTimed("irq"), /reentrant/);
    assert.throws(() => cpu.reset(), /reentrant/);
  };
  const cpu = new Cpu6809({ size: ram.size, read: address => {
    checkBoundary(); if (address === failRead) throw failed; return ram.read(address);
  }, write: (address, value) => {
    checkBoundary(); if (address === failWrite) throw failed; ram.write(address, value);
  } }, initial.snapshot());
  assert.throws(() => Reflect.apply(cpu.interruptTimed, cpu, ["swi"]), RangeError);
  assert.deepEqual(cpu.snapshot(), initial.snapshot());
  assert.throws(() => cpu.stepTimed(), error => error === failed);
  assert.equal(cpu.snapshot().x, 0x4002); assert.equal(cpu.snapshot().pc, 0x202);
  failRead = -1;
  assert.equal(cpu.stepTimed().clocks, 2); // Failed indexed cost cannot leak into NOP.
  failWrite = 0x7ffe;
  assert.throws(() => cpu.interruptTimed("irq"), error => error === failed);
  assert.equal(cpu.snapshot().s, 0x7ffe); // Second predecrement survives the write failure.
  failWrite = -1;
  assert.equal(cpu.interruptTimed("nmi").clocks, 19);
});
