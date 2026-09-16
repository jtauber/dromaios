import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../src/components/cpus/8088.js";
import type { Cpu8088Flags, Cpu8088State, Cpu8088Snapshot, Cpu8088StepRecord, Cpu8088MemoryAccess } from "../../../src/components/cpus/8088.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8088WordTransformExample, create8088WordTransformExampleMemory } from "../../../src/machines/generated/8088/word-transform-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

const program = [0xc6, 6, 4, 1, 0, 0xa1, 0xfd, 0xff, 0x8b, 0x16, 0xff, 0xff,
  0xd1, 0xfa, 0xd1, 0xd8, 0x73, 4, 0xfe, 6, 4, 1, 0xf7, 0xda, 0xf7, 0xd8, 0x83, 0xda, 0,
  0x86, 0xc4, 0x86, 0xd6, 0x89, 0x16, 0, 1, 0xa3, 2, 1, 0xf6, 6, 4, 1, 1, 0x90];

function views(state: Cpu8088State): Cpu8088Snapshot {
  return { ...state, flags: { ...state.flags }, pc: (state.cs * 16 + state.ip) % 1048576,
    al: state.ax % 256, ah: Math.floor(state.ax / 256), bl: state.bx % 256, bh: Math.floor(state.bx / 256),
    cl: state.cx % 256, ch: Math.floor(state.cx / 256), dl: state.dx % 256, dh: Math.floor(state.dx / 256) };
}

function initialState(): Cpu8088Snapshot {
  return views({ halted: false, waiting: false, interruptDeferred: false, recognitionDeferred: false, trapPending: false, ax: 0x1122, bx: 0x3344, cx: 0x5566, dx: 0x7788,
    sp: 0x8000, bp: 0x9000, si: 0x10, di: 0x20, cs: 0x1234, ds: 0xffff, ss: 0x3000, es: 0x4000, ip: 0x200,
    flags: { cf: false, pf: false, af: true, zf: true, sf: false, tf: false, if: true, df: true, of: true } });
}

function expectedMemory(finished = false, input = -127): Uint8Array {
  const expected = new Uint8Array(0x100000);
  expected.set(program, 0x12540);
  expected[0xffec] = 0xde; expected[0xffff1] = 0xad;
  const encoded = (input + 2 ** 32) % 2 ** 32;
  [0xffed, 0xffee, 0xffef, 0xffff0].forEach((address, i) => { expected[address] = Math.floor(encoded / 256 ** i) % 256; });
  expected.set([0xde, 0xaa, 0xbb, 0xcc, 0xdd, 0x7f, 0xad], 0xef);
  if (finished) {
    const result = (-Math.floor(input / 2) + 2 ** 32) % 2 ** 32;
    for (let byte = 0; byte < 4; byte++) expected[0xf0 + byte] = Math.floor(result / 256 ** (3 - byte)) % 256;
    expected[0xf4] = Math.abs(input % 2);
  }
  return expected;
}

function checkMemory(ram: Ram, finished = false, input = -127): void {
  const expected = expectedMemory(finished, input);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `RAM ${address.toString(16)}`);
}

function expectedRecords(): Cpu8088StepRecord[] {
  const records: Cpu8088StepRecord[] = [];
  let state = initialState();
  const read = (address: number, value: number): Cpu8088MemoryAccess => ({ kind: "read", address, value });
  const write = (address: number, value: number): Cpu8088MemoryAccess => ({ kind: "write", address, value });
  const step = (bytes: readonly number[], changes: Partial<Cpu8088State> = {}, data: readonly Cpu8088MemoryAccess[] = []): void => {
    const before = state;
    state = views({ ...state, ip: state.ip + bytes.length, ...changes });
    records.push({ before, after: state, instruction: { address: before.pc, bytes }, outcome: "executed",
      accesses: [...bytes.map((value, i) => read(before.pc + i, value)), ...data] });
  };
  const flags = (changes: Partial<Cpu8088Flags> = {}): Cpu8088Flags => ({ cf: false, pf: false, af: false, zf: false,
    sf: false, tf: false, if: true, df: true, of: false, ...changes });
  step([0xc6, 6, 4, 1, 0], {}, [write(0xf4, 0)]);
  step([0xa1, 0xfd, 0xff], { ax: 0xff81 }, [read(0xffed, 0x81), read(0xffee, 0xff)]);
  step([0x8b, 0x16, 0xff, 0xff], { dx: 0xffff }, [read(0xffef, 0xff), read(0xffff0, 0xff)]);
  step([0xd1, 0xfa], { flags: flags({ cf: true, pf: true, sf: true }) });
  step([0xd1, 0xd8], { ax: 0xffc0 });
  step([0x73, 4]);
  step([0xfe, 6, 4, 1], { flags: flags({ cf: true }) }, [read(0xf4, 0), write(0xf4, 1)]);
  step([0xf7, 0xda], { dx: 1, flags: flags({ cf: true, af: true }) });
  step([0xf7, 0xd8], { ax: 0x40, flags: flags({ cf: true }) });
  step([0x83, 0xda, 0], { dx: 0, flags: flags({ pf: true, zf: true }) });
  step([0x86, 0xc4], { ax: 0x4000 });
  step([0x86, 0xd6]);
  step([0x89, 0x16, 0, 1], {}, [write(0xf0, 0), write(0xf1, 0)]);
  step([0xa3, 2, 1], {}, [write(0xf2, 0), write(0xf3, 0x40)]);
  step([0xf6, 6, 4, 1, 1], { flags: flags() }, [read(0xf4, 1)]);
  step([0x90]);
  return records;
}

test("8088 signed word transformation has 16 exact records, physical accesses, and guarded big-endian output", t => {
  const { cpu, ram, endAddress } = create8088WordTransformExample();
  assert.deepEqual(cpu.snapshot(), initialState());
  assert.equal(endAddress, 0x1256e);
  checkMemory(ram);
  const read = t.mock.method(ram, "read"), write = t.mock.method(ram, "write");
  const records = expectedRecords();
  assert.equal(records.length, 16);
  assert.deepEqual(runCpu(cpu, { maxSteps: 16, endAddress }), { records, stopReason: "completed" });
  const accesses = records.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "read" ? [[a.address]] : []));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "write" ? [[a.address, a.value]] : []));
  t.mock.restoreAll();
  checkMemory(ram, true);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
});

test("8088 word transformation handles both marker paths and signed/word boundaries", () => {
  for (const input of [-2147483648, -131072, -65536, -512, -1, 0, 1, 512, 65536, 2147483647]) {
    const { cpu, ram, endAddress } = create8088WordTransformExample();
    const memory = expectedMemory(false, input);
    for (const address of [0xffed, 0xffee, 0xffef, 0xffff0]) ram.write(address, memory[address]!);
    const result = runCpu(cpu, { maxSteps: 16, endAddress });
    assert.equal(result.stopReason, "completed");
    assert.equal(result.records.length, input % 2 === 0 ? 15 : 16);
    assert.equal(cpu.snapshot().flags.zf, input % 2 === 0);
    assert.equal(result.records[5]!.after.ip, input % 2 === 0 ? 0x216 : 0x212);
    checkMemory(ram, true, input);
  }
});

test("8088 word transformation resumes across carry propagation, retains records, and restarts with independent memory", () => {
  const { cpu, ram, endAddress } = create8088WordTransformExample();
  const expected = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 4, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { records: expected.slice(0, 4), stopReason: "step-limit" });
  const restored = new Cpu8088(ram, cpu.snapshot());
  assert.deepEqual(runCpu(restored, { maxSteps: 12, endAddress }), { records: expected.slice(4), stopReason: "completed" });
  const before = restored.snapshot();
  assert.deepEqual(restored.reset(), { before, after: views({ ...before, cs: 0xffff, ip: 0, ds: 0, ss: 0, es: 0,
    flags: { cf: false, pf: false, af: false, zf: false, sf: false, tf: false, if: false, df: false, of: false } }), accesses: [] });
  checkMemory(ram, true);
  const fresh = create8088WordTransformExample();
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  checkMemory(fresh.ram);
  const memoryOnly = create8088WordTransformExampleMemory();
  checkMemory(memoryOnly);
  ram.write(0xf3, 0xff); memoryOnly.write(0x12540, 0);
  assert.deepEqual(first, saved);
  assert.equal(fresh.ram.read(0x12540), 0xc6);
  assert.equal(fresh.ram.read(0xf3), 0xdd);
});

test("8088 word transformation reads edited input and bounds an edited loop", () => {
  const changed = create8088WordTransformExample();
  changed.cpu.step();
  changed.ram.write(0xffed, 0); changed.ram.write(0xffee, 0xfe); // Change -127 to -512 after marker initialization.
  assert.equal(runCpu(changed.cpu, { maxSteps: 15, endAddress: changed.endAddress }).stopReason, "completed");
  checkMemory(changed.ram, true, -512);
  const loop = create8088WordTransformExample();
  loop.ram.write(0x12550, 0xeb); loop.ram.write(0x12551, 0xfe); // Replace JNC with JMP to itself.
  const result = runCpu(loop.cpu, { maxSteps: 25, endAddress: loop.endAddress });
  assert.equal(result.stopReason, "step-limit");
  assert.equal(result.records.length, 25);
  assert.equal(loop.cpu.snapshot().ip, 0x210);
});
