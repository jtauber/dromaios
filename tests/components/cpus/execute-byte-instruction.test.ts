import assert from "node:assert/strict";
import { test } from "node:test";
import { readWordBE, readWordLE } from "../../../src/components/cpus/binary.js";
import { executeByteInstruction, programCounter } from "../../../src/components/cpus/execute-byte-instruction.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

test("an unsupported opcode records one read and leaves PC unchanged, including at FFFF", () => {
  const ram = new ObservedRam();
  ram.write(0xffff, 0x42);
  ram.accesses.length = 0;
  const state = { pc: 0xffff };
  const result = executeByteInstruction(state, ram, {}, readWordLE);
  assert.deepEqual(result, {
    instruction: { address: 0xffff, bytes: [0x42] },
    accesses: [{ kind: "read", address: 0xffff, value: 0x42 }],
    executed: false,
  });
  assert.equal(state.pc, 0xffff);
  assert.deepEqual(ram.accesses, result.accesses);
});

test("opcode lookup binds per-step capabilities after one fetch and still rejects unknown encodings", () => {
  const ram = new ObservedRam();
  ram.write(0xffff, 0x42); ram.write(0, 0x34);
  const state = { pc: 0xffff };
  const outputs: number[] = [];
  let lookups = 0;
  const lookup = (opcode: number) => {
    lookups++;
    assert.equal(state.pc, 0xffff);
    assert.deepEqual(ram.accesses, [{ kind: "read", address: 0xffff, value: opcode }]);
    if (opcode === 0x42) return ({ fetchByte }: { fetchByte: () => number }) => { outputs.push(fetchByte()); };
  };
  ram.accesses.length = 0;
  assert.equal(executeByteInstruction(state, ram, lookup, readWordLE).executed, true);
  assert.equal(lookups, 1);
  assert.deepEqual(outputs, [0x34]);
  assert.equal(state.pc, 1);
  ram.write(0xffff, 0x43);
  state.pc = 0xffff;
  ram.accesses.length = 0;
  assert.equal(executeByteInstruction(state, ram, lookup, readWordLE).executed, false);
  assert.equal(lookups, 2);
  assert.equal(state.pc, 0xffff);
  assert.deepEqual(outputs, [0x34]);
});

for (const [name, readWord, expectedWord] of [
  ["little-endian", readWordLE, 0x1234], ["big-endian", readWordBE, 0x3412],
] as const) {
  test(`${name} operands wrap at FFFF and retain fetch order in the record`, () => {
    const ram = new ObservedRam();
    ram.write(0xfffe, 0x42);
    ram.write(0xffff, 0x34);
    ram.write(0, 0x12);
    ram.accesses.length = 0;
    const state = { pc: 0xfffe };
    const result = executeByteInstruction(state, ram, {
      0x42: ({ fetchWord }) => {
        assert.equal(state.pc, 0xffff);
        assert.equal(fetchWord(), expectedWord);
      },
    }, readWord);
    assert.equal(result.executed, true);
    assert.equal(state.pc, 1);
    assert.deepEqual(result.instruction, { address: 0xfffe, bytes: [0x42, 0x34, 0x12] });
    assert.deepEqual(result.accesses, [
      { kind: "read", address: 0xfffe, value: 0x42 },
      { kind: "read", address: 0xffff, value: 0x34 },
      { kind: "read", address: 0, value: 0x12 },
    ]);
    assert.deepEqual(ram.accesses, result.accesses);
  });
}

test("operand fetches use live PC and RAM, interleaved data accesses stay out of instruction bytes", () => {
  const ram = new ObservedRam();
  ram.write(0xffff, 0x42);
  ram.write(0, 0x34);
  ram.accesses.length = 0;
  const state = { pc: 0xffff };
  const result = executeByteInstruction(state, ram, {
    0x42: ({ fetchByte, readByte, writeByte }) => {
      assert.equal(state.pc, 0);
      assert.equal(fetchByte(), 0x34);
      writeByte(1, 0x56);
      assert.equal(readByte(1), 0x56);
      assert.equal(state.pc, 1);
      assert.equal(fetchByte(), 0x56);
      state.pc = 0x1234;
      writeByte(0x1234, 0x78);
      assert.equal(fetchByte(), 0x78);
      state.pc = 0x8000;
    },
  }, readWordLE);
  assert.equal(state.pc, 0x8000);
  assert.deepEqual(result.instruction, { address: 0xffff, bytes: [0x42, 0x34, 0x56, 0x78] });
  assert.deepEqual(result.accesses, [
    { kind: "read", address: 0xffff, value: 0x42 },
    { kind: "read", address: 0, value: 0x34 },
    { kind: "write", address: 1, value: 0x56 },
    { kind: "read", address: 1, value: 0x56 },
    { kind: "read", address: 1, value: 0x56 },
    { kind: "write", address: 0x1234, value: 0x78 },
    { kind: "read", address: 0x1234, value: 0x78 },
  ]);
  assert.deepEqual(ram.accesses, result.accesses);

  // Later steps and state changes cannot alter a completed record.
  const saved = structuredClone(result);
  const next = executeByteInstruction(state, ram, { 0: () => {} }, readWordLE);
  assert.equal(next.executed, true);
  assert.equal(state.pc, 0x8001);
  assert.deepEqual(result, saved);
});

test("failed reads propagate without advancing past the failed fetch", () => {
  const ram = new ObservedRam(1);
  const state = { pc: 1 };
  assert.throws(() => executeByteInstruction(state, ram, {}, readWordLE), RangeError);
  assert.equal(state.pc, 1);
  assert.deepEqual(ram.accesses, []);

  state.pc = 0;
  assert.throws(() => executeByteInstruction(state, ram, {
    0: ({ fetchWord }) => { fetchWord(); },
  }, readWordLE), RangeError);
  assert.equal(state.pc, 1);
  assert.deepEqual(ram.accesses, [{ kind: "read", address: 0, value: 0 }]);
});

test("handler failures propagate without rolling back completed effects or reading ahead", () => {
  const ram = new ObservedRam();
  const state = { pc: 0 };
  const failure = new Error("handler failure");
  assert.throws(() => executeByteInstruction(state, ram, {
    0: ({ writeByte }) => {
      writeByte(0x1234, 0x56);
      state.pc = 0x8000;
      throw failure;
    },
  }, readWordBE), error => error === failure);
  assert.equal(state.pc, 0x8000);
  assert.deepEqual(ram.accesses, [
    { kind: "read", address: 0, value: 0 },
    { kind: "write", address: 0x1234, value: 0x56 },
  ]);
});

test("a rejected operand encoding retains its fetches, restores PC, and can be retried", () => {
  const ram = new ObservedRam();
  ram.write(0xffff, 0x42);
  ram.write(0, 0xff);
  const state = { pc: 0xffff };
  const handlers = { 0x42: ({ fetchByte }: { fetchByte: () => number }) => {
    if (fetchByte() === 0xff) return "unsupported" as const;
  } };
  for (let attempt = 0; attempt < 2; attempt++) {
    ram.accesses.length = 0;
    const result = executeByteInstruction(state, ram, handlers, readWordBE);
    assert.equal(result.executed, false);
    assert.equal(state.pc, 0xffff);
    assert.deepEqual(result.instruction, { address: 0xffff, bytes: [0x42, 0xff] });
    assert.deepEqual(result.accesses, [
      { kind: "read", address: 0xffff, value: 0x42 }, { kind: "read", address: 0, value: 0xff },
    ]);
    assert.deepEqual(ram.accesses, result.accesses);
  }
  ram.write(0, 0);
  assert.equal(executeByteInstruction(state, ram, handlers, readWordBE).executed, true);
  assert.equal(state.pc, 1);
});

test("a PC view can wrap a narrower selected address register and follow a changed selector", () => {
  const slots = [0x3fff, 0x100];
  let selected = 0, reads = 0;
  const counter = programCounter(() => { reads++; return slots[selected]!; }, value => { slots[selected] = value % 0x4000; });
  assert.equal(reads, 0);
  const ram = new ObservedRam(0x4000);
  ram.write(0x3fff, 0x42); ram.write(0, 0x12); ram.write(0x100, 0x34);
  ram.accesses.length = 0;
  const result = executeByteInstruction(counter, ram, { 0x42: ({ fetchByte }) => {
    assert.equal(fetchByte(), 0x12);
    selected = 1;
    assert.equal(fetchByte(), 0x34);
  } }, readWordLE);
  assert.deepEqual(slots, [1, 0x101]);
  assert.deepEqual(result.instruction, { address: 0x3fff, bytes: [0x42, 0x12, 0x34] });
  assert.deepEqual(result.accesses, [
    { kind: "read", address: 0x3fff, value: 0x42 }, { kind: "read", address: 0, value: 0x12 },
    { kind: "read", address: 0x100, value: 0x34 },
  ]);
  assert.deepEqual(ram.accesses, result.accesses);
});

test("fetch mapping preserves physical records, wraps logical PC, leaves data addresses alone, and restores logical PC on rejection", () => {
  const ram = new ObservedRam(0x20000);
  const state = { ip: 0xfffe };
  const counter = programCounter(() => state.ip, value => { state.ip = value; });
  const map = (pc: number) => 0x10000 + pc;
  ram.write(0x1fffe, 0x42); ram.write(0x1ffff, 0x34); ram.write(0x10000, 0x12);
  const reject = { 0x42: ({ fetchWord }: { fetchWord: () => number }) => { fetchWord(); return "unsupported" as const; } };
  for (let attempt = 0; attempt < 2; attempt++) {
    ram.accesses.length = 0;
    const result = executeByteInstruction(counter, ram, reject, readWordLE, map);
    assert.equal(result.executed, false);
    assert.equal(state.ip, 0xfffe);
    assert.deepEqual(result.instruction, { address: 0x1fffe, bytes: [0x42, 0x34, 0x12] });
    assert.deepEqual(result.accesses, ram.accesses);
  }
  ram.accesses.length = 0;
  const result = executeByteInstruction(counter, ram, { 0x42: ({ fetchWord, writeByte, readByte }) => {
    assert.equal(fetchWord(), 0x1234);
    writeByte(0x40, 0x56);
    assert.equal(readByte(0x40), 0x56);
  } }, readWordLE, map);
  assert.equal(state.ip, 1);
  assert.deepEqual(result.accesses, [
    { kind: "read", address: 0x1fffe, value: 0x42 }, { kind: "read", address: 0x1ffff, value: 0x34 },
    { kind: "read", address: 0x10000, value: 0x12 }, { kind: "write", address: 0x40, value: 0x56 },
    { kind: "read", address: 0x40, value: 0x56 },
  ]);
  assert.deepEqual(result.accesses, ram.accesses);
});
