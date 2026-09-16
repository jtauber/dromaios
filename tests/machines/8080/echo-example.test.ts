import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8080 } from "../../../src/components/cpus/8080.js";
import type { Cpu8080Access, Cpu8080Snapshot, Cpu8080StepRecord } from "../../../src/components/cpus/8080.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8080EchoExample } from "../../../src/machines/8080/echo-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

const program = [0xdb, 0, 0xb7, 0xca, 0, 0, 0xdb, 1, 0xd3, 1, 0xfe, 0x0a, 0xc2, 0, 0, 0x76];
const initialState = (): Cpu8080Snapshot => ({
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, sp: 0, pc: 0, bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
});

function iteration(before: Cpu8080Snapshot, value: number | null): Cpu8080StepRecord[] {
  const records: Cpu8080StepRecord[] = [];
  function step(bytes: number[], pc: number, changes: Partial<Cpu8080Snapshot> = {}, data: Cpu8080Access[] = []): void {
    const after = { ...before, pc, ...changes };
    records.push({ before, after, instruction: { address: before.pc, bytes },
      accesses: [...bytes.map((value, offset): Cpu8080Access => ({ kind: "read", address: before.pc + offset, value })), ...data],
      outcome: after.halted ? "halted" : "executed" });
    before = after;
  }
  const ready = value === null ? 0 : 1;
  step([0xdb, 0], 2, { a: ready }, [{ kind: "input", port: 0, value: ready }]);
  step([0xb7], 3, { flags: { s: false, z: !ready, ac: false, p: !ready, cy: false } });
  step([0xca, 0, 0], ready ? 6 : 0);
  if (value === null) return records;
  step([0xdb, 1], 8, { a: value }, [{ kind: "input", port: 1, value }]);
  step([0xd3, 1], 0x0a, {}, [{ kind: "output", port: 1, value }]);
  const difference = (value - 10 + 256) % 256;
  const ones = difference.toString(2).split("").filter(bit => bit === "1").length;
  step([0xfe, 10], 0x0c, { flags: { s: difference >= 128, z: difference === 0,
    ac: value % 16 >= 10, p: ones % 2 === 0, cy: value < 10 } });
  step([0xc2, 0, 0], value === 10 ? 0x0f : 0);
  if (value === 10) step([0x76], 0x10, { halted: true });
  return records;
}

function checkMemory(ram: Ram): void {
  const image = new Uint8Array(0x10000);
  image.set(program);
  assert.equal(ram.size, image.length);
  for (const [address, value] of image.entries()) assert.equal(ram.read(address), value, `RAM ${address}`);
}

test("8080 echo allocates independent, empty devices and an unexecuted RAM program", () => {
  const events: number[] = [];
  const machine = create8080EchoExample(value => { events.push(value); });
  assert.deepEqual(machine.cpu.snapshot(), initialState());
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  checkMemory(machine.ram);
  machine.input.offer(0x41); machine.ports.writePort(1, 0x42); machine.ram.write(0, 0);
  const fresh = create8080EchoExample(() => assert.fail("Unexpected output"));
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  assert.deepEqual(fresh.input.snapshot(), { pendingByte: null });
  assert.deepEqual(fresh.output.snapshot(), { lastByte: null });
  assert.deepEqual(events, [0x42]);
  checkMemory(fresh.ram);
});

test("8080 echo polls, consumes each offered byte once, and records all accesses including zero and repeated input", t => {
  const events: number[] = [];
  const machine = create8080EchoExample(value => {
    events.push(value);
    assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
    assert.deepEqual(machine.output.snapshot(), { lastByte: value });
    assert.throws(() => machine.reset(), /must not be reentrant/);
    assert.deepEqual(machine.output.snapshot(), { lastByte: value });
  });
  const { cpu, ram, ports, input } = machine;
  const observed: Cpu8080Access[] = [];
  const read = ram.read.bind(ram), readPort = ports.readPort, writePort = ports.writePort;
  t.mock.method(ram, "read", (address: number) => {
    const value = read(address); observed.push({ kind: "read", address, value }); return value;
  });
  t.mock.method(ports, "readPort", (port: number) => {
    const value = readPort(port); observed.push({ kind: "input", port, value }); return value;
  });
  t.mock.method(ports, "writePort", (port: number, value: number) => {
    writePort(port, value); observed.push({ kind: "output", port, value });
  });
  const memoryWrites = t.mock.method(ram, "write");
  const deviceReads = t.mock.method(input, "read");
  const values = [null, 0, null, 0x80, 0xff, 0x4c, 0x4c, 10];
  const expected: Cpu8080StepRecord[] = [];
  let state = initialState();
  for (const value of values) {
    if (value !== null) assert.equal(input.offer(value), true);
    const records = iteration(state, value);
    assert.deepEqual(runCpu(cpu, { maxSteps: records.length }), {
      records, stopReason: value === 10 ? "halted" : "step-limit",
    });
    state = records.at(-1)!.after;
    expected.push(...records);
    assert.deepEqual(input.snapshot(), { pendingByte: null });
  }
  assert.deepEqual(events, [0, 0x80, 0xff, 0x4c, 0x4c, 10]);
  assert.deepEqual(observed, expected.flatMap(record => record.accesses));
  assert.deepEqual(deviceReads.mock.calls.map(call => call.arguments), values.flatMap(value => value === null ? [[0]] : [[0], [1]]));
  assert.equal(memoryWrites.mock.callCount(), 0);
  assert.deepEqual(cpu.snapshot(), state);
  assert.deepEqual(cpu.step(), { before: state, after: state, instruction: null, accesses: [], outcome: "halted" });
  assert.deepEqual(observed, expected.flatMap(record => record.accesses));
  t.mock.restoreAll();
  checkMemory(ram);
});

test("8080 echo restores the CPU at every boundary without consuming during inspection or replaying output", () => {
  const events: number[] = [];
  const machine = create8080EchoExample(value => { events.push(value); });
  let cpu = machine.cpu, state = initialState();
  const emitted: number[] = [];
  for (const value of [null, 0, 0x4c, 0x4c, 10]) {
    if (value !== null) assert.equal(machine.input.offer(value), true);
    let pendingByte = value;
    for (const record of iteration(state, value)) {
      const saved = machine.input.snapshot();
      assert.deepEqual(runCpu(cpu, { maxSteps: 0 }), { records: [], stopReason: "step-limit" });
      assert.deepEqual(cpu.step(), record);
      for (const access of record.accesses) {
        if (access.kind === "input" && access.port === 1) pendingByte = null;
        if (access.kind === "output") emitted.push(access.value);
      }
      assert.deepEqual(machine.input.snapshot(), { pendingByte });
      assert.deepEqual(events, emitted);
      const detached = structuredClone(saved);
      cpu = new Cpu8080(machine.ram, record.after, machine.ports);
      assert.deepEqual(saved, detached);
      assert.deepEqual(events, emitted);
      state = record.after;
    }
  }
  assert.deepEqual(events, [0, 0x4c, 0x4c, 10]);
});

test("8080 echo keeps captured data in A while the host supplies the next byte before output", () => {
  const events: number[] = [];
  const machine = create8080EchoExample(value => { events.push(value); });
  machine.input.offer(0x48);
  runCpu(machine.cpu, { maxSteps: 4 }); // IN data has consumed H; OUT has not run.
  assert.equal(machine.cpu.snapshot().a, 0x48);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.equal(machine.input.offer(0x45), true);
  assert.equal(machine.input.offer(0x4c), false);
  const cpu = new Cpu8080(machine.ram, machine.cpu.snapshot(), machine.ports);
  runCpu(cpu, { maxSteps: 3 });
  assert.deepEqual(events, [0x48]);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: 0x45 });
  runCpu(cpu, { maxSteps: 7 });
  assert.deepEqual(events, [0x48, 0x45]);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
});

test("8080 input offered after an empty status read is consumed on the next poll", () => {
  for (const boundary of [1, 2, 3]) {
    const events: number[] = [];
    const machine = create8080EchoExample(value => { events.push(value); });
    const empty = iteration(initialState(), null);
    assert.deepEqual(runCpu(machine.cpu, { maxSteps: boundary }).records, empty.slice(0, boundary));
    assert.equal(machine.input.offer(10), true);
    assert.deepEqual(runCpu(machine.cpu, { maxSteps: 3 - boundary }).records, empty.slice(boundary));
    assert.deepEqual(machine.input.snapshot(), { pendingByte: 10 });
    assert.deepEqual(events, []);
    assert.deepEqual(runCpu(machine.cpu, { maxSteps: 8 }), {
      records: iteration(empty.at(-1)!.after, 10), stopReason: "halted",
    });
    assert.deepEqual(events, [10]);
  }
});

test("8080 echo reset separates CPU state from device latches and preserves RAM and the host transcript", () => {
  const events: number[] = [];
  const machine = create8080EchoExample(value => { events.push(value); });
  machine.input.offer(0x41); machine.output.write(0, 0x42); machine.ram.write(0x200, 0x5a);
  machine.cpu.reset();
  assert.deepEqual(machine.input.snapshot(), { pendingByte: 0x41 });
  assert.deepEqual(machine.output.snapshot(), { lastByte: 0x42 });
  machine.reset();
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  machine.input.offer(10);
  assert.equal(runCpu(machine.cpu, { maxSteps: 8 }).stopReason, "halted");
  machine.input.offer(0x43);
  const before = machine.cpu.snapshot();
  assert.deepEqual(machine.reset(), { before, after: { ...before, pc: 0, halted: false }, accesses: [] });
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.equal(machine.ram.read(0x200), 0x5a);
  assert.deepEqual(events, [0x42, 10]);
});

test("8080 echo rejects unconnected ports without disturbing pending input", () => {
  const machine = create8080EchoExample(() => assert.fail("Unexpected output"));
  machine.input.offer(0);
  for (let port = 0; port < 256; port++) {
    if (port > 1) assert.throws(() => machine.ports.readPort(port), /input ports 00 and 01/);
    if (port !== 1) assert.throws(() => machine.ports.writePort(port, 0x41), /output port 01/);
  }
  assert.deepEqual(machine.input.snapshot(), { pendingByte: 0 });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
});

test("8080 echo output failure does not restore consumed input or repeat the host call", () => {
  const failure = new Error("host output failed");
  const events: number[] = [];
  let fail = true;
  const machine = create8080EchoExample(value => { events.push(value); if (fail) throw failure; });
  machine.input.offer(0x48);
  runCpu(machine.cpu, { maxSteps: 4 });
  const before = machine.cpu.snapshot();
  assert.throws(() => machine.cpu.step(), error => error === failure);
  assert.deepEqual(machine.cpu.snapshot(), { ...before, pc: 0x0a });
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: 0x48 });
  assert.deepEqual(events, [0x48]);
  fail = false;
  machine.input.offer(10);
  assert.equal(runCpu(machine.cpu, { maxSteps: 10 }).stopReason, "halted");
  assert.deepEqual(events, [0x48, 10]);
});
