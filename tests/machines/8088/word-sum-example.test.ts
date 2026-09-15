import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../src/components/cpus/8088.js";
import type { Cpu8088Flags, Cpu8088Snapshot, Cpu8088State, Cpu8088StepRecord, Cpu8088MemoryAccess } from "../../../src/components/cpus/8088.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8088WordSumExample, create8088WordSumExampleMemory } from "../../../src/machines/generated/8088/word-sum-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

const main = [0xb8, 0, 0, 0xba, 0, 0, 0xb9, 4, 0, 0xbe, 0, 0, 0xbb, 0, 1, 0xe8, 0x2e, 0,
  0x83, 0xc6, 2, 0x49, 0x75, 0xf7, 0x89, 6, 0, 2, 0x89, 0x16, 2, 2, 0xa9, 1, 0, 0x74, 5, 0x80, 0x0e, 4, 2, 0x80];
const subroutine = [0x55, 0x89, 0xe5, 0x53, 0x8b, 0x18, 0x81, 0xe3, 0xff, 0xf0, 0x85, 0xdb, 0x74, 5,
  1, 0xd8, 0x83, 0xd2, 0, 0x8b, 0x5e, 0xfe, 0x89, 0xec, 0x5d, 0xc3];

function views(state: Cpu8088State): Cpu8088Snapshot {
  return { ...state, flags: { ...state.flags }, pc: state.cs * 16 + state.ip,
    al: state.ax % 256, ah: Math.floor(state.ax / 256), bl: state.bx % 256, bh: Math.floor(state.bx / 256),
    cl: state.cx % 256, ch: Math.floor(state.cx / 256), dl: state.dx % 256, dh: Math.floor(state.dx / 256) };
}
function initialState(): Cpu8088Snapshot {
  return views({ halted: false, interruptDeferred: false, segmentDeferred: false, trapPending: false, ax: 0x1122, bx: 0x3344, cx: 0x5566, dx: 0x7788,
    sp: 0x8000, bp: 0x9000, si: 0x10, di: 0x20, cs: 0x1234, ds: 0x2000, ss: 0x3000, es: 0x4000, ip: 0x200,
    flags: { cf: true, pf: false, af: true, zf: true, sf: true, tf: false, if: true, df: true, of: true } });
}
function checkMemory(ram: Ram, finished = false): void {
  const expected = new Uint8Array(0x100000);
  expected.set(main, 0x12540);
  expected.set(subroutine, 0x12580);
  expected.set([0xde, 0xff, 0xff, 1, 0x80, 0xff, 0, 0, 0, 0xad], 0x200ff);
  expected.set(finished ? [0xde, 0xff, 0x71, 1, 0, 0x81, 0xad] : [0xde, 0, 0, 0, 0, 1, 0xad], 0x201ff);
  if (finished) expected.set([0, 1, 0, 0x90, 0x12, 2], 0x37ffa);
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
  const flags = (changes: Partial<Cpu8088Flags> = {}): Cpu8088Flags => ({ cf: false, pf: true, af: false, zf: false,
    sf: false, tf: false, if: true, df: true, of: false, ...changes });
  step([0xb8, 0, 0], { ax: 0, ip: 0x203 });
  step([0xba, 0, 0], { dx: 0, ip: 0x206 });
  step([0xb9, 4, 0], { cx: 4, ip: 0x209 });
  step([0xbe, 0, 0], { si: 0, ip: 0x20c });
  step([0xbb, 0, 1], { bx: 0x100, ip: 0x20f });
  const iterations = [
    { input: 0xffff, masked: 0xf0ff, low: 0xf0ff, high: 0, sign: true, addFlags: flags({ sf: true }), adcFlags: flags({ zf: true }) },
    { input: 0x8001, masked: 0x8001, low: 0x7100, high: 1, sign: true, addFlags: flags({ cf: true, af: true, of: true }), adcFlags: flags({ pf: false }) },
    { input: 0x00ff, masked: 0x00ff, low: 0x71ff, high: 1, sign: false, addFlags: flags(), adcFlags: flags({ pf: false }) },
    { input: 0, masked: 0, low: 0x71ff, high: 1, sign: false, addFlags: flags(), adcFlags: flags() },
  ];
  for (const [index, row] of iterations.entries()) {
    step([0xe8, 0x2e, 0], { ip: 0x240, sp: 0x7ffe }, [write(0x37ffe, 0x12), write(0x37fff, 2)]);
    step([0x55], { ip: 0x241, sp: 0x7ffc }, [write(0x37ffc, 0), write(0x37ffd, 0x90)]);
    step([0x89, 0xe5], { ip: 0x243, bp: 0x7ffc });
    step([0x53], { ip: 0x244, sp: 0x7ffa }, [write(0x37ffa, 0), write(0x37ffb, 1)]);
    step([0x8b, 0x18], { ip: 0x246, bx: row.input }, [read(0x20100 + index * 2, row.input % 256), read(0x20101 + index * 2, Math.floor(row.input / 256))]);
    const logic = flags({ sf: row.sign, zf: row.masked === 0, pf: index !== 1 });
    step([0x81, 0xe3, 0xff, 0xf0], { ip: 0x24a, bx: row.masked, flags: logic });
    step([0x85, 0xdb], { ip: 0x24c });
    step([0x74, 5], { ip: row.masked === 0 ? 0x253 : 0x24e });
    if (row.masked !== 0) {
      step([1, 0xd8], { ip: 0x250, ax: row.low, flags: row.addFlags });
      step([0x83, 0xd2, 0], { ip: 0x253, dx: row.high, flags: row.adcFlags });
    }
    step([0x8b, 0x5e, 0xfe], { ip: 0x256, bx: 0x100 }, [read(0x37ffa, 0), read(0x37ffb, 1)]);
    step([0x89, 0xec], { ip: 0x258, sp: 0x7ffc });
    step([0x5d], { ip: 0x259, sp: 0x7ffe, bp: 0x9000 }, [read(0x37ffc, 0), read(0x37ffd, 0x90)]);
    step([0xc3], { ip: 0x212, sp: 0x8000 }, [read(0x37ffe, 0x12), read(0x37fff, 2)]);
    step([0x83, 0xc6, 2], { ip: 0x215, si: (index + 1) * 2, flags: flags({ pf: index === 2 }) });
    step([0x49], { ip: 0x216, cx: 3 - index, flags: flags({ pf: index === 0 || index === 3, zf: index === 3 }) });
    step([0x75, 0xf7], { ip: index === 3 ? 0x218 : 0x20f });
  }
  step([0x89, 6, 0, 2], { ip: 0x21c }, [write(0x20200, 0xff), write(0x20201, 0x71)]);
  step([0x89, 0x16, 2, 2], { ip: 0x220 }, [write(0x20202, 1), write(0x20203, 0)]);
  step([0xa9, 1, 0], { ip: 0x223, flags: flags({ pf: false }) });
  step([0x74, 5], { ip: 0x225 });
  step([0x80, 0x0e, 4, 2, 0x80], { ip: 0x22a, flags: flags({ sf: true }) }, [read(0x20204, 1), write(0x20204, 0x81)]);
  return records;
}

test("8088 word-sum factories isolate CPU state and complete memory images", () => {
  const first = create8088WordSumExample();
  const second = create8088WordSumExample();
  const memory = create8088WordSumExampleMemory();
  for (const ram of [first.ram, second.ram, memory]) checkMemory(ram);
  assert.equal(first.endAddress, 0x1256a);
  assert.deepEqual(first.cpu.snapshot(), initialState());
  memory.write(0x12540, 0);
  first.ram.write(0x20100, 0);
  first.cpu.step();
  assert.deepEqual(second.cpu.snapshot(), initialState());
  checkMemory(second.ram);
});

test("8088 masked word sum has 76 exact instruction records, real memory accesses, and a 32-bit result", t => {
  const { cpu, ram, endAddress } = create8088WordSumExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const records = expectedRecords();
  assert.equal(records.length, 76);
  assert.deepEqual(runCpu(cpu, { maxSteps: 76, endAddress }), { records, stopReason: "completed" });
  const accesses = records.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "read" ? [[a.address]] : []));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "write" ? [[a.address, a.value]] : []));
  assert.deepEqual(cpu.snapshot(), records.at(-1)!.after);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  t.mock.restoreAll();
  checkMemory(ram, true);
});

test("8088 masked word sum resumes inside a BP frame and preserves its result across reset", () => {
  const { cpu, ram, endAddress } = create8088WordSumExample();
  const records = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 10, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { records: records.slice(0, 10), stopReason: "step-limit" });
  assert.equal(cpu.snapshot().bp, 0x7ffc);
  assert.equal(cpu.snapshot().bx, 0xffff);
  const resumed = new Cpu8088(ram, cpu.snapshot());
  assert.deepEqual(runCpu(resumed, { maxSteps: 66, endAddress }), { records: records.slice(10), stopReason: "completed" });
  const before = resumed.snapshot();
  const after = views({ ...before, cs: 0xffff, ip: 0, ds: 0, ss: 0, es: 0,
    flags: { cf: false, pf: false, af: false, zf: false, sf: false, tf: false, if: false, df: false, of: false } });
  assert.deepEqual(resumed.reset(), { before, after, accesses: [] });
  checkMemory(ram, true);
  const fresh = create8088WordSumExample();
  checkMemory(fresh.ram);
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  ram.write(0x37ffa, 0xff);
  Reflect.set(first.records[0]!.after.flags, "zf", false);
  assert.deepEqual(first.records.slice(1), saved.records.slice(1));
  assert.deepEqual(resumed.snapshot(), after);
});

test("8088 word sum observes changed source RAM and bounds an edited loop", () => {
  const changed = create8088WordSumExample();
  runCpu(changed.cpu, { maxSteps: 9, endAddress: changed.endAddress });
  changed.ram.write(0x20100, 0); changed.ram.write(0x20101, 0);
  const result = runCpu(changed.cpu, { maxSteps: 100, endAddress: changed.endAddress });
  assert.equal(result.stopReason, "completed");
  assert.equal(changed.cpu.snapshot().ax, 0x8100);
  assert.equal(changed.cpu.snapshot().dx, 0);
  assert.equal(changed.ram.read(0x20204), 1); // Even result skips the marker write.
  const loop = create8088WordSumExample();
  loop.ram.write(0x12557, 0xfe); // JNE to itself after the first array element.
  assert.equal(runCpu(loop.cpu, { maxSteps: 100, endAddress: loop.endAddress }).stopReason, "step-limit");
  assert.equal(loop.cpu.snapshot().ip, 0x216);
  assert.equal(loop.cpu.snapshot().ax, 0xf0ff);
});
