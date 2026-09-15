import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../src/components/cpus/z80.js";
import { Cpu6809 } from "../../src/components/cpus/6809.js";
import { Cpu6800 } from "../../src/components/cpus/6800.js";
import { Ram } from "../../src/components/memory/ram.js";
import { Cpu6502 } from "../../src/components/cpus/6502.js";
import { Cpu8088 } from "../../src/components/cpus/8088.js";
import type { Cpu8088State, Cpu8088Access } from "../../src/components/cpus/8088.js";
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
  for (const [create, bytes] of [
    [create8080Example, [0x08]], [create6502Example, [0x02]],
    [create6809Example, [0x01]], [createZ80Example, [0xed, 0x00]],
  ] as const) {
    const { cpu, ram } = create();
    const before = cpu.snapshot();
    bytes.forEach((byte, i) => ram.write(before.pc + i, byte));
    const read = t.mock.method(ram, "read");
    const write = t.mock.method(ram, "write");
    const result = runCpu(cpu, { maxSteps: 1 });
    assert.equal(result.stopReason, "unsupported");
    assert.deepEqual(result.records, [{
      outcome: "unsupported", reason: "opcode",
      instruction: { address: before.pc, bytes },
      before, after: before,
      accesses: bytes.map((value, i) => ({ kind: "read", address: before.pc + i, value })),
    }]);
    assert.deepEqual(read.mock.calls.map(call => call.arguments), bytes.map((_, i) => [before.pc + i]));
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

test("Z80 block I/O budgets one iteration per step and resumes with independently restored CPU, RAM, and device state", () => {
  const program = [
    0x01, 0x34, 0x03, // LD BC,0334
    0x21, 0x00, 0x40, // LD HL,4000
    0xed, 0xb2,       // INIR: read three bytes into ascending memory
    0x06, 0x03,       // LD B,03
    0x2b,             // DEC HL: point at the final input byte
    0xed, 0xbb,       // OTDR: write the buffer in reverse order
    0x76,            // HALT
  ];
  const input = [0x00, 0x7f, 0x80];
  const initial = { ...createZ80Example().cpu.snapshot(), r: 0xfe };
  function machine(state = initial, image?: readonly number[], consumed = 0, written: readonly number[] = []) {
    const ram = new Ram(65536);
    (image ?? program).forEach((value, address) => ram.write(address, value));
    const device = { consumed, written: [...written] };
    const cpu = new CpuZ80(ram, state, {
      readPort: port => {
        assert.equal(port, (3 - device.consumed) * 256 + 0x34);
        const value = input[device.consumed++];
        assert.notEqual(value, undefined, "no extra device reads");
        return value!;
      },
      writePort: (port, value) => {
        assert.equal(port, (2 - device.written.length) * 256 + 0x34);
        device.written.push(value);
      },
    });
    return { ram, cpu, device };
  }
  const full = machine();
  const expected = runCpu(full.cpu, { maxSteps: 11 });
  assert.equal(expected.stopReason, "halted");
  assert.deepEqual(expected.records.map(record => record.after.pc), [3, 6, 6, 6, 8, 10, 11, 11, 11, 13, 14]);
  assert.deepEqual(expected.records.map(record => record.after.b), [3, 3, 2, 1, 0, 3, 3, 2, 1, 0, 0]);
  assert.deepEqual(expected.records.map(record => record.after.r), [0xff, 0x80, 0x82, 0x84, 0x86, 0x87, 0x88, 0x8a, 0x8c, 0x8e, 0x8f]);
  assert.deepEqual(expected.records.flatMap(record => record.accesses.filter(access => access.kind === "input" || access.kind === "output")), [
    { kind: "input", port: 0x0334, value: 0 }, { kind: "input", port: 0x0234, value: 0x7f },
    { kind: "input", port: 0x0134, value: 0x80 }, { kind: "output", port: 0x0234, value: 0x80 },
    { kind: "output", port: 0x0134, value: 0x7f }, { kind: "output", port: 0x0034, value: 0 },
  ]);
  assert.deepEqual(full.device, { consumed: 3, written: [0x80, 0x7f, 0] });
  assert.equal(full.cpu.snapshot().hl, 0x3fff);
  const expectedMemory = Array<number>(65536).fill(0);
  program.forEach((value, i) => { expectedMemory[i] = value; });
  input.forEach((value, i) => { expectedMemory[0x4000 + i] = value; });
  assert.deepEqual(expectedMemory.map((_, i) => full.ram.read(i)), expectedMemory);

  for (let boundary = 0; boundary <= 11; boundary++) {
    const paused = machine();
    const prefix = runCpu(paused.cpu, { maxSteps: boundary });
    assert.deepEqual(prefix.records, expected.records.slice(0, boundary));
    assert.equal(prefix.stopReason, boundary === 11 ? "halted" : "step-limit");
    const image = expectedMemory.map((_, i) => paused.ram.read(i));
    const resumed = machine(paused.cpu.snapshot(), image, paused.device.consumed, paused.device.written);
    const suffix = runCpu(resumed.cpu, { maxSteps: 11 - boundary });
    assert.deepEqual(suffix.records, expected.records.slice(boundary));
    assert.deepEqual(resumed.cpu.snapshot(), full.cpu.snapshot());
    assert.deepEqual(resumed.device, full.device);
    assert.deepEqual(expectedMemory.map((_, i) => resumed.ram.read(i)), expectedMemory);
    assert.deepEqual(resumed.cpu.step().accesses, []);
    assert.deepEqual(resumed.device, full.device);
  }
});

for (const im of [0, 1, 2] as const) {
  test(`Z80 IM ${im} interrupt program resumes across HALT, nested NMI, and every instruction/entry boundary`, () => {
    const handler = im === 1 ? 0x38 : 0x4000;
    const initial = { ...createZ80Example().cpu.snapshot(), pc: 0x2000, sp: 0, i: 0x42, r: 0xfe, im, a: 0x11 };
    const interruptBytes = im === 0 ? [0xcd, handler % 256, Math.floor(handler / 256)] : [0x20];
    function machine(state = initial, image?: readonly number[], saved = { acknowledged: 0, returns: 0, outputs: [] as { port: number; value: number }[] }) {
      const ram = new Ram(65536);
      if (image) image.forEach((value, address) => ram.write(address, value));
      else {
        [0xfb, 0x76, 0x3e, 0x2a, 0x76].forEach((value, i) => ram.write(0x2000 + i, value)); // EI; HALT; LD A,2A; HALT
        [0xf5, 0x3e, 0x99, 0xd3, 0x10, 0xf1, 0xfb, 0xed, 0x4d].forEach((value, i) => ram.write(handler + i, value)); // Save AF; output 99; restore AF; EI; RETI
        [0xf5, 0x3e, 0x55, 0xd3, 0x10, 0xf1, 0xed, 0x45].forEach((value, i) => ram.write(0x66 + i, value)); // Save AF; output 55; restore AF; RETN
        ram.write(0x4220, handler % 256); ram.write(0x4221, Math.floor(handler / 256));
      }
      const device = structuredClone(saved);
      const cpu = new CpuZ80(ram, state, {
        readPort: () => assert.fail("output-only program"),
        writePort: (port, value) => { device.outputs.push({ port, value }); },
      }, () => { device.returns++; });
      const acknowledge = (): number => {
        const value = interruptBytes[device.acknowledged++];
        assert.notEqual(value, undefined, "only expected instruction/vector bytes are requested");
        return value!;
      };
      return { ram, cpu, device, acknowledge };
    }
    function advance(current: ReturnType<typeof machine>, boundary: number) {
      if (boundary === 2) return current.cpu.interrupt("irq", current.acknowledge);
      if (boundary === 4) return current.cpu.interrupt("nmi");
      const run = runCpu(current.cpu, { maxSteps: 1 });
      assert.equal(run.records.length, 1);
      assert.equal(run.stopReason, boundary === 1 || boundary === 16 ? "halted" : "step-limit");
      return run.records[0]!;
    }
    const full = machine();
    const records = Array.from({ length: 17 }, (_, boundary) => advance(full, boundary));
    assert.deepEqual(records.map(record => record.after.pc), [0x2001, 0x2002, handler, handler + 1, 0x66,
      0x67, 0x69, 0x6b, 0x6c, handler + 1, handler + 3, handler + 5, handler + 6, handler + 7, 0x2002, 0x2004, 0x2005]);
    assert.deepEqual(full.device, { acknowledged: interruptBytes.length, returns: 1,
      outputs: [{ port: 0x5510, value: 0x55 }, { port: 0x9910, value: 0x99 }] });
    assert.deepEqual(full.cpu.snapshot(), { ...initial, a: 0x2a, pc: 0x2005, r: 0x91, halted: true, iff1: true, iff2: true });
    const image = Array.from({ length: 65536 }, (_, address) => full.ram.read(address));
    for (let boundary = 0; boundary <= records.length; boundary++) {
      const prefix = machine();
      for (let i = 0; i < boundary; i++) assert.deepEqual(advance(prefix, i), records[i]);
      const savedRam = image.map((_, address) => prefix.ram.read(address));
      const resumed = machine(prefix.cpu.snapshot(), savedRam, prefix.device);
      for (let i = boundary; i < records.length; i++) assert.deepEqual(advance(resumed, i), records[i]);
      assert.deepEqual(resumed.cpu.snapshot(), full.cpu.snapshot());
      assert.deepEqual(resumed.device, full.device);
      assert.deepEqual(image.map((_, address) => resumed.ram.read(address)), image);
    }
    const retained = structuredClone(records);
    full.cpu.step(); full.cpu.reset();
    assert.deepEqual(records, retained);
    assert.equal(full.device.returns, 1);
    assert.equal(full.device.outputs.length, 2);
  });
}

test("8088 port program uses all eight forms and restores CPU, RAM, and device state at every boundary", () => {
  const initial: Cpu8088State = { ax: 0x1122, bx: 0x3344, cx: 0x5566, dx: 0x7788, sp: 0x8000, bp: 0x9000,
    si: 0x10, di: 0x20, cs: 0x1234, ds: 0x2000, es: 0x4000, ss: 0x3000, ip: 0x100, halted: false,
    flags: { cf: true, pf: false, af: true, zf: false, sf: true, tf: false, if: true, df: true, of: false } };
  const instructions = [
    [0xba, 0xff, 0xff], // MOV DX,FFFF
    [0xe4, 0x11], [0xe6, 0xff], // IN AL,11; OUT FF,AL
    [0xe5, 0xff], [0xe7, 0x12], // IN AX,FF; OUT 12,AX
    [0xec], [0xee], [0xed], [0xef], // IN AL,DX; OUT DX,AL; IN AX,DX; OUT DX,AX
    [0xa3, 0x00, 0x80], [0xf4], // MOV [8000],AX; HLT
  ];
  const inputs = [{ port: 0x11, value: 0x34 }, { port: 0xff, value: 0x78 }, { port: 0x100, value: 0x56 },
    { port: 0xffff, value: 0xbc }, { port: 0xffff, value: 0xf0 }, { port: 0, value: 0xde }];
  const expectedOutputs = [{ port: 0xff, value: 0x34 }, { port: 0x12, value: 0x78 }, { port: 0x13, value: 0x56 },
    { port: 0xffff, value: 0xbc }, { port: 0xffff, value: 0xf0 }, { port: 0, value: 0xde }];
  const axAfter = [0x1122, 0x1134, 0x1134, 0x5678, 0x5678, 0x56bc, 0x56bc, 0xdef0, 0xdef0, 0xdef0, 0xdef0];
  const portAccesses: Cpu8088Access[][] = [[], [inputs[0]!].map(x => ({ kind: "input", ...x })),
    [expectedOutputs[0]!].map(x => ({ kind: "output", ...x })), inputs.slice(1, 3).map(x => ({ kind: "input", ...x })),
    expectedOutputs.slice(1, 3).map(x => ({ kind: "output", ...x })), [inputs[3]!].map(x => ({ kind: "input", ...x })),
    [expectedOutputs[3]!].map(x => ({ kind: "output", ...x })), inputs.slice(4).map(x => ({ kind: "input", ...x })),
    expectedOutputs.slice(4).map(x => ({ kind: "output", ...x })),
    [{ kind: "write", address: 0x28000, value: 0xf0 }, { kind: "write", address: 0x28001, value: 0xde }], []];
  function machine(state = initial, image?: readonly number[], saved = { cursor: 0, outputs: [] as { port: number; value: number }[] }) {
    const ram = new Ram(0x100000);
    if (image) image.forEach((value, address) => ram.write(address, value));
    else instructions.flat().forEach((value, i) => ram.write(0x12440 + i, value));
    const device = structuredClone(saved);
    const cpu = new Cpu8088(ram, state, {
      readPort: port => { const input = inputs[device.cursor++]!; assert.equal(port, input.port); return input.value; },
      writePort: (port, value) => { device.outputs.push({ port, value }); },
    });
    return { cpu, ram, device };
  }
  const full = machine();
  const result = runCpu(full.cpu, { maxSteps: 11 });
  assert.equal(result.stopReason, "halted");
  assert.equal(result.records.length, 11);
  let ip = initial.ip;
  result.records.forEach((record, i) => {
    const bytes = instructions[i]!;
    assert.deepEqual(record.instruction, { address: initial.cs * 16 + ip, bytes });
    assert.deepEqual(record.accesses, [...bytes.map((value, offset) => ({ kind: "read", address: initial.cs * 16 + ip + offset, value })), ...portAccesses[i]!]);
    ip += bytes.length;
    assert.equal(record.after.ax, axAfter[i]); assert.equal(record.after.ip, ip);
    assert.equal(record.after.dx, 0xffff); assert.deepEqual(record.after.flags, initial.flags);
  });
  assert.deepEqual(full.device, { cursor: inputs.length, outputs: expectedOutputs });
  assert.equal(full.ram.read(0x28000), 0xf0); assert.equal(full.ram.read(0x28001), 0xde);
  const image = Array.from({ length: 0x100000 }, (_, address) => full.ram.read(address));
  for (let boundary = 0; boundary <= 11; boundary++) {
    const prefix = machine();
    const first = runCpu(prefix.cpu, { maxSteps: boundary });
    const savedRam = image.map((_, address) => prefix.ram.read(address));
    const resumed = machine(prefix.cpu.snapshot(), savedRam, prefix.device);
    const rest = runCpu(resumed.cpu, { maxSteps: 11 - boundary });
    assert.deepEqual([...first.records, ...rest.records], result.records);
    assert.deepEqual(resumed.cpu.snapshot(), full.cpu.snapshot());
    assert.deepEqual(resumed.device, full.device);
    assert.deepEqual(image.map((_, address) => resumed.ram.read(address)), image);
  }
  const retained = structuredClone(result);
  full.cpu.step(); full.cpu.reset();
  assert.deepEqual(result, retained);
  assert.deepEqual(full.device, { cursor: inputs.length, outputs: expectedOutputs });
});
