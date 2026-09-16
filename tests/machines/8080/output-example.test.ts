import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8080 } from "../../../src/components/cpus/8080.js";
import type { Cpu8080Access, Cpu8080Snapshot, Cpu8080StepRecord } from "../../../src/components/cpus/8080.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8080OutputExample } from "../../../src/machines/8080/output-example.js";
import { create68000OutputExample } from "../../../src/machines/68000/output-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

const message = [0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x0a];
const program = [0x21, 0x00, 0x01, 0x06, 0x06, 0x7e, 0xd3, 0x01, 0x23, 0x05, 0xc2, 0x05, 0x00, 0x76];

function initialState(): Cpu8080Snapshot {
  return { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0, sp: 0, bc: 0, de: 0, hl: 0,
    flags: { s: false, z: false, ac: false, p: false, cy: false },
    interruptEnabled: false, interruptDeferred: false, halted: false };
}

function expectedRecords(): Cpu8080StepRecord[] {
  let before = initialState();
  const records: Cpu8080StepRecord[] = [];
  function step(bytes: number[], pc: number, changes: Partial<Cpu8080Snapshot> = {}, data: Cpu8080Access[] = []): void {
    const after = { ...before, pc, ...changes };
    records.push({ before, after, instruction: { address: before.pc, bytes },
      accesses: [...bytes.map((value, offset): Cpu8080Access => ({ kind: "read", address: before.pc + offset, value })), ...data],
      outcome: after.halted ? "halted" : "executed" });
    before = after;
  }
  step([0x21, 0, 1], 3, { h: 1, hl: 0x100 });
  step([0x06, 6], 5, { b: 6, bc: 0x600 });
  // Independent literal DCR results for B = 6..1; CY remains clear.
  const counters = [
    { b: 5, z: false, p: true }, { b: 4, z: false, p: false }, { b: 3, z: false, p: true },
    { b: 2, z: false, p: false }, { b: 1, z: false, p: false }, { b: 0, z: true, p: true },
  ];
  for (const [index, value] of message.entries()) {
    const { b, z, p } = counters[index]!;
    step([0x7e], 6, { a: value }, [{ kind: "read", address: 0x100 + index, value }]);
    step([0xd3, 1], 8, {}, [{ kind: "output", port: 1, value }]);
    step([0x23], 9, { l: index + 1, hl: 0x101 + index });
    step([0x05], 0x0a, { b, bc: b * 256, flags: { s: false, z, ac: true, p, cy: false } });
    step([0xc2, 5, 0], b === 0 ? 0x0d : 5);
  }
  step([0x76], 0x0e, { halted: true });
  return records;
}

function checkMemory(ram: Ram): void {
  const image = new Uint8Array(0x10000);
  image.set(program); image.set(message, 0x100);
  assert.equal(ram.size, image.length);
  for (const [address, value] of image.entries()) assert.equal(ram.read(address), value, `RAM ${address}`);
}

test("8080 output factories allocate independent state without reset, execution, or notification", () => {
  const events: number[] = [];
  const machine = create8080OutputExample(value => { events.push(value); });
  assert.deepEqual(machine.cpu.snapshot(), initialState());
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.deepEqual(events, []);
  checkMemory(machine.ram);
  machine.ports.writePort(1, 0x41);
  machine.ram.write(0, 0);
  machine.cpu.step();
  const fresh = create8080OutputExample(() => assert.fail("Unexpected independent output"));
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  assert.deepEqual(fresh.output.snapshot(), { lastByte: null });
  checkMemory(fresh.ram);
  assert.deepEqual(events, [0x41]);
});

test("8080 output emits HELLO and records each RAM fetch and port transfer in order", t => {
  const events: number[] = [];
  const machine = create8080OutputExample(value => {
    events.push(value);
    const state = machine.cpu.snapshot();
    assert.deepEqual(machine.output.snapshot(), { lastByte: value });
    assert.throws(() => machine.cpu.step(), /must not be reentrant/);
    assert.throws(() => machine.cpu.interrupt(() => 0), /must not be reentrant/);
    assert.throws(() => machine.reset(), /must not be reentrant/);
    assert.deepEqual(machine.cpu.snapshot(), state);
    assert.deepEqual(machine.output.snapshot(), { lastByte: value });
  });
  const { cpu, ram, ports, output } = machine;
  const transfers: Cpu8080Access[] = [];
  const read = ram.read.bind(ram), writePort = ports.writePort;
  t.mock.method(ram, "read", (address: number) => {
    const value = read(address);
    transfers.push({ kind: "read", address, value });
    return value;
  });
  t.mock.method(ports, "writePort", (port: number, value: number) => {
    writePort(port, value);
    transfers.push({ kind: "output", port, value });
  });
  const writes = t.mock.method(ram, "write");
  const inputs = t.mock.method(ports, "readPort");
  const deviceWrites = t.mock.method(output, "write");
  const deviceReads = t.mock.method(output, "read");
  const expected = expectedRecords();
  const run = runCpu(cpu, { maxSteps: 33 });
  assert.deepEqual(run, { records: expected, stopReason: "halted" });
  assert.deepEqual(transfers, expected.flatMap(record => record.accesses));
  assert.deepEqual(events, message);
  assert.deepEqual(deviceWrites.mock.calls.map(call => call.arguments), message.map(value => [0, value]));
  assert.equal(deviceReads.mock.callCount(), 0);
  assert.equal(inputs.mock.callCount(), 0);
  assert.equal(writes.mock.callCount(), 0);
  assert.deepEqual(output.snapshot(), { lastByte: 10 });
  const final = expected[32]!.after;
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
  assert.deepEqual(transfers, expected.flatMap(record => record.accesses));
  assert.deepEqual(events, message);
  t.mock.restoreAll();
  checkMemory(ram);
});

test("8080 output resumes at every instruction boundary with the same device and no replay", () => {
  const events: number[] = [];
  const machine = create8080OutputExample(value => { events.push(value); });
  let cpu = machine.cpu;
  let sent = 0;
  const expected = expectedRecords();
  const records: Cpu8080StepRecord[] = [];
  for (const record of expected) {
    assert.deepEqual(runCpu(cpu, { maxSteps: 0 }), { records: [], stopReason: "step-limit" });
    const run = runCpu(cpu, { maxSteps: 1 });
    assert.deepEqual(run, { records: [record], stopReason: record.after.halted ? "halted" : "step-limit" });
    records.push(...run.records);
    if (record.instruction?.address === 6) sent++;
    assert.deepEqual(events, message.slice(0, sent));
    const saved = machine.output.snapshot();
    assert.deepEqual(saved, { lastByte: sent === 0 ? null : message[sent - 1] });
    cpu = new Cpu8080(machine.ram, cpu.snapshot(), machine.ports);
    assert.deepEqual(machine.output.snapshot(), saved);
    assert.deepEqual(events, message.slice(0, sent));
  }
  assert.deepEqual(records, expected);
  cpu.reset();
  assert.deepEqual(records, expected);
  assert.deepEqual(events, message);
  checkMemory(machine.ram);
});

test("8080 machine reset clears the output latch; CPU reset preserves it, and neither erases RAM or the host stream", () => {
  const events: number[] = [];
  const machine = create8080OutputExample(value => { events.push(value); });
  machine.ports.writePort(1, 0x7f);
  machine.ram.write(0x200, 0x5a);
  assert.deepEqual(machine.cpu.reset(), { before: initialState(), after: initialState(), accesses: [] });
  assert.deepEqual(machine.output.snapshot(), { lastByte: 0x7f });
  assert.deepEqual(machine.reset(), { before: initialState(), after: initialState(), accesses: [] });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.deepEqual(events, [0x7f]);
  const first = runCpu(machine.cpu, { maxSteps: 33 });
  assert.equal(first.stopReason, "halted");
  const saved = structuredClone(first);
  const before = machine.cpu.snapshot();
  const after = { ...before, pc: 0, halted: false };
  assert.deepEqual(machine.cpu.reset(), { before, after, accesses: [] });
  assert.deepEqual(machine.output.snapshot(), { lastByte: 10 });
  assert.deepEqual(machine.reset(), { before: after, after, accesses: [] });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.equal(machine.ram.read(0x200), 0x5a);
  assert.deepEqual(events, [0x7f, ...message]);
  assert.equal(runCpu(machine.cpu, { maxSteps: 33 }).stopReason, "halted");
  assert.deepEqual(events, [0x7f, ...message, ...message]);
  assert.equal(machine.ram.read(0x200), 0x5a);
  const halted = machine.cpu.snapshot();
  assert.deepEqual(machine.reset(), { before: halted, after: { ...halted, pc: 0, halted: false }, accesses: [] });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.deepEqual(events, [0x7f, ...message, ...message]);
  assert.deepEqual(first, saved);
});

test("8080 machine routing rejects every input and unconnected output before contacting the device", t => {
  const events: number[] = [];
  const { cpu, ram, output } = create8080OutputExample(value => { events.push(value); });
  const reads = t.mock.method(output, "read"), writes = t.mock.method(output, "write");
  for (let port = 0; port < 256; port++) {
    for (const opcode of [0xdb, 0xd3]) {
      if (opcode === 0xd3 && port === 1) continue;
      ram.write(0, opcode); ram.write(1, port);
      cpu.reset();
      const before = cpu.snapshot();
      assert.throws(() => cpu.step(), opcode === 0xdb ? /no input ports/ : /only connects output port 01/);
      assert.deepEqual(cpu.snapshot(), { ...before, pc: 2 });
      assert.deepEqual(output.snapshot(), { lastByte: null });
    }
  }
  assert.deepEqual(events, []);
  assert.equal(reads.mock.callCount(), 0);
  assert.equal(writes.mock.callCount(), 0);
});

test("8080 host output failure retains the byte and fetched PC without retry or a completed step", () => {
  const failure = new Error("output sink failed");
  const events: number[] = [];
  let fail = true;
  const machine = create8080OutputExample(value => { events.push(value); if (fail) throw failure; });
  runCpu(machine.cpu, { maxSteps: 3 });
  const before = machine.cpu.snapshot();
  assert.throws(() => machine.cpu.step(), error => error === failure);
  assert.deepEqual(machine.cpu.snapshot(), { ...before, pc: 8 });
  assert.deepEqual(machine.output.snapshot(), { lastByte: 0x48 });
  assert.deepEqual(events, [0x48]);
  fail = false;
  assert.equal(runCpu(machine.cpu, { maxSteps: 29 }).stopReason, "halted");
  assert.deepEqual(events, message);
  checkMemory(machine.ram);
});

test("8080 ports and 68000 mapped memory send the same bytes through the same device model", () => {
  const portBytes: number[] = [], memoryBytes: number[] = [];
  const portMachine = create8080OutputExample(value => { portBytes.push(value); });
  const memoryMachine = create68000OutputExample(value => { memoryBytes.push(value); });
  portMachine.reset(); memoryMachine.cpu.reset();
  assert.equal(runCpu(portMachine.cpu, { maxSteps: 33 }).stopReason, "halted");
  assert.equal(runCpu(memoryMachine.cpu, { maxSteps: 17 }).stopReason, "halted");
  assert.deepEqual(portBytes, message);
  assert.deepEqual(memoryBytes, message);
  assert.deepEqual(portMachine.output.snapshot(), memoryMachine.output.snapshot());
});
