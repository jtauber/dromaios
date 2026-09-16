import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Access, Cpu68000Snapshot, Cpu68000StepRecord } from "../../../src/components/cpus/68000.js";
import { ByteInput } from "../../../src/components/devices/byte-input.js";
import { ByteOutput } from "../../../src/components/devices/byte-output.js";
import { MemoryMap } from "../../../src/components/memory/memory-map.js";
import { create68000EchoExample } from "../../../src/machines/68000/echo-example.js";
import { create8080EchoExample } from "../../../src/machines/8080/echo-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

const vectors = [0, 1, 0x10, 0, 0, 0, 1, 0, 0, 0, 2, 0];
const program = [0x41, 0xf9, 0, 3, 0, 0, 0x43, 0xf9, 0, 2, 0, 0,
  0x4a, 0x10, 0x67, 0xfc, 0x10, 0x28, 0, 1, 0x12, 0x80, 0x0c, 0, 0, 10, 0x66, 0xf0, 0x4e, 0x72, 0x27, 0];
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

function expected(before: Cpu68000Snapshot) {
  const records: Cpu68000StepRecord[] = [];
  return {
    records,
    step(bytes: number[], pc: number, changes: Partial<Cpu68000Snapshot> = {}, data: Cpu68000Access[] = []): void {
      const after: Cpu68000Snapshot = { ...before, pc, physicalPc: pc, ir: bytes[0]! * 256 + bytes[1]!,
        entry: { kind: "none", vector: 0 }, ...changes };
      records.push({ before, after, instruction: { address: before.pc, bytes },
        accesses: [...reads(before.pc, bytes), ...data], outcome: after.halted ? "halted" : "executed" });
      before = after;
    },
  };
}

function setupRecords(): Cpu68000StepRecord[] {
  const e = expected(resetState());
  e.step([0x41, 0xf9, 0, 3, 0, 0], 0x106, { a0: 0x30000 });
  e.step([0x43, 0xf9, 0, 2, 0, 0], 0x10c, { a1: 0x20000 });
  return e.records;
}

function iteration(before: Cpu68000Snapshot, value: number | null): Cpu68000StepRecord[] {
  const e = expected(before);
  const ready = value === null ? 0 : 1;
  e.step([0x4a, 0x10], 0x10e, { flags: { ...before.flags, n: false, z: !ready, v: false, c: false } },
    [{ kind: "read", address: 0x30000, value: ready }]);
  e.step([0x67, 0xfc], ready ? 0x110 : 0x10c);
  if (value === null) return e.records;
  const moveFlags = { ...before.flags, n: value >= 128, z: value === 0, v: false, c: false };
  e.step([0x10, 0x28, 0, 1], 0x114, { d0: value, flags: moveFlags }, [{ kind: "read", address: 0x30001, value }]);
  e.step([0x12, 0x80], 0x116, {}, [{ kind: "write", address: 0x20000, value }]);
  const difference = (value - 10 + 256) % 256;
  e.step([0x0c, 0, 0, 10], 0x11a, { flags: { ...before.flags, n: difference >= 128, z: difference === 0,
    v: value >= 128 && difference < 128, c: value < 10 } });
  e.step([0x66, 0xf0], value === 10 ? 0x11c : 0x10c);
  if (value === 10) e.step([0x4e, 0x72, 0x27, 0], 0x120,
    { halted: true, flags: { x: false, n: false, z: false, v: false, c: false, t: false, s: true } });
  return e.records;
}

function checkImages(machine: ReturnType<typeof create68000EchoExample>): void {
  const image = new Uint8Array(0x400);
  image.set(vectors); image.set(program, 0x100); image.set([0x4e, 0x72, 0x27, 0], 0x200);
  assert.equal(machine.rom.size, image.length);
  assert.equal(machine.ram.size, 0x1000);
  for (const [address, value] of image.entries()) assert.equal(machine.rom.read(address), value, `ROM ${address}`);
  for (let address = 0; address < machine.ram.size; address++) assert.equal(machine.ram.read(address), 0, `RAM ${address}`);
}

test("68000 echo creates independent components without booting, consuming input, or emitting output", () => {
  const events: number[] = [];
  const machine = create68000EchoExample(value => { events.push(value); });
  assert.deepEqual(machine.cpu.snapshot(), initialState());
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.equal(machine.memory.size, 0x1000000);
  checkImages(machine);
  assert.deepEqual(events, []);
  machine.input.offer(0x41); machine.output.write(0, 0x42); machine.ram.write(0, 0x5a);
  const fresh = create68000EchoExample(() => assert.fail("Unexpected independent output"));
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  assert.deepEqual(fresh.input.snapshot(), { pendingByte: null });
  assert.deepEqual(fresh.output.snapshot(), { lastByte: null });
  checkImages(fresh);
});

test("68000 echo records exact polling, consuming reads, and output for zero, signed, and repeated bytes", t => {
  const events: number[] = [];
  const machine = create68000EchoExample(value => {
    events.push(value);
    assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
    assert.deepEqual(machine.output.snapshot(), { lastByte: value });
    assert.throws(() => machine.reset(), /must not be reentrant/);
    assert.deepEqual(machine.output.snapshot(), { lastByte: value });
  });
  const { cpu, memory, input } = machine;
  const observed: Cpu68000Access[] = [];
  const read = memory.read.bind(memory), write = memory.write.bind(memory);
  t.mock.method(memory, "read", (address: number) => {
    const value = read(address);
    if (value === "bus-error") assert.fail("Unexpected bus error");
    observed.push({ kind: "read", address, value });
    return value;
  });
  t.mock.method(memory, "write", (address: number, value: number) => {
    assert.equal(write(address, value), undefined);
    observed.push({ kind: "write", address, value });
  });
  const deviceReads = t.mock.method(input, "read");
  const ramWrites = t.mock.method(machine.ram, "write");
  const reset = machine.reset();
  assert.deepEqual(reset, { before: initialState(), after: resetState(), accesses: reads(0, vectors.slice(0, 8)) });
  const setup = setupRecords();
  assert.deepEqual(runCpu(cpu, { maxSteps: 2 }), { records: setup, stopReason: "step-limit" });
  const records = [...setup];
  let state = setup.at(-1)!.after;
  const values = [null, 0, null, 0x80, 0xff, 0x4c, 0x4c, 10];
  for (const value of values) {
    if (value !== null) assert.equal(input.offer(value), true);
    const steps = iteration(state, value);
    assert.deepEqual(runCpu(cpu, { maxSteps: steps.length }), { records: steps, stopReason: value === 10 ? "halted" : "step-limit" });
    state = steps.at(-1)!.after;
    records.push(...steps);
    assert.deepEqual(input.snapshot(), { pendingByte: null });
  }
  assert.deepEqual(events, [0, 0x80, 0xff, 0x4c, 0x4c, 10]);
  assert.deepEqual(observed, [...reset.accesses, ...records.flatMap(record => record.accesses)]);
  assert.deepEqual(deviceReads.mock.calls.map(call => call.arguments), values.flatMap(value => value === null ? [[0]] : [[0], [1]]));
  assert.equal(ramWrites.mock.callCount(), 0);
  assert.deepEqual(cpu.step(), { before: state, after: state, instruction: null, accesses: [], outcome: "halted" });
  assert.deepEqual(observed, [...reset.accesses, ...records.flatMap(record => record.accesses)]);
  t.mock.restoreAll();
  checkImages(machine);
});

test("68000 echo restores CPU and both device snapshots at every boundary without replay", () => {
  const events: number[] = [];
  const onWrite = (value: number): void => { events.push(value); };
  const machine = create68000EchoExample(onWrite);
  machine.reset();
  let cpu = machine.cpu, input = machine.input, output = machine.output;
  const emitted: number[] = [];
  let state = resetState();
  function step(record: Cpu68000StepRecord, pendingByte: number | null): void {
    assert.deepEqual(runCpu(cpu, { maxSteps: 0 }), { records: [], stopReason: "step-limit" });
    assert.deepEqual(cpu.step(), record);
    assert.deepEqual(input.snapshot(), { pendingByte });
    for (const access of record.accesses) if (access.kind === "write" && access.address === 0x20000) emitted.push(access.value);
    assert.deepEqual(events, emitted);
    const savedInput = input.snapshot(), savedOutput = output.snapshot();
    input = new ByteInput(savedInput); output = new ByteOutput(onWrite, savedOutput);
    const memory = new MemoryMap(0x1000000, [
      { start: 0, memory: machine.rom }, { start: 0x10000, memory: machine.ram },
      { start: 0x20000, memory: output }, { start: 0x30000, memory: input },
    ]);
    const restoredInput = input, restoredOutput = output;
    cpu = new Cpu68000(memory, record.after, { resetDevices: () => { restoredInput.reset(); restoredOutput.reset(); } });
    assert.deepEqual(input.snapshot(), savedInput);
    assert.deepEqual(output.snapshot(), savedOutput);
    assert.deepEqual(events, emitted);
    state = record.after;
  }
  for (const record of setupRecords()) step(record, null);
  for (const value of [null, 0, 0x4c, 0x4c, 10]) {
    if (value !== null) assert.equal(input.offer(value), true);
    let pendingByte = value;
    for (const record of iteration(state, value)) {
      if (record.accesses.some(access => access.kind === "read" && access.address === 0x30001)) pendingByte = null;
      step(record, pendingByte);
    }
  }
  assert.deepEqual(events, [0, 0x4c, 0x4c, 10]);
  checkImages(machine);
});

test("68000 echo retains a captured byte in D0 while the host offers another before output", () => {
  const events: number[] = [];
  const machine = create68000EchoExample(value => { events.push(value); });
  machine.reset(); machine.input.offer(0x48);
  runCpu(machine.cpu, { maxSteps: 5 }); // Two LEAs, status, branch, then consuming read.
  assert.equal(machine.cpu.snapshot().d0, 0x48);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.equal(machine.input.offer(0x45), true);
  assert.equal(machine.input.offer(0x4c), false);
  runCpu(machine.cpu, { maxSteps: 3 });
  assert.deepEqual(events, [0x48]);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: 0x45 });
  runCpu(machine.cpu, { maxSteps: 6 });
  assert.deepEqual(events, [0x48, 0x45]);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
});

test("68000 input offered after an empty status read is consumed on the next poll", () => {
  for (const boundary of [1, 2]) {
    const events: number[] = [];
    const machine = create68000EchoExample(value => { events.push(value); });
    machine.reset(); runCpu(machine.cpu, { maxSteps: 2 });
    const empty = iteration(setupRecords().at(-1)!.after, null);
    assert.deepEqual(runCpu(machine.cpu, { maxSteps: boundary }).records, empty.slice(0, boundary));
    assert.equal(machine.input.offer(10), true);
    assert.deepEqual(runCpu(machine.cpu, { maxSteps: 2 - boundary }).records, empty.slice(boundary));
    assert.deepEqual(machine.input.snapshot(), { pendingByte: 10 });
    assert.deepEqual(events, []);
    assert.deepEqual(runCpu(machine.cpu, { maxSteps: 7 }), {
      records: iteration(empty.at(-1)!.after, 10), stopReason: "halted",
    });
    assert.deepEqual(events, [10]);
  }
});

test("68000 echo CPU reset preserves input; machine reset and RESET clear both devices without clearing RAM or output history", t => {
  const events: number[] = [];
  const machine = create68000EchoExample(value => { events.push(value); });
  machine.input.offer(0x41); machine.output.write(0, 0x42); machine.ram.write(0, 0x5a);
  machine.cpu.reset();
  assert.deepEqual(machine.input.snapshot(), { pendingByte: 0x41 });
  assert.deepEqual(machine.output.snapshot(), { lastByte: 0x42 });
  // Present RESET at the first fetch to exercise this composition's real CPU connection.
  const read = machine.memory.read.bind(machine.memory);
  t.mock.method(machine.memory, "read", (address: number) => address === 0x100 ? 0x4e : address === 0x101 ? 0x70 : read(address));
  const before = machine.cpu.snapshot();
  assert.deepEqual(machine.cpu.step(), {
    before, after: { ...before, pc: 0x102, physicalPc: 0x102, ir: 0x4e70, entry: { kind: "none", vector: 0 } },
    instruction: { address: 0x100, bytes: [0x4e, 0x70] },
    accesses: [...reads(0x100, [0x4e, 0x70]), { kind: "reset" }], outcome: "executed",
  });
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.equal(machine.ram.read(0), 0x5a);
  assert.deepEqual(events, [0x42]);
  t.mock.restoreAll();
  machine.reset(); machine.input.offer(10);
  assert.equal(runCpu(machine.cpu, { maxSteps: 9 }).stopReason, "halted");
  machine.input.offer(0x43);
  machine.reset();
  assert.equal(machine.cpu.snapshot().pc, 0x100);
  assert.equal(machine.cpu.snapshot().halted, false);
  assert.equal(machine.cpu.snapshot().d0, 10);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.equal(machine.ram.read(0), 0x5a);
  assert.deepEqual(events, [0x42, 10]);
});

test("68000 writes to input fault without consuming it, while a later long-read fault retains earlier consumption", () => {
  for (const kind of ["status-write", "data-write", "long-read"] as const) {
    const machine = create68000EchoExample(() => assert.fail("Unexpected output"));
    machine.reset(); machine.input.offer(0x41);
    const isRead = kind === "long-read";
    const address = kind === "data-write" ? 1 : 0;
    const bytes = isRead ? [0x20, 0x39, 0, 3, 0, 0] // MOVE.L (030000).L,D0
      : [0x13, 0xfc, 0, 0x55, 0, 3, 0, address]; // MOVE.B #55,(030000/1).L
    bytes.forEach((value, offset) => machine.ram.write(0x10 + offset, value));
    const cpu = new Cpu68000(machine.memory, { ...machine.cpu.snapshot(), pc: 0x10010, entry: { kind: "none", vector: 0 } });
    const record = cpu.step();
    assert.deepEqual(record.exception, { source: "bus-error", vector: 2, returnPc: 0x10010 + bytes.length,
      fault: { operation: isRead ? "read" : "write", address: isRead ? 0x30002 : 0x30000 + address,
        instructionRegister: isRead ? 0x2039 : 0x13fc, functionCode: 5, processingInstruction: true } });
    assert.equal(record.after.d0, 0);
    assert.equal(record.after.pc, 0x200);
    assert.deepEqual(machine.input.snapshot(), { pendingByte: isRead ? null : 0x41 });
    assert.deepEqual(record.accesses.filter(access => access.kind !== "reset" && access.address >= 0x30000),
      isRead ? reads(0x30000, [1, 0x41]) : []);
    assert.equal(cpu.step().outcome, "halted");
  }
});

test("68000 echo output failure preserves consumed input and captured D0 without automatic retry", () => {
  const failure = new Error("host output failed");
  const events: number[] = [];
  const machine = create68000EchoExample(value => { events.push(value); throw failure; });
  machine.reset(); machine.input.offer(0x48);
  runCpu(machine.cpu, { maxSteps: 5 });
  const before = machine.cpu.snapshot();
  assert.throws(() => machine.cpu.step(), error => error === failure);
  assert.deepEqual(machine.cpu.snapshot(), { ...before, ir: 0x1280 });
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: 0x48 });
  assert.deepEqual(events, [0x48]);
  checkImages(machine);
  machine.reset(); // An explicit reset releases the guard and starts a new polling run.
  assert.deepEqual(events, [0x48]);
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
});

test("8080 port and 68000 memory-mapped echo consume the same host message and stop after newline", () => {
  const message = [0x48, 0x45, 0x4c, 0x4c, 0x4f, 10];
  const portBytes: number[] = [], memoryBytes: number[] = [];
  const ports = create8080EchoExample(value => { portBytes.push(value); });
  const mapped = create68000EchoExample(value => { memoryBytes.push(value); });
  ports.reset(); mapped.reset();
  runCpu(mapped.cpu, { maxSteps: 2 });
  for (const value of message) {
    assert.equal(ports.input.offer(value), true);
    assert.equal(mapped.input.offer(value), true);
    const portRun = runCpu(ports.cpu, { maxSteps: value === 10 ? 8 : 7 });
    const mappedRun = runCpu(mapped.cpu, { maxSteps: value === 10 ? 7 : 6 });
    assert.equal(portRun.stopReason, value === 10 ? "halted" : "step-limit");
    assert.equal(mappedRun.stopReason, portRun.stopReason);
    assert.deepEqual(ports.input.snapshot(), mapped.input.snapshot());
    assert.deepEqual(ports.output.snapshot(), mapped.output.snapshot());
  }
  assert.deepEqual(portBytes, message);
  assert.deepEqual(memoryBytes, message);
});
