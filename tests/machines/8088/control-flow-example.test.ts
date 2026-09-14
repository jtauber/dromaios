import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../src/components/cpus/8088.js";
import type { Cpu8088Flags, Cpu8088Snapshot, Cpu8088State, Cpu8088StepRecord, Cpu8088MemoryAccess } from "../../../src/components/cpus/8088.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8088ControlFlowExample, create8088ControlFlowExampleMemory } from "../../../src/machines/generated/8088/control-flow-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

const main = [0xb8, 3, 0, 0xe8, 0x1a, 0, 5, 0xff, 0xff, 0x3d, 0, 0,
  0x75, 0xf5, 0xa1, 0x80, 0, 0xe9, 3, 0, 0xb8, 0xff, 0xff];
const subroutine = [0x50, 0xa1, 0x80, 0, 0xe8, 9, 0, 0xa3, 0x80, 0, 0x58, 0xc3];
const helper = [5, 5, 0, 0xc3];

function views(state: Cpu8088State): Cpu8088Snapshot {
  return { ...state, flags: { ...state.flags }, pc: state.cs * 16 + state.ip,
    al: state.ax % 256, ah: Math.floor(state.ax / 256), bl: state.bx % 256, bh: Math.floor(state.bx / 256),
    cl: state.cx % 256, ch: Math.floor(state.cx / 256), dl: state.dx % 256, dh: Math.floor(state.dx / 256) };
}

function initialState(): Cpu8088Snapshot {
  return views({ ax: 0x1122, bx: 0x3344, cx: 0x5566, dx: 0x7788,
    sp: 0x8000, bp: 0x9000, si: 0x10, di: 0x20, cs: 0x1234, ds: 0x2000, ss: 0x3000, es: 0x4000, ip: 0x200,
    flags: { cf: true, pf: false, af: true, zf: true, sf: true, tf: false, if: true, df: true, of: true } });
}

function checkMemory(ram: Ram, finished = false): void {
  const expected = new Uint8Array(0x100000);
  expected.set(main, 0x12540);
  expected.set(subroutine, 0x12560);
  expected.set(helper, 0x12570);
  expected.set([0xde, finished ? 0x0f : 0, 0, 0xad], 0x2007f);
  if (finished) expected.set([0x27, 2, 1, 0, 6, 2], 0x37ffa);
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `RAM ${address.toString(16)}`);
}

function expectedRecords(): Cpu8088StepRecord[] {
  const records: Cpu8088StepRecord[] = [];
  let state = initialState();
  const read = (address: number, value: number): Cpu8088MemoryAccess => ({ kind: "read", address, value });
  const write = (address: number, value: number): Cpu8088MemoryAccess => ({ kind: "write", address, value });
  const step = (bytes: readonly number[], changes: Partial<Cpu8088State>, data: readonly Cpu8088MemoryAccess[] = []): void => {
    const before = state;
    state = views({ ...state, ...changes });
    records.push({ before, after: state, instruction: { address: before.pc, bytes }, outcome: "executed",
      accesses: [...bytes.map((value, offset) => read(before.pc + offset, value)), ...data] });
  };
  const arithmeticFlags: Cpu8088Flags = { cf: false, pf: true, af: false, zf: false, sf: false,
    tf: false, if: true, df: true, of: false };
  step([0xb8, 3, 0], { ax: 3, ip: 0x203 });
  for (const [counter, oldSum, sum] of [[3, 0, 5], [2, 5, 10], [1, 10, 15]] as const) {
    step([0xe8, 0x1a, 0], { ip: 0x220, sp: 0x7ffe }, [write(0x37ffe, 6), write(0x37fff, 2)]);
    step([0x50], { ip: 0x221, sp: 0x7ffc }, [write(0x37ffc, counter), write(0x37ffd, 0)]);
    step([0xa1, 0x80, 0], { ip: 0x224, ax: oldSum }, [read(0x20080, oldSum), read(0x20081, 0)]);
    step([0xe8, 9, 0], { ip: 0x230, sp: 0x7ffa }, [write(0x37ffa, 0x27), write(0x37ffb, 2)]);
    step([5, 5, 0], { ip: 0x233, ax: sum, flags: arithmeticFlags });
    step([0xc3], { ip: 0x227, sp: 0x7ffc }, [read(0x37ffa, 0x27), read(0x37ffb, 2)]);
    step([0xa3, 0x80, 0], { ip: 0x22a }, [write(0x20080, sum), write(0x20081, 0)]);
    step([0x58], { ip: 0x22b, ax: counter, sp: 0x7ffe }, [read(0x37ffc, counter), read(0x37ffd, 0)]);
    step([0xc3], { ip: 0x206, sp: 0x8000 }, [read(0x37ffe, 6), read(0x37fff, 2)]);
    step([5, 0xff, 0xff], { ip: 0x209, ax: counter - 1,
      flags: { ...arithmeticFlags, cf: true, af: true, pf: counter === 1, zf: counter === 1 } });
    step([0x3d, 0, 0], { ip: 0x20c,
      flags: { ...arithmeticFlags, pf: counter === 1, zf: counter === 1 } });
    step([0x75, 0xf5], { ip: counter === 1 ? 0x20e : 0x203 });
  }
  step([0xa1, 0x80, 0], { ip: 0x211, ax: 15 }, [read(0x20080, 15), read(0x20081, 0)]);
  step([0xe9, 3, 0], { ip: 0x217 });
  return records;
}

test("8088 control-flow factories own independent state and complete memory images", () => {
  const memory = create8088ControlFlowExampleMemory();
  const first = create8088ControlFlowExample();
  const second = create8088ControlFlowExample();
  for (const ram of [memory, first.ram, second.ram]) checkMemory(ram);
  for (const machine of [first, second]) {
    assert.equal(machine.endAddress, 0x12557);
    assert.deepEqual(machine.cpu.snapshot(), initialState());
  }
  memory.write(0x12540, 0);
  first.ram.write(0x20080, 0xff);
  first.cpu.step();
  assert.notStrictEqual(first.ram, second.ram);
  assert.notStrictEqual(first.cpu, second.cpu);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  checkMemory(second.ram);
});

test("8088 nested subroutines preserve a counter and add fifteen in RAM with exact records and physical completion", t => {
  const { cpu, ram, endAddress } = create8088ControlFlowExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const records = expectedRecords();
  assert.equal(records.length, 39);
  assert.deepEqual(runCpu(cpu, { maxSteps: 39, endAddress }), { records, stopReason: "completed" });
  const accesses = records.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "read").map(a => [a.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "write").map(a => [a.address, a.value]));
  assert.deepEqual(cpu.snapshot(), records.at(-1)?.after);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  const alias = new Cpu8088(ram, { ...cpu.snapshot(), cs: 0x1244, ip: 0x117 });
  assert.deepEqual(runCpu(alias, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  t.mock.restoreAll();
  checkMemory(ram, true);
  assert.equal(cpu.step().outcome, "unsupported");
});

test("8088 control flow resumes from a snapshot inside nested calls and preserves stack/result RAM across reset", () => {
  const { cpu, ram, endAddress } = create8088ControlFlowExample();
  const expected = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 5, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { records: expected.slice(0, 5), stopReason: "step-limit" });
  assert.equal(cpu.snapshot().ip, 0x230);
  assert.equal(cpu.snapshot().sp, 0x7ffa);
  const resumed = new Cpu8088(ram, cpu.snapshot());
  assert.deepEqual(runCpu(resumed, { maxSteps: 34, endAddress }), { records: expected.slice(5), stopReason: "completed" });
  const before = resumed.snapshot();
  const after = views({ ...before, cs: 0xffff, ip: 0, ds: 0, ss: 0, es: 0,
    flags: { cf: false, pf: false, af: false, zf: false, sf: false, tf: false, if: false, df: false, of: false } });
  assert.deepEqual(resumed.reset(), { before, after, accesses: [] });
  checkMemory(ram, true);
  const fresh = create8088ControlFlowExample();
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  checkMemory(fresh.ram);
  ram.write(0x37ffa, 0xff);
  Reflect.set(first.records[0]!.after.flags, "zf", false);
  assert.deepEqual(first.records.slice(1), saved.records.slice(1));
  assert.deepEqual(resumed.snapshot(), after);
});

test("8088 control flow reads edited return words and branch displacements while bounded running limits loops", () => {
  const returned = create8088ControlFlowExample();
  runCpu(returned.cpu, { maxSteps: 6, endAddress: returned.endAddress });
  returned.ram.write(0x37ffa, 0x17);
  returned.ram.write(0x37ffb, 2);
  assert.equal(runCpu(returned.cpu, { maxSteps: 1, endAddress: returned.endAddress }).stopReason, "completed");
  assert.equal(returned.cpu.snapshot().ip, 0x217);
  assert.equal(returned.cpu.snapshot().sp, 0x7ffc);
  const loop = create8088ControlFlowExample();
  loop.ram.write(0x1254d, 0xfe);
  const result = runCpu(loop.cpu, { maxSteps: 20, endAddress: loop.endAddress });
  assert.equal(result.stopReason, "step-limit");
  assert.equal(loop.cpu.snapshot().ip, 0x20c);
  assert.equal(loop.ram.read(0x20080), 5);
});
