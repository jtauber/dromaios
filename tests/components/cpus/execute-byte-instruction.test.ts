import assert from "node:assert/strict";
import { test } from "node:test";
import { readWordBE, readWordLE } from "../../../src/components/cpus/binary.js";
import { executeByteInstruction } from "../../../src/components/cpus/execute-byte-instruction.js";
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
