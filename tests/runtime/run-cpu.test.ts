import { Cpu6809 } from "../../src/components/cpus/6809.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6800 } from "../../src/components/cpus/6800.js";
import { Ram } from "../../src/components/memory/ram.js";
import { Cpu6502 } from "../../src/components/cpus/6502.js";
import { runCpu } from "../../src/runtime/run-cpu.js";
import { create8080Example } from "../../src/machines/generated/8080/example.js";
import { create6502Example } from "../../src/machines/generated/6502/example.js";
import { create6809Example } from "../../src/machines/generated/6809/example.js";

import { createZ80Example } from "../../src/machines/generated/z80/example.js";

test("invalid run options are rejected before inspecting or stepping the CPU", () => {
  const cpu = {
    snapshot: () => { throw new Error("unexpected inspection"); },
    step: () => { throw new Error("unexpected step"); },
  };
  const invalid = [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1];
  for (const value of invalid) {
    assert.throws(() => runCpu(cpu, { maxSteps: value }), RangeError);
    assert.throws(() => runCpu(cpu, { maxSteps: 0, endAddress: value }), RangeError);
  }
  // JavaScript callers must not get silent coercion or an unbounded run.
  // @ts-expect-error maxSteps is required, including at runtime.
  assert.throws(() => runCpu(cpu, {}), RangeError);
  // @ts-expect-error String budgets are invalid host values.
  assert.throws(() => runCpu(cpu, { maxSteps: "2" }), RangeError);
  // @ts-expect-error Null is not a completion address.
  assert.throws(() => runCpu(cpu, { maxSteps: 0, endAddress: null }), RangeError);
});

test("a zero budget makes no step calls, while an initial endpoint completes", (t) => {
  const { cpu, ram } = create8080Example();
  const before = cpu.snapshot();
  const step = t.mock.method(cpu, "step");
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");

  assert.deepEqual(runCpu(cpu, { maxSteps: 0 }), { records: [], stopReason: "step-limit" });
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress: 1 }), { records: [], stopReason: "step-limit" });
  for (const maxSteps of [0, 5, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(runCpu(cpu, { maxSteps, endAddress: 0 }), { records: [], stopReason: "completed" });
  }
  assert.equal(step.mock.callCount(), 0);
  assert.equal(read.mock.callCount(), 0);
  assert.equal(write.mock.callCount(), 0);
  assert.deepEqual(cpu.snapshot(), before);
});

test("a nonterminating CPU stops at the exact step limit", () => {
  let steps = 0;
  const records = [{ outcome: "executed", marker: 1 }, { outcome: "executed", marker: 2 }] as const;
  const cpu = {
    snapshot: () => ({ pc: 0 }),
    step: () => {
      const record = records[steps++];
      assert.ok(record, "the runner must not take an extra step");
      return record;
    },
  };
  const result = runCpu(cpu, { maxSteps: 2, endAddress: 1 });
  assert.equal(result.stopReason, "step-limit");
  assert.equal(steps, 2);
  assert.equal(result.records.length, 2);
  assert.strictEqual(result.records[0], records[0]);
  assert.strictEqual(result.records[1], records[1]);
});

test("the runner stops before HLT when the caller chooses its address as an endpoint", (t) => {
  const { cpu, ram } = create8080Example();
  const read = t.mock.method(ram, "read");
  const result = runCpu(cpu, { maxSteps: 3, endAddress: 7 });
  assert.equal(result.stopReason, "completed");
  assert.equal(result.records.length, 3);
  assert.equal(cpu.snapshot().halted, false);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [[0], [1], [2], [3], [4], [5], [6]]);
});

test("HLT wins over a coincident endpoint and step limit, with no extra halted step", (t) => {
  const { cpu } = create8080Example();
  const step = t.mock.method(cpu, "step");
  const result = runCpu(cpu, { maxSteps: 4, endAddress: 8 });
  assert.equal(result.stopReason, "halted");
  assert.equal(result.records.length, 4);
  assert.equal(step.mock.callCount(), 4);
  assert.deepEqual(result.records[3]?.instruction, { address: 7, bytes: [0x76] });
});

test("an already halted CPU contributes its own no-fetch record when stepped", (t) => {
  const { cpu, ram } = create8080Example();
  runCpu(cpu, { maxSteps: 4 });
  const before = cpu.snapshot();
  const read = t.mock.method(ram, "read");
  const result = runCpu(cpu, { maxSteps: 5 });
  assert.deepEqual(result, {
    stopReason: "halted",
    records: [{ outcome: "halted", instruction: null, before, after: before, accesses: [] }],
  });
  assert.equal(read.mock.callCount(), 0);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0 }), { records: [], stopReason: "step-limit" });
  assert.deepEqual(runCpu(cpu, { maxSteps: 5, endAddress: 8 }), { records: [], stopReason: "completed" });
});

test("unsupported opcodes stop immediately, preserve their record, and beat the step limit", (t) => {
  // Unsupported encodings differ by CPU: 08 is PHP on the 6502; its undocumented 02 remains excluded.
  for (const [create, opcode] of [
    [create8080Example, 0x08], [create6502Example, 0x02],
    [create6809Example, 0x01], [createZ80Example, 0xd3],
  ] as const) {
    const { cpu, ram } = create();
    const before = cpu.snapshot();
    ram.write(before.pc, opcode);
    const read = t.mock.method(ram, "read");
    const write = t.mock.method(ram, "write");
    const result = runCpu(cpu, { maxSteps: 1 });
    assert.equal(result.stopReason, "unsupported");
    assert.deepEqual(result.records, [{
      outcome: "unsupported", reason: "opcode",
      instruction: { address: before.pc, bytes: [opcode] },
      before, after: before,
      accesses: [{ kind: "read", address: before.pc, value: opcode }],
    }]);
    assert.deepEqual(read.mock.calls.map(call => call.arguments), [[before.pc]]);
    assert.equal(write.mock.callCount(), 0);
    assert.deepEqual(cpu.snapshot(), before);
    // A later run sees the same limitation; the runner does not latch it or skip it.
    assert.deepEqual(runCpu(cpu, { maxSteps: 10 }), result);
  }
});

test("a completed run is distinct from an unsupported attempt at the same PC", () => {
  const { cpu, ram, endAddress } = create6502Example();
  ram.write(endAddress, 0x02); // Use an undefined encoding at the caller endpoint.
  const first = runCpu(cpu, { maxSteps: 4, endAddress });
  assert.equal(first.stopReason, "completed");
  assert.equal(first.records.length, 4);
  assert.deepEqual(runCpu(cpu, { maxSteps: 4, endAddress }), { records: [], stopReason: "completed" });
  const direct = runCpu(cpu, { maxSteps: 4 });
  assert.equal(direct.stopReason, "unsupported");
  assert.deepEqual(direct.records[0]?.instruction, { address: endAddress, bytes: [0x02] });
});

test("the runner executes decimal ADC and records its operand within the step budget", (t) => {
  const { cpu: initial, ram } = create6502Example();
  const state = initial.snapshot();
  const cpu = new Cpu6502(ram, { ...state, a: 9, pc: 0x0203, flags: { ...state.flags, d: true, c: false } });
  const before = cpu.snapshot();
  const read = t.mock.method(ram, "read");
  const result = runCpu(cpu, { maxSteps: 1, endAddress: 0x0208 });
  assert.equal(result.stopReason, "step-limit");
  assert.deepEqual(result.records, [{
    outcome: "executed",
    instruction: { address: 0x0203, bytes: [0x69, 3] },
    before, after: { ...before, a: 0x12, pc: 0x0205,
      flags: { ...before.flags, n: false, v: false, z: false, c: false } },
    accesses: [{ kind: "read", address: 0x0203, value: 0x69 }, { kind: "read", address: 0x0204, value: 3 }],
  }]);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [[0x0203], [0x0204]]);
});

test("an unsupported prefixed 6809 opcode is retained as a partial attempt", (t) => {
  const { cpu, ram } = create6809Example();
  ram.write(0x0200, 0x10);
  ram.write(0x0201, 0x86);
  const read = t.mock.method(ram, "read");
  const result = runCpu(cpu, { maxSteps: 10 });
  assert.equal(result.stopReason, "unsupported");
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0]?.instruction, { address: 0x0200, bytes: [0x10, 0x86] });
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [[0x0200], [0x0201]]);
  assert.equal(cpu.snapshot().pc, 0x0200);
});

test("successive runs resume current state and own separate record arrays", () => {
  const { cpu, ram, endAddress } = create6502Example();
  const first = runCpu(cpu, { maxSteps: 2, endAddress });
  const saved = structuredClone(first);
  assert.equal(first.stopReason, "step-limit");
  assert.equal(cpu.snapshot().pc, 0x0203);
  ram.write(0x0204, 4); // The next ADC must use the current operand.
  const second = runCpu(cpu, { maxSteps: 2, endAddress });
  assert.equal(second.stopReason, "completed");
  assert.equal(cpu.snapshot().a, 6);
  assert.equal(ram.read(0x0080), 6);
  assert.notStrictEqual(first.records, second.records);
  assert.deepEqual(first, saved);
  cpu.reset();
  ram.write(0x0200, 0xff);
  assert.deepEqual(first, saved);
});

test("the runner does not truncate completion addresses to the initial CPUs' widths", () => {
  let pc = 0x10000;
  const cpu = {
    snapshot: () => ({ pc }),
    step: () => { pc++; return { outcome: "executed" } as const; },
  };
  assert.equal(runCpu(cpu, { maxSteps: 1, endAddress: 0x10001 }).stopReason, "completed");
  assert.equal(pc, 0x10001);
});

test("CPU errors propagate without retrying or inventing a stop record", () => {
  const failure = new Error("CPU failure");
  let steps = 0;
  const cpu = {
    snapshot: () => ({ pc: 0 }),
    step: () => { steps++; throw failure; },
  };
  assert.throws(() => runCpu(cpu, { maxSteps: 5 }), error => error === failure);
  assert.equal(steps, 1);
});

test("6800 WAI wins over a coincident endpoint and limit; already waiting steps do not fetch", t => {
  const ram = new Ram(0x10000);
  ram.write(0, 0x3e);
  const cpu = new Cpu6800(ram, { a: 0, b: 0, x: 0, sp: 0x8000, pc: 0, waiting: false,
    flags: { h: false, i: false, n: false, z: false, v: false, c: false } });
  const step = t.mock.method(cpu, "step");
  const result = runCpu(cpu, { maxSteps: 1, endAddress: 1 });
  assert.equal(result.stopReason, "waiting");
  assert.equal(result.records.length, 1);
  assert.strictEqual(result.records[0], step.mock.calls[0]!.result);
  assert.deepEqual(result.records[0]!.instruction, { address: 0, bytes: [0x3e] });
  const waiting = cpu.snapshot();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  assert.deepEqual(runCpu(cpu, { maxSteps: 10 }), { stopReason: "waiting",
    records: [{ before: waiting, after: waiting, instruction: null, accesses: [], outcome: "waiting" }] });
  assert.deepEqual(runCpu(cpu, { maxSteps: 0 }), { stopReason: "step-limit", records: [] });
  for (const maxSteps of [0, 10]) assert.deepEqual(runCpu(cpu, { maxSteps, endAddress: 1 }), { stopReason: "completed", records: [] });
  assert.equal(read.mock.callCount(), 0);
  assert.equal(write.mock.callCount(), 0);
});

test("6800 resumes from WAI through IRQ, nested NMIs, RTI, and SWI with identical snapshot-restored traces and RAM", () => {
  const ram = new Ram(0x10000);
  for (const [address, bytes] of [
    [0x0200, [0x0e, 0x3e, 0x86, 0x09, 0x3f, 0xb7, 0x00, 0x80, 0x3e]], // CLI; WAI; LDAA #9; SWI; STAA $80; WAI
    [0x3000, [0x86, 0x77, 0x3b]], // IRQ: LDAA #$77; RTI
    [0x4000, [0xc6, 0x88, 0x3b]], // NMI: LDAB #$88; RTI
    [0x5000, [0x86, 0xaa, 0x3b]], // SWI: LDAA #$AA; RTI
    [0xfff8, [0x30, 0x00, 0x50, 0x00, 0x40, 0x00]],
  ] as const) for (const [offset, value] of bytes.entries()) ram.write(address + offset, value);
  const initial = { a: 0x11, b: 0x22, x: 0x3456, sp: 0x8000, pc: 0x0200, waiting: false,
    flags: { h: true, i: true, n: false, z: false, v: false, c: true } };
  const cpu = new Cpu6800(ram, initial);
  const first = runCpu(cpu, { maxSteps: 20 });
  const saved = structuredClone(first);
  assert.equal(first.stopReason, "waiting");
  assert.equal(first.records.length, 2);
  assert.deepEqual(cpu.snapshot(), { ...initial, pc: 0x0202, sp: 0x7ff9, waiting: true, flags: { ...initial.flags, i: false } });
  const copiedRam = new Ram(0x10000);
  for (let address = 0; address < ram.size; address++) copiedRam.write(address, ram.read(address));
  const restored = new Cpu6800(copiedRam, cpu.snapshot());
  function finish(cpu: Cpu6800) {
    const wake = cpu.interrupt("irq");
    assert.equal(wake.accesses.length, 2); // WAI's frame is reused.
    const irq = runCpu(cpu, { maxSteps: 1 });
    assert.equal(cpu.snapshot().a, 0x77);
    const nmi = cpu.interrupt("nmi");
    const nested = cpu.interrupt("nmi"); // A new selected NMI is accepted despite I.
    assert.equal(cpu.snapshot().sp, 0x7feb);
    const handlers = runCpu(cpu, { maxSteps: 4 });
    assert.deepEqual(cpu.snapshot(), irq.records[0]!.after);
    const returned = runCpu(cpu, { maxSteps: 1 });
    assert.deepEqual(cpu.snapshot(), { ...initial, pc: 0x0202, flags: { ...initial.flags, i: false } });
    const rest = runCpu(cpu, { maxSteps: 20, endAddress: 0x0209 });
    assert.equal(rest.stopReason, "waiting");
    assert.equal(rest.records.length, 6);
    assert.deepEqual(cpu.snapshot(), { ...initial, pc: 0x0209, sp: 0x7ff9, a: 9, waiting: true, flags: { ...initial.flags, i: false } });
    return [wake, irq, nmi, nested, handlers, returned, rest];
  }
  assert.deepEqual(finish(restored), finish(cpu));
  assert.deepEqual(first, saved);
  assert.equal(ram.read(0x80), 9);
  assert.deepEqual(Array.from({ length: 7 }, (_, index) => ram.read(0x7ffa + index)), [0xe1, 0x22, 9, 0x34, 0x56, 2, 9]);
  for (let address = 0; address < ram.size; address++) assert.equal(copiedRam.read(address), ram.read(address), `RAM ${address}`);
});

test("6809 runner resumes SYNC and CWAI across snapshots, nested interrupts, and software handlers", () => {
  const ram = new Ram(0x10000);
  for (const [address, bytes] of [
    [0x200, [0x10, 0xce, 0x80, 0, 0x13, 0x3c, 0xaf, 0x10, 0x3f, 0x86, 9, 0xb7, 0, 0x80, 0x3c, 0xff]],
    [0x3000, [0x12, 0x3b]], // IRQ: NOP; RTI
    [0x4000, [0x12, 0x3b]], // FIRQ: NOP; RTI (short frame)
    [0x5000, [0x86, 0x77, 0x3b]], // NMI: LDA #$77; RTI
    [0x6000, [0xc6, 0x99, 0x3b]], // SWI2: LDB #$99; RTI
    [0xfff4, [0x60, 0, 0x40, 0, 0x30, 0, 0, 0, 0x50, 0]],
  ] as const) bytes.forEach((byte, offset) => ram.write(address + offset, byte));
  const initial = { a: 0x11, b: 0x22, dp: 0x56, x: 0x2345, y: 0x4567, u: 0xcdef, s: 0, pc: 0x200,
    waitMode: "none" as const, nmiArmed: false,
    flags: { e: false, f: true, h: true, i: true, n: false, z: false, v: false, c: true } };
  const cpu = new Cpu6809(ram, initial);
  const first = runCpu(cpu, { maxSteps: 2, endAddress: 0x205 });
  assert.equal(first.stopReason, "waiting"); // SYNC wins over coincident endpoint and budget.
  const saved = structuredClone(first);
  const waiting = cpu.snapshot();
  assert.equal(waiting.nmiArmed, true);
  assert.deepEqual(runCpu(cpu, { maxSteps: 1 }), { stopReason: "waiting", records: [
    { before: waiting, after: waiting, instruction: null, accesses: [], outcome: "waiting" },
  ] });
  const copiedRam = new Ram(0x10000);
  for (let address = 0; address < ram.size; address++) copiedRam.write(address, ram.read(address));
  const restored = new Cpu6809(copiedRam, waiting);
  function finish(cpu: Cpu6809) {
    const resume = cpu.interrupt("irq");
    assert.equal(resume.outcome, "resumed");
    assert.equal(resume.accesses.length, 0);
    const cwai = runCpu(cpu, { maxSteps: 20 });
    assert.equal(cwai.stopReason, "waiting");
    assert.equal(cpu.snapshot().s, 0x7ff4);
    const wake = cpu.interrupt("irq");
    assert.equal(wake.accesses.length, 2); // CWAI already saved the full frame.
    const irq = runCpu(cpu, { maxSteps: 1 });
    const firq = cpu.interrupt("firq");
    assert.equal(firq.accesses.length, 5);
    assert.equal(cpu.snapshot().s, 0x7ff1);
    const fast = runCpu(cpu, { maxSteps: 1 });
    const nmi = cpu.interrupt("nmi");
    const nested = cpu.interrupt("nmi");
    assert.equal(cpu.snapshot().s, 0x7fd9);
    const handlers = runCpu(cpu, { maxSteps: 4 });
    assert.deepEqual(cpu.snapshot(), { ...fast.records[0]!.after, flags: { ...fast.records[0]!.after.flags, e: true } });
    const fastReturn = runCpu(cpu, { maxSteps: 1 });
    assert.deepEqual(cpu.snapshot(), { ...irq.records[0]!.after, flags: { ...irq.records[0]!.after.flags, e: false } });
    const returned = runCpu(cpu, { maxSteps: 1 });
    assert.deepEqual(cpu.snapshot(), { ...initial, d: 0x1122, s: 0x8000, pc: 0x207, nmiArmed: true,
      flags: { ...initial.flags, e: true, f: false, i: false, n: true } });
    const rest = runCpu(cpu, { maxSteps: 20, endAddress: 0x210 });
    assert.equal(rest.stopReason, "waiting");
    assert.equal(rest.records.length, 6);
    assert.equal(cpu.snapshot().a, 9);
    assert.equal(cpu.snapshot().b, 0x22); // SWI2's changed B was restored from its full frame.
    assert.equal(cpu.snapshot().s, 0x7ff4);
    return [resume, cwai, wake, irq, firq, fast, nmi, nested, handlers, fastReturn, returned, rest];
  }
  assert.deepEqual(finish(restored), finish(cpu));
  assert.deepEqual(first, saved);
  assert.equal(ram.read(0x80), 9);
  for (let address = 0; address < ram.size; address++) assert.equal(copiedRam.read(address), ram.read(address), `RAM ${address}`);
});
