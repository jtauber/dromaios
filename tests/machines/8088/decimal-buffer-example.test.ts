import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../src/components/cpus/generated/8088-cpu.js";
import type { Cpu8088State, Cpu8088Flags, Cpu8088Snapshot, Cpu8088StepRecord, Cpu8088MemoryAccess } from "../../../src/components/cpus/generated/8088-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8088DecimalBufferExample, create8088DecimalBufferExampleMemory } from "../../../src/machines/generated/8088/decimal-buffer-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

const main = [0x9c, 0xfc, 0xc4, 0x3e, 4, 0, 0xc5, 0x36, 0, 0, 0xb9, 3, 0, 0xf3, 0xa5,
  0x26, 0xa1, 0, 1, 0x9a, 0, 2, 0, 0x50, 0x9d, 0xf4];
const routine = [0xbb, 0x0a, 0, 0xb9, 5, 0, 0xbf, 0x14, 1, 0xfd, 0x31, 0xd2, 0xf7, 0xf3, 0x92,
  4, 0x30, 0xaa, 0x92, 0xe2, 0xf5, 0xcb];
const callerFlags: Cpu8088Flags = { cf: false, pf: false, af: true, zf: false, sf: false,
  tf: false, if: true, df: true, of: true };
function views(state: Cpu8088State): Cpu8088Snapshot {
  return { ...state, flags: { ...state.flags }, pc: (state.cs * 16 + state.ip) % 1048576,
    al: state.ax % 256, ah: Math.floor(state.ax / 256), bl: state.bx % 256, bh: Math.floor(state.bx / 256),
    cl: state.cx % 256, ch: Math.floor(state.cx / 256), dl: state.dx % 256, dh: Math.floor(state.dx / 256) };
}
function initialState(): Cpu8088Snapshot {
  return views({ ax: 0xa55a, bx: 0x3344, cx: 0x5566, dx: 0x7788, sp: 2, bp: 0x9000, si: 0x10, di: 0x20,
    cs: 0x1234, ds: 0x2000, ss: 0x6000, es: 0x4000, ip: 0x100, halted: false, waiting: false, interruptDeferred: false, recognitionDeferred: false, trapPending: false, flags: { ...callerFlags } });
}
function expectedMemory(finished = false, input = 12345): Uint8Array {
  const expected = new Uint8Array(0x100000);
  expected.set(main, 0x12440); expected.set(routine, 0x50200);
  expected.set([0xfe, 0xff, 0, 0x30, 0, 1, 0, 0x40], 0x20000);
  expected.set([0xde, input % 256, Math.floor(input / 256)], 0x3fffd);
  expected.set([0xff, 0xff, 0, 0, 0xad], 0x30000);
  expected.set([0xde, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0xad], 0x400ff);
  expected.set([0xde, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xad], 0x4010f);
  expected.set([0x77, 0x88], 0x60000); expected.set([0xde, 0xaa, 0xbb, 0xcc, 0xdd, 0xad], 0x6fffb);
  if (finished) {
    expected.set([input % 256, Math.floor(input / 256), 0xff, 0xff, 0, 0], 0x40100);
    expected.set([...String(input).padStart(5, "0")].map(digit => digit.charCodeAt(0)), 0x40110);
    expected.set([0x12, 0xfe], 0x60000); expected.set([0x18, 1, 0x34, 0x12], 0x6fffc);
  }
  return expected;
}
function checkMemory(ram: Ram, finished = false, input = 12345): void {
  for (const [address, value] of expectedMemory(finished, input).entries()) assert.equal(ram.read(address), value, `RAM ${address.toString(16)}`);
}
function expectedRecords(): Cpu8088StepRecord[] {
  const records: Cpu8088StepRecord[] = [];
  let state = initialState();
  const read = (address: number, value: number): Cpu8088MemoryAccess => ({ kind: "read", address, value });
  const write = (address: number, value: number): Cpu8088MemoryAccess => ({ kind: "write", address, value });
  const step = (bytes: readonly number[], changes: Partial<Cpu8088State> = {}, data: readonly Cpu8088MemoryAccess[] = []): void => {
    const before = state;
    state = views({ ...state, ip: state.ip + bytes.length, ...changes });
    records.push({ before, after: state, instruction: { address: before.pc, bytes }, outcome: state.halted ? "halted" : "executed",
      accesses: [...bytes.map((value, i) => read(before.pc + i, value)), ...data] });
  };
  step([0x9c], { sp: 0 }, [write(0x60000, 0x12), write(0x60001, 0xfe)]);
  step([0xfc], { flags: { ...callerFlags, df: false } });
  step([0xc4, 0x3e, 4, 0], { di: 0x100 }, [read(0x20004, 0), read(0x20005, 1), read(0x20006, 0), read(0x20007, 0x40)]);
  step([0xc5, 0x36, 0, 0], { si: 0xfffe, ds: 0x3000 }, [read(0x20000, 0xfe), read(0x20001, 0xff), read(0x20002, 0), read(0x20003, 0x30)]);
  step([0xb9, 3, 0], { cx: 3 });
  step([0xf3, 0xa5], { cx: 2, si: 0, di: 0x102, ip: 0x10d }, [read(0x3fffe, 0x39), read(0x3ffff, 0x30), write(0x40100, 0x39), write(0x40101, 0x30)]);
  step([0xf3, 0xa5], { cx: 1, si: 2, di: 0x104, ip: 0x10d }, [read(0x30000, 0xff), read(0x30001, 0xff), write(0x40102, 0xff), write(0x40103, 0xff)]);
  step([0xf3, 0xa5], { cx: 0, si: 4, di: 0x106 }, [read(0x30002, 0), read(0x30003, 0), write(0x40104, 0), write(0x40105, 0)]);
  step([0x26, 0xa1, 0, 1], { ax: 12345 }, [read(0x40100, 0x39), read(0x40101, 0x30)]);
  step([0x9a, 0, 2, 0, 0x50], { cs: 0x5000, ip: 0x200, sp: 0xfffc },
    [write(0x6fffe, 0x34), write(0x6ffff, 0x12), write(0x6fffc, 0x18), write(0x6fffd, 1)]);
  step([0xbb, 10, 0], { bx: 10 }); step([0xb9, 5, 0], { cx: 5 }); step([0xbf, 0x14, 1], { di: 0x114 });
  step([0xfd], { flags: { ...state.flags, df: true } });
  for (const [quotient, digit] of [[1234, 5], [123, 4], [12, 3], [1, 2], [0, 1]]) {
    const zeroFlags = { ...callerFlags, cf: false, pf: true, af: false, zf: true, sf: false, of: false };
    step([0x31, 0xd2], { dx: 0, flags: zeroFlags });
    step([0xf7, 0xf3], { ax: quotient!, dx: digit! });
    step([0x92], { ax: digit!, dx: quotient! });
    const ascii = 0x30 + digit!;
    step([4, 0x30], { ax: ascii, flags: { ...zeroFlags, zf: false, pf: [0x33, 0x35].includes(ascii) } });
    step([0xaa], { di: state.di - 1 }, [write(0x40000 + state.di, ascii)]);
    step([0x92], { ax: quotient!, dx: ascii });
    step([0xe2, 0xf5], { cx: state.cx - 1, ip: state.cx > 1 ? 0x20a : 0x215 });
  }
  step([0xcb], { cs: 0x1234, ip: 0x118, sp: 0 }, [read(0x6fffc, 0x18), read(0x6fffd, 1), read(0x6fffe, 0x34), read(0x6ffff, 0x12)]);
  step([0x9d], { sp: 2, flags: { ...callerFlags } }, [read(0x60000, 0x12), read(0x60001, 0xfe)]);
  step([0xf4], { halted: true });
  return records;
}

test("8088 decimal buffer copies wrapped words and formats through a far call in 52 exact records", t => {
  const { cpu, ram, endAddress } = create8088DecimalBufferExample();
  assert.deepEqual(cpu.snapshot(), initialState()); assert.equal(endAddress, 0x1245a); checkMemory(ram);
  const reads = t.mock.method(ram, "read"), writes = t.mock.method(ram, "write"), records = expectedRecords();
  assert.equal(records.length, 52);
  assert.deepEqual(runCpu(cpu, { maxSteps: 52, endAddress }), { records, stopReason: "halted" });
  const accesses = records.flatMap(record => record.accesses);
  assert.deepEqual(reads.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "read" ? [[a.address]] : []));
  assert.deepEqual(writes.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "write" ? [[a.address, a.value]] : []));
  t.mock.restoreAll(); checkMemory(ram, true);
  assert.deepEqual(cpu.snapshot(), views({ ...initialState(), ax: 0, bx: 10, cx: 0, dx: 0x31, si: 4, di: 0x10f,
    ds: 0x3000, ip: 0x11a, halted: true }));
});

test("8088 decimal buffer resumes within REP and the far frame, retaining detached records and reset state", () => {
  const expected = expectedRecords();
  for (const steps of [6, 10, 17, 50]) {
    const { cpu, ram, endAddress } = create8088DecimalBufferExample();
    const first = runCpu(cpu, { maxSteps: steps, endAddress }), retained = structuredClone(first);
    assert.deepEqual(first, { records: expected.slice(0, steps), stopReason: "step-limit" });
    const restored = new Cpu8088(ram, cpu.snapshot());
    assert.deepEqual(runCpu(restored, { maxSteps: 52 - steps, endAddress }), { records: expected.slice(steps), stopReason: "halted" });
    checkMemory(ram, true);
    assert.equal(restored.step().instruction, null);
    const before = restored.snapshot();
    assert.deepEqual(restored.reset(), { before, after: views({ ...before, cs: 0xffff, ip: 0, ds: 0, ss: 0, es: 0, halted: false, waiting: false, interruptDeferred: false, recognitionDeferred: false, trapPending: false,
      flags: { cf: false, pf: false, af: false, zf: false, sf: false, tf: false, if: false, df: false, of: false } }), accesses: [] });
    checkMemory(ram, true); assert.deepEqual(first, retained);
  }
  const fresh = create8088DecimalBufferExample(); checkMemory(fresh.ram);
  const memoryOnly = create8088DecimalBufferExampleMemory(); checkMemory(memoryOnly);
  memoryOnly.write(0x12440, 0); assert.equal(fresh.ram.read(0x12440), 0x9c);
});

test("8088 decimal buffer formats unsigned boundaries with leading zeroes and honors edited input", () => {
  for (const input of [0, 1, 9, 10, 99, 100, 9999, 32768, 65535]) {
    const { cpu, ram, endAddress } = create8088DecimalBufferExample();
    assert.equal(runCpu(cpu, { maxSteps: 5 }).stopReason, "step-limit");
    ram.write(0x3fffe, input % 256); ram.write(0x3ffff, Math.floor(input / 256));
    assert.equal(runCpu(cpu, { maxSteps: 47, endAddress }).stopReason, "halted");
    checkMemory(ram, true, input); assert.deepEqual(cpu.snapshot().flags, callerFlags);
  }
});
