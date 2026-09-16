import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000MemoryAccess } from "../../../src/components/cpus/68000.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { Rom } from "../../../src/components/memory/rom.js";
import { create68000RomBootExample } from "../../../src/machines/generated/68000/rom-boot-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

const vectors = [0, 1, 0x10, 0, 0, 0, 1, 0, 0, 0, 2, 0];
const program = [0x20, 0x3c, 0x12, 0x34, 0x56, 0x78, 0x23, 0xc0, 0, 1, 0, 0,
  0x22, 0x39, 0, 2, 0, 0, 0x23, 0xc0, 0, 1, 0, 4, 0x4e, 0x72, 0x27, 0];
const handler = [0x24, 0x2f, 0, 2, 0x23, 0xc2, 0, 1, 0, 8, 0x72, 1, 0x50, 0x8f, 0x4e, 0x73];
const frame = [0, 0x15, 0, 2, 0, 0, 0x22, 0x39, 0x27, 0, 0, 0, 1, 0x12];
const reads = (address: number, bytes: readonly number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "read", address: address + offset, value }));
const writes = (address: number, bytes: readonly number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "write", address: address + offset, value }));

function initialState(): Cpu68000Snapshot {
  return { d0: 0, d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0,
    a0: 0, a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, a6: 0, usp: 0, ssp: 0, pc: 0,
    ir: 0, interruptMask: 0, halted: false, faulted: false, tracePending: false,
    entry: { kind: "none", vector: 0 }, a7: 0, physicalPc: 0,
    flags: { x: false, n: false, z: false, v: false, c: false, t: false, s: false } };
}
function resetState(): Cpu68000Snapshot {
  const before = initialState();
  return { ...before, ssp: 0x11000, a7: 0x11000, pc: 0x100, physicalPc: 0x100, interruptMask: 7,
    flags: { ...before.flags, s: true }, entry: { kind: "reset", vector: 0 } };
}
function expectedRecords(): Cpu68000StepRecord[] {
  let before = resetState();
  const records: Cpu68000StepRecord[] = [];
  function step(bytes: number[], pc: number, changes: Partial<Cpu68000Snapshot> = {},
    data: Cpu68000MemoryAccess[] = [], exception?: Cpu68000StepRecord["exception"]): void {
    const after: Cpu68000Snapshot = { ...before, pc, physicalPc: pc, ir: bytes[0]! * 256 + bytes[1]!,
      entry: { kind: "none", vector: 0 }, ...changes };
    records.push({ before, after, instruction: { address: before.pc, bytes },
      accesses: [...reads(before.pc, bytes), ...data], outcome: after.halted ? "halted" : "executed",
      ...(exception ? { exception } : {}) });
    before = after;
  }
  step([0x20, 0x3c, 0x12, 0x34, 0x56, 0x78], 0x106, { d0: 0x12345678 });
  step([0x23, 0xc0, 0, 1, 0, 0], 0x10c, {}, writes(0x10000, [0x12, 0x34, 0x56, 0x78]));
  step([0x22, 0x39, 0, 2, 0, 0], 0x200, { ssp: 0x10ff2, a7: 0x10ff2, entry: { kind: "fault", vector: 2 } }, [
    ...writes(0x10ffe, [1, 0x12]), ...writes(0x10ffc, [0, 0]), ...writes(0x10ffa, [0x27, 0]),
    ...writes(0x10ff8, [0x22, 0x39]), ...writes(0x10ff6, [0, 0]), ...writes(0x10ff4, [0, 2]),
    ...writes(0x10ff2, [0, 0x15]), ...reads(8, [0, 0, 2, 0]),
  ], { source: "bus-error", vector: 2, returnPc: 0x112,
    fault: { operation: "read", address: 0x20000, instructionRegister: 0x2239, functionCode: 5, processingInstruction: true } });
  step([0x24, 0x2f, 0, 2], 0x204, { d2: 0x20000 }, reads(0x10ff4, [0, 2, 0, 0]));
  step([0x23, 0xc2, 0, 1, 0, 8], 0x20a, {}, writes(0x10008, [0, 2, 0, 0]));
  step([0x72, 1], 0x20c, { d1: 1 });
  step([0x50, 0x8f], 0x20e, { ssp: 0x10ffa, a7: 0x10ffa });
  step([0x4e, 0x73], 0x112, { ssp: 0x11000, a7: 0x11000 }, [
    ...reads(0x10ffc, [0, 0]), ...reads(0x10ffa, [0x27, 0]), ...reads(0x10ffe, [1, 0x12]),
  ]);
  step([0x23, 0xc0, 0, 1, 0, 4], 0x118, {}, writes(0x10004, [0x12, 0x34, 0x56, 0x78]));
  step([0x4e, 0x72, 0x27, 0], 0x11c, { halted: true });
  return records;
}
function checkImages(rom: Rom, ram: Ram, finished = false): void {
  const expectedRom = new Uint8Array(0x400);
  expectedRom.set(vectors); expectedRom.set(program, 0x100); expectedRom.set(handler, 0x200);
  const expectedRam = new Uint8Array(0x1000);
  if (finished) {
    expectedRam.set([0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78, 0, 2, 0, 0]);
    expectedRam.set(frame, 0xff2);
  }
  assert.equal(rom.size, 0x400); assert.equal(ram.size, 0x1000);
  for (const [address, value] of expectedRom.entries()) assert.equal(rom.read(address), value, `ROM ${address}`);
  for (const [address, value] of expectedRam.entries()) assert.equal(ram.read(address), value, `RAM ${address}`);
}

test("68000 ROM-boot construction owns small separate images without reset or execution", t => {
  const romReads = t.mock.method(Rom.prototype, "read");
  const ramReads = t.mock.method(Ram.prototype, "read");
  const ramWrites = t.mock.method(Ram.prototype, "write");
  const machine = create68000RomBootExample();
  assert.deepEqual(machine.cpu.snapshot(), initialState());
  assert.equal(romReads.mock.callCount(), 0);
  assert.equal(ramReads.mock.callCount(), 0);
  assert.equal(ramWrites.mock.callCount(), 0);
  assert.equal(machine.memory.size, 0x1000000);
  checkImages(machine.rom, machine.ram);
  for (const address of [0x400, 0xffff, 0x11000, 0x20000, 0xffffff]) {
    assert.equal(machine.memory.read(address), "bus-error");
  }
  const fresh = create68000RomBootExample();
  assert.notStrictEqual(machine.rom, fresh.rom);
  assert.notStrictEqual(machine.ram, fresh.ram);
  assert.notStrictEqual(machine.memory, fresh.memory);
  machine.memory.write(0x10000, 0xff);
  assert.equal(machine.ram.read(0), 0xff);
  assert.equal(fresh.ram.read(0), 0);
});

test("68000 ROM boot reads reset vectors, writes RAM, handles an unmapped read, returns, and stops", t => {
  const { cpu, memory, rom, ram } = create68000RomBootExample();
  const attempts: { kind: "read" | "write"; address: number; value: number | "bus-error" }[] = [];
  const read = memory.read.bind(memory), write = memory.write.bind(memory);
  t.mock.method(memory, "read", (address: number) => {
    const value = read(address); attempts.push({ kind: "read", address, value }); return value;
  });
  t.mock.method(memory, "write", (address: number, value: number) => {
    const result = write(address, value); attempts.push({ kind: "write", address, value: result ?? value }); return result;
  });
  const romReads = t.mock.method(rom, "read");
  const ramReads = t.mock.method(ram, "read");
  const ramWrites = t.mock.method(ram, "write");
  const reset = cpu.reset();
  assert.deepEqual(reset, { before: initialState(), after: resetState(), accesses: reads(0, vectors.slice(0, 8)) });
  const run = runCpu(cpu, { maxSteps: 10 });
  const expected = expectedRecords();
  assert.deepEqual(run, { records: expected, stopReason: "halted" });
  const completed = [...reset.accesses, ...expected.flatMap(record => record.accesses)];
  const failedReadIndex = 8 + 6 + 10 + 6; // Reset; first instruction; store; failed load's instruction bytes.
  assert.deepEqual(attempts, [...completed.slice(0, failedReadIndex),
    { kind: "read", address: 0x20000, value: "bus-error" }, ...completed.slice(failedReadIndex)]);
  assert.deepEqual(romReads.mock.calls.map(call => call.arguments), completed
    .flatMap(access => access.kind === "read" && access.address < 0x400 ? [[access.address]] : []));
  assert.deepEqual(ramReads.mock.calls.map(call => call.arguments), completed
    .flatMap(access => access.kind === "read" && access.address >= 0x10000 ? [[access.address - 0x10000]] : []));
  assert.deepEqual(ramWrites.mock.calls.map(call => call.arguments), completed
    .flatMap(access => access.kind === "write" ? [[access.address - 0x10000, access.value]] : []));
  assert.deepEqual(cpu.snapshot(), expected[9]!.after);
  const stopped = cpu.step();
  assert.deepEqual(stopped, { before: expected[9]!.after, after: expected[9]!.after, instruction: null, accesses: [], outcome: "halted" });
  checkImages(rom, ram, true);
});

test("68000 ROM boot pauses and restores snapshots at every instruction boundary including fault entry", () => {
  const machine = create68000RomBootExample();
  machine.cpu.reset();
  let cpu = machine.cpu;
  const records: Cpu68000StepRecord[] = [];
  const expected = expectedRecords();
  for (let index = 0; index < 10; index++) {
    assert.deepEqual(runCpu(cpu, { maxSteps: 0 }), { records: [], stopReason: "step-limit" });
    const run = runCpu(cpu, { maxSteps: 1 });
    assert.deepEqual(run, { records: [expected[index]], stopReason: index === 9 ? "halted" : "step-limit" });
    records.push(...run.records);
    cpu = new Cpu68000(machine.memory, cpu.snapshot());
  }
  const saved = structuredClone(records);
  const reset = cpu.reset();
  assert.equal(reset.before.halted, true);
  assert.equal(reset.after.halted, false);
  assert.equal(reset.after.pc, 0x100);
  assert.equal(reset.after.ssp, 0x11000);
  assert.equal(reset.after.d1, 1); // CPU reset preserves unspecified registers and RAM.
  checkImages(machine.rom, machine.ram, true);
  assert.equal(runCpu(cpu, { maxSteps: 10 }).stopReason, "halted");
  assert.deepEqual(records, saved);
  checkImages(machine.rom, machine.ram, true);
  const fresh = create68000RomBootExample();
  checkImages(fresh.rom, fresh.ram);
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
});

test("68000 mapped ROM rejects CPU writes through vector 2 without changing its image", () => {
  const { cpu: boot, memory, rom, ram } = create68000RomBootExample();
  boot.reset();
  // Execute MOVE.L D0,(000100).L from RAM so the attempted destination is immutable code.
  const bytes = [0x23, 0xc0, 0, 0, 1, 0];
  bytes.forEach((value, offset) => ram.write(0x10 + offset, value));
  const cpu = new Cpu68000(memory, { ...boot.snapshot(), pc: 0x10010, d0: 0xffffffff, entry: { kind: "none", vector: 0 } });
  const record = cpu.step();
  assert.deepEqual(record.exception, { source: "bus-error", vector: 2, returnPc: 0x10016,
    fault: { operation: "write", address: 0x100, instructionRegister: 0x23c0, functionCode: 5, processingInstruction: true } });
  assert.equal(record.after.pc, 0x200);
  assert.equal(record.after.ssp, 0x10ff2);
  assert.equal(record.accesses.some(access => access.kind === "write" && access.address < 0x400), false);
  for (const [offset, value] of program.entries()) assert.equal(rom.read(0x100 + offset), value);
});
