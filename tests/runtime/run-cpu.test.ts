import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../src/components/cpus/6502.js";
import { runCpu } from "../../src/runtime/run-cpu.js";
import { create8080Example } from "../../src/machines/generated/8080/example.js";
import { create6502Example } from "../../src/machines/generated/6502/example.js";
import { create6809Example } from "../../src/machines/generated/6809/example.js";

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
  for (const create of [create8080Example, create6502Example, create6809Example]) {
    const { cpu, ram } = create();
    const before = cpu.snapshot();
    ram.write(before.pc, 0x08);
    const read = t.mock.method(ram, "read");
    const write = t.mock.method(ram, "write");
    const result = runCpu(cpu, { maxSteps: 1 });
    assert.equal(result.stopReason, "unsupported");
    assert.deepEqual(result.records, [{
      outcome: "unsupported", reason: "opcode",
      instruction: { address: before.pc, bytes: [0x08] },
      before, after: before,
      accesses: [{ kind: "read", address: before.pc, value: 0x08 }],
    }]);
    assert.deepEqual(read.mock.calls.map(call => call.arguments), [[before.pc]]);
    assert.equal(write.mock.callCount(), 0);
    assert.deepEqual(cpu.snapshot(), before);
    // A later run sees the same limitation; the runner does not latch it or skip it.
    assert.deepEqual(runCpu(cpu, { maxSteps: 10 }), result);
  }
});

test("a completed run is distinct from an unsupported attempt at the same PC", () => {
  const { cpu, endAddress } = create6502Example();
  const first = runCpu(cpu, { maxSteps: 4, endAddress });
  assert.equal(first.stopReason, "completed");
  assert.equal(first.records.length, 4);
  assert.deepEqual(runCpu(cpu, { maxSteps: 4, endAddress }), { records: [], stopReason: "completed" });
  const direct = runCpu(cpu, { maxSteps: 4 });
  assert.equal(direct.stopReason, "unsupported");
  assert.deepEqual(direct.records[0]?.instruction, { address: endAddress, bytes: [0] });
});

test("decimal-mode rejection retains its CPU-specific reason without reading an operand", (t) => {
  const { cpu: initial, ram } = create6502Example();
  const state = initial.snapshot();
  const cpu = new Cpu6502(ram, { ...state, pc: 0x0203, flags: { ...state.flags, d: true } });
  const before = cpu.snapshot();
  const read = t.mock.method(ram, "read");
  const result = runCpu(cpu, { maxSteps: 10, endAddress: 0x0208 });
  assert.equal(result.stopReason, "unsupported");
  assert.deepEqual(result.records, [{
    outcome: "unsupported", reason: "decimal-mode",
    instruction: { address: 0x0203, bytes: [0x69] },
    before, after: before,
    accesses: [{ kind: "read", address: 0x0203, value: 0x69 }],
  }]);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [[0x0203]]);
});

test("an unsupported 6809 prefix is retained as a partial attempt", (t) => {
  const { cpu, ram } = create6809Example();
  ram.write(0x0200, 0x10);
  ram.write(0x0201, 0x86);
  const read = t.mock.method(ram, "read");
  const result = runCpu(cpu, { maxSteps: 10 });
  assert.equal(result.stopReason, "unsupported");
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0]?.instruction, { address: 0x0200, bytes: [0x10] });
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [[0x0200]]);
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
