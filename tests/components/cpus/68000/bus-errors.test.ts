import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../../src/components/cpus/68000.js";
import type { Cpu68000State, Cpu68000StepRecord, Cpu68000MemoryAccess } from "../../../../src/components/cpus/68000.js";
import type { MemoryConnection } from "../../../../src/components/memory/connection.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";

function state(overrides: Partial<Cpu68000State> = {}): Cpu68000State {
  return { d0: 0x12345678, d1: 0xabcdef01, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0,
    a0: 0xcd002000, a1: 0xef003000, a2: 0, a3: 0, a4: 0, a5: 0, a6: 0,
    usp: 0x34008000, ssp: 0x12009000, pc: 0xab001000, ir: 0x4e71, interruptMask: 2,
    halted: false, faulted: false, tracePending: false, entry: { kind: "none", vector: 0 },
    flags: { x: true, n: false, z: true, v: true, c: true, t: true, s: false }, ...overrides };
}
const physical = (address: number): number => ((address % 16777216) + 16777216) % 16777216;
const unsigned = (value: number): number => ((value % 4294967296) + 4294967296) % 4294967296;
const word = (value: number): number[] => [Math.floor(value / 256), value % 256];
const long = (value: number): number[] => [...word(Math.floor(value / 65536)), ...word(value % 65536)];
const accesses = (kind: "read" | "write", address: number, bytes: readonly number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind, address: physical(address + offset), value }));

// The connection reports faults before touching RAM; host exceptions use the same callback but throw.
class FaultMemory implements MemoryConnection {
  readonly size = 0x1000000;
  readonly ram = new ObservedRam(this.size);
  readonly attempts: { kind: "read" | "write"; address: number }[] = [];
  fail: (kind: "read" | "write", address: number) => boolean = () => false;
  read(address: number): number | "bus-error" {
    this.attempts.push({ kind: "read", address });
    return this.fail("read", address) ? "bus-error" : this.ram.read(address);
  }
  write(address: number, value: number): void | "bus-error" {
    this.attempts.push({ kind: "write", address });
    if (this.fail("write", address)) return "bus-error";
    this.ram.write(address, value);
  }
  load(address: number, bytes: readonly number[]): void {
    bytes.forEach((value, offset) => this.ram.write(physical(address + offset), value));
    this.ram.accesses.length = 0;
  }
}

function fixture(bytes: readonly number[], before = state()): { memory: FaultMemory; cpu: Cpu68000; before: Cpu68000State } {
  const memory = new FaultMemory();
  memory.load(before.pc, bytes);
  memory.load(8, long(0xef006000));
  memory.load(12, long(0xef007000));
  return { memory, cpu: new Cpu68000(memory, before), before };
}

function checkBusFrame(record: Cpu68000StepRecord, memory: FaultMemory, expected: {
  operation: "fetch" | "read" | "write"; address: number; returnPc: number; ir: number;
  code: 1 | 2 | 5 | 6; processing?: boolean; status?: number; stack?: number;
}): void {
  const { operation, address, returnPc, ir, code, processing = true, status = 0x8217, stack = 0x12008ff2 } = expected;
  assert.equal(record.outcome, "executed");
  assert.deepEqual(record.exception, { source: "bus-error", vector: 2, returnPc,
    fault: { operation, address, instructionRegister: ir, functionCode: code, processingInstruction: processing } });
  assert.equal(record.after.ssp, stack);
  assert.equal(record.after.pc, 0xef006000);
  assert.equal(record.after.tracePending, false);
  assert.equal(record.after.faulted, false);
  assert.deepEqual(record.after.entry, { kind: "fault", vector: 2 });
  assert.deepEqual(record.accesses, memory.ram.accesses);
  const special = (operation === "write" ? 0 : 16) + (processing ? 0 : 8) + code;
  // Figure 6-7, final offsets: SSW, access address, IR, SR, saved PC.
  const bytes = [...word(special), ...long(address), ...word(ir), ...word(status), ...long(returnPc)];
  const writes = [12, 10, 8, 6, 4, 2, 0].flatMap(offset => accesses("write", stack + offset, bytes.slice(offset, offset + 2)));
  assert.deepEqual(record.accesses.slice(-18), [...writes, ...accesses("read", 8, long(0xef006000))]);
  bytes.forEach((value, offset) => assert.equal(memory.ram.read(physical(stack + offset)), value));
}

test("68000 bus errors on each opcode and extension byte preserve the last complete fetch word", () => {
  const bytes = [0x20, 0x3c, 0x12, 0x34, 0x56, 0x78]; // MOVE.L #12345678,D0
  for (const s of [false, true]) for (let offset = 0; offset < bytes.length; offset++) {
    const before = state(); before.flags.s = s;
    const { memory, cpu } = fixture(bytes, before);
    memory.fail = (kind, address) => kind === "read" && address === 0x1000 + offset;
    const record = cpu.step();
    const complete = offset - offset % 2;
    checkBusFrame(record, memory, { operation: "fetch", address: before.pc + offset, returnPc: before.pc + complete,
      ir: offset < 2 ? 0x4e71 : 0x203c, code: s ? 6 : 2, status: s ? 0xa217 : 0x8217 });
    assert.deepEqual(record.instruction, offset < 2 ? null : { address: before.pc, bytes: bytes.slice(0, complete) });
    assert.deepEqual(record.accesses.slice(0, offset), accesses("read", before.pc, bytes.slice(0, offset)));
    assert.equal(record.after.d0, before.d0);
  }
});

test("68000 bus errors on every long operand byte preserve completed reads, writes, and staged An updates", () => {
  for (const store of [false, true]) for (const s of [false, true]) for (let offset = 0; offset < 4; offset++) {
    const before = state(); before.flags.s = s;
    const opcode = store ? 0x20c0 : 0x2018; // MOVE.L D0,(A0)+ / (A0)+,D0
    const { memory, cpu } = fixture(word(opcode), before);
    memory.load(before.a0, [0x87, 0x65, 0x43, 0x21]);
    memory.fail = (kind, address) => kind === (store ? "write" : "read") && address === 0x2000 + offset;
    const record = cpu.step();
    checkBusFrame(record, memory, { operation: store ? "write" : "read", address: before.a0 + offset,
      returnPc: before.pc + 2, ir: opcode, code: s ? 5 : 1, status: s ? 0xa217 : 0x8217 });
    assert.equal(record.after.a0, before.a0 + (store ? 4 : 0));
    assert.equal(record.after.d0, before.d0);
    assert.deepEqual(record.after.flags, { ...before.flags, s: true, t: false });
    assert.deepEqual(record.accesses.slice(2, 2 + offset), accesses(store ? "write" : "read", before.a0,
      (store ? [0x12, 0x34, 0x56, 0x78] : [0x87, 0x65, 0x43, 0x21]).slice(0, offset)));
    assert.equal(memory.ram.read(0x2000 + offset), [0x87, 0x65, 0x43, 0x21][offset]);
  }
});

test("68000 PC-relative operands and MOVEM use program function codes while MOVEP uses data space", () => {
  for (const s of [false, true]) for (const [bytes, address, operation, code, cursor] of [
    [[0x20, 0x3a, 0, 0x20], 0xab001023, "read", s ? 6 : 2, 4], // MOVE.L (32,PC),D0
    [[0x4c, 0xfa, 0, 1, 0, 0x20], 0xab001025, "read", s ? 6 : 2, 6], // MOVEM.L (32,PC),D0
    [[0x01, 0x48, 0, 0], 0xcd002004, "read", s ? 5 : 1, 4], // MOVEP.L (0,A0),D0
    [[0x01, 0xc8, 0, 0], 0xcd002004, "write", s ? 5 : 1, 4], // MOVEP.L D0,(0,A0)
    [[0x01, 0x3a, 0, 0x20], 0xab001022, "read", s ? 6 : 2, 4], // BTST D0,(32,PC)
    [[0x08, 0x3a, 0, 7, 0, 0x20], 0xab001024, "read", s ? 6 : 2, 6], // BTST #7,(32,PC)
  ] as const) {
    const before = state(); before.flags.s = s;
    const { memory, cpu } = fixture(bytes, before);
    memory.fail = (kind, physicalAddress) => kind === operation && physicalAddress === physical(address);
    checkBusFrame(cpu.step(), memory, { operation, address, returnPc: before.pc + cursor,
      ir: bytes[0]! * 256 + bytes[1]!, code, status: s ? 0xa217 : 0x8217 });
  }
});

test("68000 bit modifiers, TAS, and memory shifts retain A7 updates and flags at every failed operand byte", () => {
  // Opcode without EA, input bytes, output bytes, and resulting XNZVC. BTST has no output.
  const cases = [
    [0x0100, [1], [], 0x13], [0x0140, [1], [0], 0x13], [0x0180, [1], [0], 0x13], [0x01c0, [1], [1], 0x13],
    [0x4ac0, [1], [0x81], 0x10],
    [0xe0c0, [0x80, 1], [0xc0, 0], 0x19], [0xe1c0, [0x80, 1], [0, 2], 0x13],
    [0xe2c0, [0x80, 1], [0x40, 0], 0x11], [0xe3c0, [0x80, 1], [0, 2], 0x11],
    [0xe4c0, [0x80, 1], [0xc0, 0], 0x19], [0xe5c0, [0x80, 1], [0, 3], 0x11],
    [0xe6c0, [0x80, 1], [0xc0, 0], 0x19], [0xe7c0, [0x80, 1], [0, 3], 0x11],
  ] as const;
  for (const [base, input, output, flags] of cases) for (const s of [false, true]) for (const mode of [3, 4]) {
    const opcode = base + mode * 8 + 7;
    for (let failAt = 0; failAt < input.length + output.length; failAt++) {
      const before = state({ d0: 0 }); before.flags.s = s; before.flags.t = false;
      const stack = s ? before.ssp : before.usp, address = stack - (mode === 4 ? 2 : 0), updated = stack + (mode === 3 ? 2 : -2);
      const { memory, cpu } = fixture(word(opcode), before);
      memory.load(address, input);
      const writing = failAt >= input.length, offset = writing ? failAt - input.length : failAt;
      let failed = false;
      memory.fail = (kind, a) => {
        if (failed || kind !== (writing ? "write" : "read") || a !== physical(address + offset)) return false;
        failed = true; return true;
      };
      const record = cpu.step();
      checkBusFrame(record, memory, { operation: writing ? "write" : "read", address: address + offset,
        returnPc: before.pc + 2, ir: opcode, code: s ? 5 : 1, stack: (s ? updated : before.ssp) - 14,
        status: (s ? 0x2200 : 0x0200) + (writing ? flags : 0x17) });
      assert.equal(record.after.usp, s ? before.usp : updated);
      assert.deepEqual(record.accesses.slice(2, -18), writing
        ? [...accesses("read", address, input), ...accesses("write", address, output.slice(0, offset))]
        : accesses("read", address, input.slice(0, offset)));
      assert.equal(record.after.d0, 0);
    }
  }
});

test("68000 bus faults retain full logical addresses across the physical bus and 32-bit wrap", () => {
  for (const a0 of [0x12fffffe, 0xfffffffe]) for (let offset = 0; offset < 4; offset++) {
    const before = state({ a0 });
    const { memory, cpu } = fixture([0x20, 0xc0], before); // MOVE.L D0,(A0)+
    memory.fail = (kind, address) => kind === "write" && address === physical(a0 + offset);
    const record = cpu.step();
    checkBusFrame(record, memory, { operation: "write", address: unsigned(a0 + offset), returnPc: before.pc + 2, ir: 0x20c0, code: 1 });
    assert.equal(record.after.a0, unsigned(a0 + 4));
  }
});

test("68000 call-stack write failures save the sequential PC and preserve the uncommitted user SP", () => {
  for (const bytes of [[0x61, 0x10], [0x4e, 0xb9, 0xcd, 0, 0x20, 0]]) for (let offset = 0; offset < 4; offset++) {
    const { memory, cpu, before } = fixture(bytes); // BSR.s / JSR absolute long
    memory.fail = (kind, address) => kind === "write" && address === 0x7ffc + offset;
    const record = cpu.step();
    checkBusFrame(record, memory, { operation: "write", address: before.usp - 4 + offset,
      returnPc: before.pc + bytes.length, ir: bytes[0]! * 256 + bytes[1]!, code: 1 });
    assert.equal(record.after.usp, before.usp);
    assert.deepEqual(record.accesses.slice(bytes.length, bytes.length + offset),
      accesses("write", before.usp - 4, long(before.pc + bytes.length).slice(0, offset)));
  }
});

test("68000 MOVEM retains complete earlier registers and ALU write faults retain computed flags", () => {
  for (let offset = 0; offset < 8; offset++) {
    const { memory, cpu, before } = fixture([0x4c, 0xd8, 0, 3]); // MOVEM.L (A0)+,D0-D1
    memory.load(before.a0, [0x87, 0x65, 0x43, 0x21, 0xfe, 0xdc, 0xba, 0x98]);
    memory.fail = (kind, address) => kind === "read" && address === 0x2000 + offset;
    const record = cpu.step();
    checkBusFrame(record, memory, { operation: "read", address: before.a0 + offset, returnPc: before.pc + 4, ir: 0x4cd8, code: 1 });
    assert.equal(record.after.a0, before.a0);
    assert.equal(record.after.d0, offset >= 4 ? 0x87654321 : before.d0);
    assert.equal(record.after.d1, before.d1);
  }
  for (const operation of ["read", "write"] as const) {
    const { memory, cpu, before } = fixture([0x52, 0x98]); // ADDQ.L #1,(A0)+
    memory.load(before.a0, [255, 255, 255, 255]);
    memory.fail = (kind, address) => kind === operation && address === 0x2001;
    const record = cpu.step();
    checkBusFrame(record, memory, { operation, address: before.a0 + 1, returnPc: before.pc + 2,
      ir: 0x5298, code: 1, status: operation === "write" ? 0x8215 : 0x8217 });
    assert.equal(record.after.a0, before.a0 + 4);
    assert.equal(record.after.flags.v, operation !== "write");
  }
});

test("68000 bus faults on every short-frame and vector byte retain entry effects and classify exception groups", () => {
  for (const [opcode, vector, processing] of [[0x4e40, 32, true], [0x4afc, 4, false]] as const) {
    for (let stop = 0; stop < 10; stop++) {
      const { memory, cpu, before } = fixture(word(opcode));
      memory.load(vector * 4, long(0xcd004000));
      let calls = 0;
      memory.fail = () => calls++ === stop + 2;
      const record = cpu.step();
      const stackOffsets = [-2, -1, -6, -5, -4, -3];
      const address = stop < 6 ? before.ssp + stackOffsets[stop]! : vector * 4 + stop - 6;
      checkBusFrame(record, memory, { operation: stop < 6 ? "write" : "read", address,
        returnPc: stop < 6 ? before.pc + (processing ? 2 : 0) : vector * 4,
        ir: opcode, code: 5, processing, status: 0x2217, stack: before.ssp - 20 });
      assert.equal(record.accesses.length, 2 + stop + 18);
    }
  }
});

test("68000 interrupt and trace entry bus faults preserve acknowledgment, masks, and supervisor access", () => {
  for (const trace of [false, true]) for (let stop = 0; stop < 10; stop++) {
    const before = state({ tracePending: trace });
    const { memory, cpu } = fixture([], before);
    const vector = trace ? 9 : 31;
    memory.load(vector * 4, long(0xcd004000));
    let calls = 0;
    memory.fail = () => calls++ === stop;
    const record = trace ? cpu.step() : cpu.interrupt(7, () => "autovector");
    const stackOffsets = [-2, -1, -6, -5, -4, -3];
    const address = stop < 6 ? before.ssp + stackOffsets[stop]! : vector * 4 + stop - 6;
    assert.equal(record.outcome, "executed");
    assert.deepEqual(record.exception, { source: "bus-error", vector: 2,
      returnPc: stop < 6 ? before.pc : vector * 4,
      fault: { operation: stop < 6 ? "write" : "read", address, instructionRegister: 0x4e71,
        functionCode: 5, processingInstruction: false } });
    assert.equal(record.after.interruptMask, trace ? 2 : 7);
    assert.equal(record.after.ssp, before.ssp - 20);
    assert.equal(record.after.tracePending, false);
    assert.deepEqual(record.accesses.filter(access => access.kind !== "acknowledge"), memory.ram.accesses);
    if (!trace) assert.deepEqual(record.accesses[0], { kind: "acknowledge", level: 7, value: "autovector" });
  }
});

test("68000 bus faults on each byte of either memory-error entry terminally halt without another frame", () => {
  for (const addressError of [false, true]) for (let stop = 0; stop < 18; stop++) {
    const before = state({ pc: addressError ? 0xab001001 : 0xab001000 });
    const { memory, cpu } = fixture([0x30, 0x10], before); // MOVE.W (A0),D0, or odd initial PC
    let calls = 0;
    memory.fail = () => {
      const call = calls++;
      return addressError ? call === stop : call === 2 || call === stop + 3;
    };
    const record = cpu.step();
    assert.equal(record.outcome, "halted");
    assert.equal(record.after.faulted, true);
    assert.equal(record.after.halted, false);
    assert.equal(record.after.ssp, before.ssp - 14);
    assert.equal(record.after.pc, before.pc);
    const vector = addressError ? 3 : 2;
    assert.equal(record.exception?.source, addressError ? "address-error" : "bus-error");
    if (record.exception?.source !== "address-error" && record.exception?.source !== "bus-error") assert.fail();
    assert.deepEqual(record.exception.entryFault, { source: "bus-error", operation: stop < 14 ? "write" : "read",
      address: stop < 14 ? before.ssp - 2 - 2 * Math.floor(stop / 2) + stop % 2 : vector * 4 + stop - 14 });
    assert.equal(record.accesses.length, stop + (addressError ? 0 : 2));
    assert.deepEqual(record.accesses, memory.ram.accesses);
    const saved = structuredClone(record);
    const restored = new Cpu68000(memory, record.after);
    assert.deepEqual(restored.step(), { before: record.after, after: record.after, instruction: null, accesses: [], outcome: "halted" });
    assert.equal(restored.interrupt(7, () => assert.fail("No acknowledgment while faulted")).outcome, "ignored");
    assert.deepEqual(record, saved);
  }
});

test("68000 address errors during bus-error stacking or handler selection terminally halt", () => {
  for (const oddStack of [false, true]) {
    const before = state({ ssp: oddStack ? 0x12009001 : 0x12009000 });
    const { memory, cpu } = fixture([0x30, 0x10], before);
    memory.load(8, long(0xef006001));
    memory.fail = (kind, address) => kind === "read" && address === 0x2000;
    const record = cpu.step();
    assert.equal(record.outcome, "halted");
    if (record.exception?.source !== "bus-error") assert.fail();
    assert.deepEqual(record.exception.entryFault, oddStack ? { operation: "write", address: 0x12008fff }
      : { operation: "fetch", address: 0xef006001 });
    assert.equal(record.accesses.length, oddStack ? 2 : 20);
  }
});

test("68000 reset bus faults commit only complete vectors and halt until another external reset succeeds", () => {
  for (let stop = 0; stop < 8; stop++) {
    const before = state({ halted: true, faulted: true, tracePending: true });
    const { memory, cpu } = fixture([0x4e, 0x71], before);
    const bytes = [...long(0x56007000), ...long(before.pc)];
    memory.load(0, bytes);
    let calls = 0;
    memory.fail = () => calls++ === stop;
    const record = cpu.reset();
    assert.deepEqual(record.fault, { source: "bus-error", operation: "read", address: stop });
    assert.deepEqual(record.accesses, accesses("read", 0, bytes.slice(0, stop)));
    assert.equal(record.after.ssp, stop < 4 ? before.ssp : 0x56007000);
    assert.equal(record.after.pc, before.pc);
    assert.equal(record.after.ir, before.ir);
    assert.equal(record.after.interruptMask, 7);
    assert.deepEqual(record.after.entry, { kind: "reset", vector: 0 });
    assert.deepEqual(record.after.flags, { ...before.flags, s: true, t: false });
    assert.equal(record.after.faulted, true);
    assert.equal(record.after.halted, false);
    assert.equal(record.after.tracePending, false);
    const restored = new Cpu68000(memory, record.after);
    assert.equal(restored.step().outcome, "halted");
    memory.fail = () => false;
    assert.equal(restored.reset().after.faulted, false);
    assert.equal(restored.step().outcome, "executed");
    assert.deepEqual(restored.snapshot().entry, { kind: "none", vector: 0 });
  }
});

test("68000 snapshots retain first-handler-fetch grouping for reset, memory faults, traps, trace, and interrupts", () => {
  for (const kind of ["reset", "fault", "address-error", "trap", "exception", "trace", "interrupt"] as const) {
    for (const offset of [0, 1]) {
      const before = state(); before.flags.t = false;
      if (kind === "trace") before.tracePending = true;
      if (kind === "address-error") before.pc++;
      const bytes = kind === "trap" ? [0x4e, 0x40] : kind === "fault" ? [0x30, 0x10] : [0x4a, 0xfc];
      const { memory, cpu } = fixture(bytes, before);
      const vector = { reset: 0, fault: 2, "address-error": 3, trap: 32, exception: 4, trace: 9, interrupt: 31 }[kind];
      if (kind === "reset") memory.load(0, [...long(before.ssp), ...long(0xef006000)]);
      else memory.load(vector * 4, long(0xef006000));
      memory.load(0x6000, [0x4e, 0x71]);
      memory.fail = (operation, address) => kind === "fault" && operation === "read" && address === 0x2000;
      const entry = kind === "reset" ? cpu.reset() : kind === "interrupt" ? cpu.interrupt(7, () => "autovector") : cpu.step();
      const saved = structuredClone(entry.after);
      const restored = new Cpu68000(memory, entry.after);
      memory.ram.accesses.length = 0;
      memory.fail = (operation, address) => operation === "read" && address === 0x6000 + offset;
      const record = restored.step();
      assert.equal(record.instruction, null);
      assert.equal(record.after.ir, saved.ir);
      if (kind === "reset" || kind === "fault" || kind === "address-error") {
        assert.equal(record.outcome, "halted");
        assert.equal(record.exception, undefined);
        assert.deepEqual(record.fault, { source: "bus-error", operation: "fetch", address: 0xef006000 + offset });
        assert.equal(record.after.ssp, saved.ssp);
        assert.equal(record.accesses.length, offset);
        assert.deepEqual(record.after.entry, saved.entry);
      } else {
        checkBusFrame(record, memory, { operation: "fetch", address: 0xef006000 + offset, returnPc: vector * 4,
          ir: saved.ir, code: 6, processing: kind === "trap", status: kind === "interrupt" ? 0x2717 : 0x2217, stack: saved.ssp - 14 });
      }
      assert.deepEqual(entry.after, saved);
    }
  }
});

test("68000 a bus-error handler can discard its extended frame, RTE, and resume from a restored snapshot", () => {
  const before = state(); before.flags.t = false;
  const { memory, cpu } = fixture([0x30, 0x10, 0x70, 0x2a], before);
  memory.load(0x6000, [0x50, 0x8f, 0x4e, 0x73]); // ADDQ.L #8,A7; RTE
  memory.fail = (kind, address) => kind === "read" && address === 0x2000;
  const entry = cpu.step();
  const saved = structuredClone(entry);
  const restored = new Cpu68000(memory, entry.after);
  assert.equal(restored.step().after.ssp, before.ssp - 6);
  const returned = restored.step();
  assert.equal(returned.after.pc, before.pc + 2);
  assert.equal(returned.after.ssp, before.ssp);
  assert.deepEqual(returned.after.flags, before.flags);
  assert.deepEqual(returned.after.entry, { kind: "none", vector: 0 });
  assert.equal(restored.step().after.d0, 42);
  assert.deepEqual(entry, saved);
});

test("68000 host exceptions and invalid memory results never become emulated bus errors", () => {
  for (const failure of [new Error("host failure"), "bus-error", null, 42]) {
    for (const stop of [0, 1, 2, 3, 4, 10, 19]) {
      const { memory, cpu } = fixture([0x30, 0x10]);
      let calls = 0;
      memory.fail = () => {
        const call = calls++;
        assert.throws(() => cpu.step(), /must not be reentrant/);
        if (call === stop) throw failure;
        return call === 2; // Enter vector 2 unless the host failure occurs first.
      };
      assert.throws(() => cpu.step(), error => error === failure);
      assert.equal(cpu.snapshot().faulted, false);
      memory.fail = () => false;
      assert.doesNotThrow(() => cpu.reset());
    }
  }
  for (const value of [-1, 256, 1.5, NaN, undefined, null, "12"]) {
    const memory = { size: 0x1000000, read: () => value, write: () => {} };
    // Deliberately violate the typed host contract to check the runtime boundary.
    assert.throws(() => new Cpu68000(memory as MemoryConnection, state()).step(), RangeError);
  }
  const { memory, before } = fixture([0x20, 0xc0]);
  const invalid = { size: memory.size, read: (address: number) => memory.read(address), write: () => 0 };
  assert.throws(() => new Cpu68000(invalid as unknown as MemoryConnection, before).step(), /write must return nothing/);
});

test("68000 RTE bus faults preserve unconsumed supervisor state and already completed frame reads", () => {
  for (let stop = 0; stop < 6; stop++) {
    const before = state(); before.flags.s = true;
    const { memory, cpu } = fixture([0x4e, 0x73], before);
    memory.load(before.ssp, [0, 0x15, 0xcd, 0, 0x20, 0]);
    let calls = 0;
    memory.fail = () => calls++ === stop + 2;
    const record = cpu.step();
    checkBusFrame(record, memory, { operation: "read", address: before.ssp + [2, 3, 0, 1, 4, 5][stop]!,
      returnPc: before.pc + 2, ir: 0x4e73, code: 5, status: 0xa217 });
    assert.equal(record.after.usp, before.usp);
    assert.deepEqual(record.after.flags, { ...before.flags, t: false });
  }
});

test("68000 bus-error frames wrap and can overwrite vector 2 before its bytes are read", () => {
  for (const ssp of [6, 22]) {
    const { memory, cpu, before } = fixture([0x30, 0x10], state({ ssp }));
    memory.fail = (kind, address) => kind === "read" && address === 0x2000;
    const record = cpu.step();
    const stack = unsigned(ssp - 14);
    const bytes = [0, 0x11, 0xcd, 0, 0x20, 0, 0x30, 0x10, 0x82, 0x17, 0xab, 0, 0x10, 2];
    assert.equal(record.after.pc, ssp === 6 ? 0xef006000 : 0x0011cd00);
    assert.equal(record.after.ssp, stack);
    assert.equal(record.exception?.returnPc, before.pc + 2);
    assert.equal(record.accesses.length, 20);
    assert.deepEqual(record.accesses.slice(-4), accesses("read", 8, long(record.after.pc)));
    bytes.forEach((value, offset) => assert.equal(memory.ram.read(physical(stack + offset)), value));
  }
});

test("68000 pending-entry state validates, detaches, and clears once a handler opcode is fetched", () => {
  const { memory } = fixture([0x4e, 0x71]);
  for (const kind of ["none", "reset", "fault", "exception", "trap"] as const) {
    const before = state({ entry: { kind, vector: 32 } });
    const cpu = new Cpu68000(memory, before);
    before.entry.kind = "none"; before.entry.vector = 0;
    const snapshot = cpu.snapshot();
    assert.deepEqual(snapshot.entry, { kind, vector: 32 });
    Reflect.set(snapshot.entry, "kind", "reset");
    assert.deepEqual(cpu.snapshot().entry, { kind, vector: 32 });
    assert.deepEqual(cpu.step().after.entry, { kind: "none", vector: 0 });
  }
  for (const kind of [undefined, "bogus", 0, null]) {
    const before = state(); Reflect.set(before.entry, "kind", kind);
    assert.throws(() => new Cpu68000(memory, before), RangeError);
  }
  for (const vector of [undefined, -1, 256, 0.5]) {
    const before = state(); Reflect.set(before.entry, "vector", vector);
    assert.throws(() => new Cpu68000(memory, before), RangeError);
  }
});

test("68000 logical destination faults retain committed A7 updates and only completed flags and bytes", () => {
  const left = [0x89, 0xab, 0xcd, 0xef], right = [0x12, 0x34, 0x56, 0x78];
  const families = [
    { opcode: 0xc31f, result: 0x00204468 }, // AND D1,(A7)+
    { opcode: 0x831f, result: 0x9bbfdfff }, // OR D1,(A7)+
    { opcode: 0xb31f, result: 0x9b9f9b97 }, // EOR D1,(A7)+
    { opcode: 0x021f, result: 0x00204468 }, // ANDI #n,(A7)+
    { opcode: 0x001f, result: 0x9bbfdfff }, // ORI #n,(A7)+
    { opcode: 0x0a1f, result: 0x9b9f9b97 }, // EORI #n,(A7)+
    { opcode: 0x421f, result: 0 }, // CLR (A7)+
    { opcode: 0x461f, result: 0x76543210 }, // NOT (A7)+
    { opcode: 0x4a1f, result: 0x89abcdef }, // TST (A7)+
  ];
  for (const family of families) for (const size of [1, 2, 4]) for (const supervisor of [false, true]) {
    const opcode = family.opcode + (size === 1 ? 0 : size === 2 ? 64 : 128);
    const bytes = [...word(opcode), ...(family.opcode < 0x1000 ? size === 4 ? right : right.slice(2) : [])];
    const value = family.result % 2 ** (size * 8), flags = { x: true, n: value >= 2 ** (size * 8 - 1), z: value === 0, v: false, c: false };
    for (const operation of family.opcode === 0x4a1f ? ["read"] as const : ["read", "write"] as const) for (let offset = 0; offset < size; offset++) {
      const before = state({ d1: 0x12345678 }); before.flags.s = supervisor;
      const active = supervisor ? before.ssp : before.usp, increment = size === 1 ? 2 : size;
      const { memory, cpu } = fixture(bytes, before);
      memory.load(active, left.slice(4 - size));
      // Report only the operand fault: the supervisor frame can overlap the old (A7)+ destination.
      let reported = false;
      memory.fail = (kind, address) => {
        if (reported || kind !== operation || address !== physical(active + offset)) return false;
        reported = true; return true;
      };
      const record = cpu.step(), completedFlags = operation === "write" ? { ...before.flags, ...flags } : before.flags;
      const lowStatus = operation === "write" ? 0x10 + (flags.n ? 8 : 0) + (flags.z ? 4 : 0) : 0x17;
      checkBusFrame(record, memory, { operation, address: active + offset, returnPc: before.pc + bytes.length, ir: opcode,
        code: supervisor ? 5 : 1, status: (supervisor ? 0xa200 : 0x8200) + lowStatus,
        stack: (supervisor ? active + increment : before.ssp) - 14 });
      assert.equal(record.after.usp, before.usp + (supervisor ? 0 : increment));
      assert.deepEqual(record.after.flags, { ...completedFlags, s: true, t: false });
      assert.deepEqual(record.accesses.slice(bytes.length, -18), [
        ...accesses("read", active, left.slice(4 - size, operation === "read" ? 4 - size + offset : 4)),
        ...(operation === "write" ? accesses("write", active, long(value).slice(4 - size, 4 - size + offset)) : []),
      ]);
    }
  }
});

test("68000 AND/OR source faults discard auto-updates and retain PC-relative program-space identity", () => {
  for (const base of [0x8000, 0xc000]) for (const size of [1, 2, 4]) for (const supervisor of [false, true]) for (const pcRelative of [false, true]) {
    const before = state(); before.flags.s = supervisor;
    const opcode = base + (size === 1 ? 0 : size === 2 ? 64 : 128) + (pcRelative ? 0x3a : 0x1f);
    const bytes = [...word(opcode), ...(pcRelative ? [0, 0x20] : [])], active = supervisor ? before.ssp : before.usp;
    const source = pcRelative ? before.pc + 0x22 : active;
    for (let offset = 0; offset < size; offset++) {
      const { memory, cpu } = fixture(bytes, before);
      memory.load(source, [0x89, 0xab, 0xcd, 0xef].slice(4 - size));
      memory.fail = (kind, address) => kind === "read" && address === physical(source + offset);
      const record = cpu.step();
      checkBusFrame(record, memory, { operation: "read", address: source + offset, returnPc: before.pc + bytes.length, ir: opcode,
        code: pcRelative ? supervisor ? 6 : 2 : supervisor ? 5 : 1, status: supervisor ? 0xa217 : 0x8217 });
      assert.equal(record.after.d0, before.d0); assert.equal(record.after.usp, before.usp);
      assert.deepEqual(record.after.flags, { ...before.flags, s: true, t: false });
    }
  }
});

test("68000 paired arithmetic bus faults preserve the correct stage when both operands use A7", () => {
  for (const base of [0xdf0f, 0x9f0f, 0xbf0f]) for (const size of [1, 2, 4]) for (const supervisor of [false, true]) {
    const compare = base === 0xbf0f, step = size === 1 ? 2 : size;
    const opcode = base + (size === 1 ? 0 : size === 2 ? 64 : 128);
    for (const phase of compare ? ["source", "destination"] : ["source", "destination", "write"]) for (let offset = 0; offset < size; offset++) {
      const before = state(); before.flags.s = supervisor;
      const active = supervisor ? before.ssp : before.usp, source = active + (compare ? 0 : -step);
      const destination = active + (compare ? step : -2 * step), committed = active + (compare ? 2 * step : -2 * step);
      const { memory, cpu } = fixture(word(opcode), before);
      const sourceBytes = Array<number>(size).fill(0xff), destinationBytes = Array<number>(size).fill(0);
      memory.load(source, sourceBytes); memory.load(destination, destinationBytes);
      const operation = phase === "write" ? "write" : "read", faultAddress = (phase === "source" ? source : destination) + offset;
      // Let frame writes succeed even if they overlap the faulting operand.
      let reported = false;
      memory.fail = (kind, address) => {
        if (reported || kind !== operation || address !== physical(faultAddress)) return false;
        reported = true; return true;
      };
      const record = cpu.step(), updated = phase === "source" ? active : committed;
      // 0 + FF..FF + X and 0 - FF..FF - X both produce zero with C=X=Z=1.
      checkBusFrame(record, memory, { operation, address: faultAddress, returnPc: before.pc + 2, ir: opcode,
        code: supervisor ? 5 : 1, status: (supervisor ? 0xa200 : 0x8200) + (phase === "write" ? 0x15 : 0x17),
        stack: (supervisor ? updated : before.ssp) - 14 });
      assert.equal(record.after.usp, supervisor ? before.usp : updated);
      assert.deepEqual(record.after.flags, { ...before.flags, s: true, t: false, ...(phase === "write" ? { v: false } : {}) });
      assert.deepEqual(record.accesses.slice(2, -18), [
        ...accesses("read", source, sourceBytes.slice(0, phase === "source" ? offset : size)),
        ...(phase === "source" ? [] : accesses("read", destination, destinationBytes.slice(0, phase === "destination" ? offset : size))),
        ...(phase === "write" ? accesses("write", destination, destinationBytes.slice(0, offset)) : []),
      ]);
    }
  }
});

test("68000 word arithmetic discards failed sources and commits successful A7 reads before normal or exceptional completion", () => {
  // Base opcode, source word, initial D0, completed D0, XNZVC, exception vector (zero means ordinary completion).
  const cases = [
    [0xc0c0, 3, 0xffffffff, 0x2fffd, 0x10, 0], [0xc1c0, 3, 0xffff, 0xfffffffd, 0x18, 0],
    [0x80c0, 3, 0x10000, 0x15555, 0x10, 0], [0x81c0, 0xffff, 0x80000000, 0x80000000, 0x16, 0],
    [0x80c0, 0, 0x12345678, 0x12345678, 0x16, 5],
    [0x4180, 1, 0xffff, 0xffff, 0x1f, 6], [0x4180, 0xffff, 0, 0, 0x17, 6], [0x4180, 3, 2, 2, 0x17, 0],
  ] as const;
  for (const [base, source, initial, result, flags, vector] of cases) for (const s of [false, true]) for (const failAt of [-1, 0, 1]) {
    const before = state({ d0: initial }); before.flags.s = s; before.flags.t = false;
    const opcode = base + 0x1f, address = s ? before.ssp : before.usp; // (A7)+
    const { memory, cpu } = fixture(word(opcode), before);
    memory.load(address, word(source));
    if (vector) memory.load(vector * 4, long(0xef008000));
    memory.fail = (kind, a) => failAt >= 0 && kind === "read" && a === physical(address + failAt);
    const record = cpu.step();
    if (failAt >= 0) {
      checkBusFrame(record, memory, { operation: "read", address: address + failAt, returnPc: before.pc + 2,
        ir: opcode, code: s ? 5 : 1, status: (s ? 0x2200 : 0x0200) + 0x17 });
      assert.equal(record.after.usp, before.usp); assert.equal(record.after.d0, initial);
    } else {
      assert.equal(record.after.d0, result);
      assert.equal(record.after.usp, before.usp + (s ? 0 : 2));
      assert.equal(record.after.ssp, before.ssp + (s ? 2 : 0) - (vector ? 6 : 0));
      assert.deepEqual(record.accesses.slice(2, 4), accesses("read", address, word(source)));
      if (vector) {
        assert.deepEqual(record.exception, { source: vector === 5 ? "divide-by-zero" : "bounds-check", vector, returnPc: before.pc + 2 });
        assert.equal(record.after.pc, 0xef008000);
        const status = (s ? 0x2200 : 0x0200) + flags;
        assert.equal(memory.ram.read(physical(record.after.ssp)) * 256 + memory.ram.read(physical(record.after.ssp + 1)), status);
      } else {
        assert.equal(record.exception, undefined);
        assert.equal(record.after.pc, before.pc + 2);
      }
      assert.deepEqual(record.after.flags, { x: Boolean(flags & 16), n: Boolean(flags & 8), z: Boolean(flags & 4),
        v: Boolean(flags & 2), c: Boolean(flags & 1), t: false, s: s || vector !== 0 });
    }
  }
});

test("68000 decimal bus faults preserve paired A7 predecrements, cumulative flags, and unchanged writes", () => {
  for (const opcode of [0xcf0f, 0x8f0f, 0x4827]) for (const s of [false, true]) {
    const paired = opcode !== 0x4827, count = paired ? 3 : 2;
    for (let failAt = 0; failAt < count; failAt++) {
      const before = state(); before.flags.s = s; before.flags.t = false;
      const stack = s ? before.ssp : before.usp, destination = stack - (paired ? 4 : 2), committed = !paired || failAt > 0;
      const { memory, cpu } = fixture(word(opcode), before);
      memory.load(stack - 2, [0x99]); if (paired) memory.load(destination, [0]);
      let call = 0;
      memory.fail = (_kind, address) => (address === physical(stack - 2) || address === physical(destination)) && call++ === failAt;
      const record = cpu.step(), writing = failAt === count - 1;
      checkBusFrame(record, memory, { operation: writing ? "write" : "read", address: paired && failAt === 0 ? stack - 2 : destination,
        returnPc: before.pc + 2, ir: opcode, code: s ? 5 : 1, status: (s ? 0x2200 : 0x0200) + 0x17,
        stack: before.ssp - (s && committed ? stack - destination : 0) - 14 });
      assert.equal(record.after.usp, !s && committed ? destination : before.usp);
      assert.deepEqual(record.accesses.slice(2, -18), paired && failAt > 0
        ? [...accesses("read", stack - 2, [0x99]), ...(writing ? accesses("read", destination, [0]) : [])]
        : writing ? accesses("read", destination, [0x99]) : []);
    }
  }
});

test("68000 control stack faults retain each completed byte without committing frames or pointers in either bank", () => {
  // Calls, an odd PEA value, both frame-register aliases, and the ordinary return.
  const programs = [
    [0x61, 0, 0xff, 0xfe], [0x4e, 0xb9, 0xcd, 0, 0x20, 0], [0x48, 0x78, 0x12, 0x35],
    [0x4e, 0x50, 0xff, 0xf0], [0x4e, 0x57, 0xff, 0xf0], [0x4e, 0x58], [0x4e, 0x5f], [0x4e, 0x75],
  ];
  for (const bytes of programs) for (const s of [false, true]) for (let offset = 0; offset < 4; offset++) {
    const before = state(); before.flags.s = s; before.flags.t = false;
    const opcode = bytes[0]! * 256 + bytes[1]!, stack = s ? before.ssp : before.usp;
    const reading = [0x4e58, 0x4e5f, 0x4e75].includes(opcode), address = reading ? opcode === 0x4e58 ? before.a0 : stack : stack - 4;
    const contents = reading ? 0x89008000 : opcode === 0x4878 ? 0x1235 : opcode === 0x4e50 ? before.a0 : opcode === 0x4e57 ? stack - 4 : before.pc + bytes.length;
    const { memory, cpu } = fixture(bytes, before);
    if (reading) memory.load(address, long(contents));
    let failed = false;
    memory.fail = (kind, a) => {
      if (!failed && kind === (reading ? "read" : "write") && a === physical(address + offset)) { failed = true; return true; }
      return false; // Exception stacking may revisit the same physical bytes.
    };
    const record = cpu.step();
    checkBusFrame(record, memory, { operation: reading ? "read" : "write", address: address + offset,
      returnPc: before.pc + bytes.length, ir: opcode, code: s ? 5 : 1, status: s ? 0x2217 : 0x0217 });
    assert.equal(record.after.usp, before.usp); assert.equal(record.after.a0, before.a0);
    assert.deepEqual(record.accesses.slice(bytes.length, -18), accesses(reading ? "read" : "write", address, long(contents).slice(0, offset)));
  }
});

test("68000 Scc bus faults retain committed A7 byte updates and preserved flags before unchanged writes", () => {
  for (const mode of [3, 4]) for (const s of [false, true]) for (const writing of [false, true]) {
    const before = state(); before.flags.s = s; before.flags.t = false;
    const opcode = 0x5ec0 + mode * 8 + 7, stack = s ? before.ssp : before.usp, address = stack - (mode === 4 ? 2 : 0);
    const committed = stack + (mode === 3 ? 2 : -2), { memory, cpu } = fixture(word(opcode), before);
    memory.load(address, [0]); // SGT is false with these flags, so the successful write would be unchanged.
    let failed = false;
    memory.fail = (kind, a) => {
      if (!failed && kind === (writing ? "write" : "read") && a === physical(address)) { failed = true; return true; }
      return false;
    };
    const record = cpu.step();
    checkBusFrame(record, memory, { operation: writing ? "write" : "read", address, returnPc: before.pc + 2,
      ir: opcode, code: s ? 5 : 1, status: s ? 0x2217 : 0x0217, stack: (s ? committed : before.ssp) - 14 });
    assert.equal(record.after.usp, s ? before.usp : committed);
    assert.deepEqual(record.accesses.slice(2, -18), writing ? accesses("read", address, [0]) : []);
  }
});

test("68000 conditional branch extension faults leave counters and selected targets uncommitted", () => {
  for (let condition = 0; condition < 16; condition++) for (const decrement of [false, true]) for (const s of [false, true]) for (const offset of [0, 1]) {
    const before = state({ d7: 0x12340002 }); before.flags.s = s; before.flags.t = false;
    const opcode = (decrement ? 0x50cf : 0x6000) + condition * 256;
    const { memory, cpu } = fixture([...word(opcode), 0, 2], before);
    memory.fail = (kind, a) => kind === "read" && a === physical(before.pc + 2 + offset);
    const record = cpu.step();
    checkBusFrame(record, memory, { operation: "fetch", address: before.pc + 2 + offset, returnPc: before.pc + 2,
      ir: opcode, code: s ? 6 : 2, status: s ? 0x2217 : 0x0217 });
    assert.equal(record.after.d7, before.d7); assert.equal(record.after.usp, before.usp);
    assert.deepEqual(record.instruction?.bytes, word(opcode));
  }
});
