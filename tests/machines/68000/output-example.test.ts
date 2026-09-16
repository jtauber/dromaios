import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000Access } from "../../../src/components/cpus/68000.js";
import { ByteOutput } from "../../../src/components/devices/byte-output.js";
import { MemoryMap } from "../../../src/components/memory/memory-map.js";
import { create68000OutputExample } from "../../../src/machines/generated/68000/output-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

const message = [0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x0a];
const vectors = [0, 1, 0x10, 0, 0, 0, 1, 0, 0, 0, 2, 0];
const program = [0x4e, 0x70, 0x41, 0xf9, 0, 0, 1, 0x80, 0x43, 0xf9, 0, 2, 0, 0,
  0x70, 5, 0x12, 0x98, 0x51, 0xc8, 0xff, 0xfc, 0x4e, 0x72, 0x27, 0];
const reads = (address: number, bytes: readonly number[]): Cpu68000Access[] =>
  bytes.map((value, offset) => ({ kind: "read", address: address + offset, value }));

function initialState(): Cpu68000Snapshot {
  return { d0: 0, d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0,
    a0: 0, a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, a6: 0, usp: 0, ssp: 0, pc: 0,
    ir: 0, interruptMask: 0, halted: false, faulted: false, tracePending: false,
    entry: { kind: "none", vector: 0 }, a7: 0, physicalPc: 0,
    flags: { x: false, n: false, z: false, v: false, c: false, t: false, s: false } };
}
function resetState(): Cpu68000Snapshot {
  const before = initialState();
  return { ...before, pc: 0x100, physicalPc: 0x100, ssp: 0x11000, a7: 0x11000,
    interruptMask: 7, flags: { ...before.flags, s: true }, entry: { kind: "reset", vector: 0 } };
}
function expectedRecords(): Cpu68000StepRecord[] {
  let before = resetState();
  const records: Cpu68000StepRecord[] = [];
  function step(bytes: number[], pc: number, changes: Partial<Cpu68000Snapshot> = {}, data: Cpu68000Access[] = []): void {
    const after: Cpu68000Snapshot = { ...before, pc, physicalPc: pc, ir: bytes[0]! * 256 + bytes[1]!,
      entry: { kind: "none", vector: 0 }, ...changes };
    records.push({ before, after, instruction: { address: before.pc, bytes },
      accesses: [...reads(before.pc, bytes), ...data], outcome: after.halted ? "halted" : "executed" });
    before = after;
  }
  step([0x4e, 0x70], 0x102, {}, [{ kind: "reset" }]);
  step([0x41, 0xf9, 0, 0, 1, 0x80], 0x108, { a0: 0x180 });
  step([0x43, 0xf9, 0, 2, 0, 0], 0x10e, { a1: 0x20000 });
  step([0x70, 5], 0x110, { d0: 5 });
  for (const [index, value] of message.entries()) {
    step([0x12, 0x98], 0x112, { a0: 0x181 + index }, [
      { kind: "read", address: 0x180 + index, value }, { kind: "write", address: 0x20000, value },
    ]);
    step([0x51, 0xc8, 0xff, 0xfc], index === 5 ? 0x116 : 0x110, { d0: index === 5 ? 0xffff : 4 - index });
  }
  step([0x4e, 0x72, 0x27, 0], 0x11a, { halted: true });
  return records;
}
function checkImages(machine: ReturnType<typeof create68000OutputExample>): void {
  const expected = new Uint8Array(0x400);
  expected.set(vectors); expected.set(program, 0x100); expected.set(message, 0x180); expected.set([0x4e, 0x72, 0x27, 0], 0x200);
  assert.equal(machine.rom.size, 0x400);
  assert.equal(machine.ram.size, 0x1000);
  for (const [address, value] of expected.entries()) assert.equal(machine.rom.read(address), value, `ROM ${address}`);
  for (let address = 0; address < machine.ram.size; address++) assert.equal(machine.ram.read(address), 0, `RAM ${address}`);
}

test("68000 output factories allocate independent components without booting or notifying the host", () => {
  const events: number[] = [];
  const machine = create68000OutputExample({ output: value => { events.push(value); } });
  const fresh = create68000OutputExample({ output: () => assert.fail("Unexpected output from independent machine") });
  assert.deepEqual(machine.cpu.snapshot(), initialState());
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.equal(machine.memory.size, 0x1000000);
  assert.equal(machine.memory.read(0x20000), "bus-error");
  assert.equal(machine.memory.read(0x20001), "bus-error");
  assert.deepEqual(events, []);
  checkImages(machine);
  machine.output.write(0, 0x41);
  machine.ram.write(0, 0xff);
  assert.deepEqual(fresh.output.snapshot(), { lastByte: null });
  checkImages(fresh);
  assert.deepEqual(events, [0x41]);
});

test("68000 ROM output records exactly six writes, including repeated L, with no read or inspection side effects", t => {
  const events: number[] = [];
  const machine = create68000OutputExample({ output: value => {
    events.push(value);
    assert.deepEqual(machine.output.snapshot(), { lastByte: value });
    const state = machine.cpu.snapshot();
    assert.throws(() => machine.cpu.step(), /must not be reentrant/);
    assert.throws(() => machine.cpu.reset(), /must not be reentrant/);
    assert.throws(() => machine.cpu.interrupt(7, () => "autovector"), /must not be reentrant/);
    assert.deepEqual(machine.cpu.snapshot(), state);
  } });
  const { cpu, memory, output } = machine;
  const transfers: Cpu68000Access[] = [];
  const read = memory.read.bind(memory), write = memory.write.bind(memory), resetDevice = output.reset.bind(output);
  t.mock.method(memory, "read", (address: number) => {
    const value = read(address);
    if (value === "bus-error") assert.fail("Unexpected bus error during normal output");
    transfers.push({ kind: "read", address, value });
    return value;
  });
  t.mock.method(memory, "write", (address: number, value: number) => {
    assert.equal(write(address, value), undefined);
    transfers.push({ kind: "write", address, value });
  });
  const deviceResets = t.mock.method(output, "reset", () => { resetDevice(); transfers.push({ kind: "reset" }); });
  const deviceReads = t.mock.method(output, "read");
  const deviceWrites = t.mock.method(output, "write");
  const reset = cpu.reset();
  assert.deepEqual(reset, { before: initialState(), after: resetState(), accesses: reads(0, vectors.slice(0, 8)) });
  assert.equal(deviceResets.mock.callCount(), 0);
  const run = runCpu(cpu, { maxSteps: 17 });
  const expected = expectedRecords();
  assert.deepEqual(run, { records: expected, stopReason: "halted" });
  assert.deepEqual(transfers, [...reset.accesses, ...expected.flatMap(record => record.accesses)]);
  assert.deepEqual(events, message);
  assert.equal(deviceResets.mock.callCount(), 1);
  assert.equal(deviceReads.mock.callCount(), 0);
  assert.deepEqual(deviceWrites.mock.calls.map(call => call.arguments), message.map(value => [0, value]));
  assert.deepEqual(output.snapshot(), { lastByte: 10 });
  assert.deepEqual(cpu.snapshot(), expected[16]!.after);
  checkImages(machine);
  const before = cpu.snapshot();
  assert.deepEqual(cpu.step(), { before, after: before, accesses: [], instruction: null, outcome: "halted" });
  assert.deepEqual(events, message);
});

test("68000 output pauses at every boundary and restores CPU and device snapshots without replay", () => {
  const events: number[] = [];
  const onWrite = (value: number): void => { events.push(value); };
  const machine = create68000OutputExample({ output: onWrite });
  machine.cpu.reset();
  let cpu = machine.cpu, output = machine.output;
  const expected = expectedRecords();
  for (const [index, record] of expected.entries()) {
    assert.deepEqual(runCpu(cpu, { maxSteps: 0 }), { records: [], stopReason: "step-limit" });
    assert.deepEqual(runCpu(cpu, { maxSteps: 1 }), { records: [record], stopReason: index === 16 ? "halted" : "step-limit" });
    const count = Math.max(0, Math.min(6, Math.floor((index - 2) / 2)));
    assert.deepEqual(events, message.slice(0, count));
    assert.deepEqual(output.snapshot(), { lastByte: count ? message[count - 1] : null });
    const saved = output.snapshot();
    const restoredOutput = new ByteOutput(onWrite, saved);
    const memory = new MemoryMap(0x1000000, [
      { start: 0, memory: machine.rom }, { start: 0x10000, memory: machine.ram }, { start: 0x20000, memory: restoredOutput },
    ]);
    cpu = new Cpu68000(memory, cpu.snapshot(), { resetDevices: () => restoredOutput.reset() });
    output = restoredOutput;
    assert.deepEqual(events, message.slice(0, count));
    assert.deepEqual(output.snapshot(), saved);
  }
  assert.deepEqual(events, message);
  checkImages(machine);
});

test("68000 CPU reset preserves device state; RESET clears its latch without changing CPU data, RAM, or the host transcript", () => {
  const events: number[] = [];
  const machine = create68000OutputExample({ output: value => { events.push(value); } });
  machine.output.write(0, 0x7f);
  machine.ram.write(0, 0x5a);
  machine.cpu.reset();
  assert.deepEqual(machine.output.snapshot(), { lastByte: 0x7f });
  assert.deepEqual(events, [0x7f]);
  const before = machine.cpu.snapshot();
  const record = machine.cpu.step();
  assert.deepEqual(record.after, { ...before, pc: 0x102, physicalPc: 0x102, ir: 0x4e70, entry: { kind: "none", vector: 0 } });
  assert.deepEqual(record.accesses, [...reads(0x100, [0x4e, 0x70]), { kind: "reset" }]);
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.equal(machine.ram.read(0), 0x5a);
  assert.deepEqual(events, [0x7f]);
  assert.equal(runCpu(machine.cpu, { maxSteps: 16 }).stopReason, "halted");
  const saved = structuredClone(record);
  machine.cpu.reset();
  assert.deepEqual(machine.output.snapshot(), { lastByte: 10 });
  assert.equal(machine.cpu.snapshot().d0, 0xffff);
  assert.equal(runCpu(machine.cpu, { maxSteps: 17 }).stopReason, "halted");
  assert.deepEqual(events, [0x7f, ...message, ...message]);
  assert.equal(machine.ram.read(0), 0x5a);
  assert.deepEqual(record, saved);
});

test("68000 write-only output faults on reads and preserves a completed high-byte output when a word crosses the region", () => {
  for (const store of [false, true]) {
    const events: number[] = [];
    const machine = create68000OutputExample({ output: value => { events.push(value); } });
    machine.cpu.reset();
    const bytes = store ? [0x33, 0xfc, 0x12, 0x34, 0, 2, 0, 0] // MOVE.W #1234,(020000).L
      : [0x10, 0x39, 0, 2, 0, 0]; // MOVE.B (020000).L,D0
    bytes.forEach((value, offset) => machine.ram.write(0x10 + offset, value));
    const cpu = new Cpu68000(machine.memory, { ...machine.cpu.snapshot(), pc: 0x10010, entry: { kind: "none", vector: 0 } });
    const record = cpu.step();
    assert.deepEqual(record.exception, { source: "bus-error", vector: 2, returnPc: 0x10010 + bytes.length,
      fault: { operation: store ? "write" : "read", address: store ? 0x20001 : 0x20000,
        instructionRegister: store ? 0x33fc : 0x1039, functionCode: 5, processingInstruction: true } });
    assert.equal(record.after.pc, 0x200);
    assert.deepEqual(events, store ? [0x12] : []);
    assert.deepEqual(machine.output.snapshot(), { lastByte: store ? 0x12 : null });
    assert.deepEqual(record.accesses.filter(access => access.kind !== "reset" && access.address >= 0x20000),
      store ? [{ kind: "write", address: 0x20000, value: 0x12 }] : []);
    assert.equal(cpu.step().outcome, "halted");
  }
});

test("68000 host output failure propagates once with committed device and source updates, without bus-error conversion", () => {
  const failure = new Error("output sink failed");
  const events: number[] = [];
  let fail = true;
  const machine = create68000OutputExample({ output: value => { events.push(value); if (fail) throw failure; } });
  machine.cpu.reset();
  runCpu(machine.cpu, { maxSteps: 4 });
  const before = machine.cpu.snapshot();
  assert.throws(() => machine.cpu.step(), error => error === failure);
  assert.deepEqual(events, [0x48]);
  assert.deepEqual(machine.output.snapshot(), { lastByte: 0x48 });
  assert.deepEqual(machine.cpu.snapshot(), { ...before, ir: 0x1298, a0: 0x181 });
  checkImages(machine);
  fail = false;
  machine.cpu.reset(); // Explicit restart; neither the CPU nor the device retries the failed host call.
  assert.equal(runCpu(machine.cpu, { maxSteps: 17 }).stopReason, "halted");
  assert.deepEqual(events, [0x48, ...message]);
});
