import assert from "node:assert/strict";
import { test } from "node:test";
import { Ram } from "../../../src/components/memory/ram.js";
import { decodedExecution } from "../../../src/components/cpus/decoded-execution.js";

for (const word of ["little", "big"] as const) test(`decoded execution supplies ${word}-endian words and increments the live counter after reads`, () => {
  const state = { pc: 0xfe, fetched: 0, result: 0, retired: false };
  class Memory extends Ram {
    override read(address: number) {
      if (address === 0xfe) assert.equal(state.fetched, 0);
      else assert.equal(state.fetched, 1);
      if (address === 0xff) state.pc = 0x10;
      return super.read(address);
    }
  }
  const ram = new Memory(256); ram.write(0xfe, 0x42); ram.write(0xff, 0x12); ram.write(0x11, 0x34);
  const cpu = decodedExecution("probe", ram, undefined, () => ({ ...state }), {
    memoryBits: 8, counter: state, stopped: () => false, reset: () => {}, word,
    retire: () => { state.retired = true; }, opcodeFetched: count => { state.fetched += count; },
    decode: () => ({ opcodeFetches: 1, handler: ({ fetchWord }) => { state.result = fetchWord(); } }),
  });
  const record = cpu.step();
  assert.equal(state.result, word === "big" ? 0x1234 : 0x3412);
  assert.equal(state.pc, 0x12); assert.equal(state.retired, true);
  assert.deepEqual(record.instruction, { address: 0xfe, bytes: [0x42, 0x12, 0x34] });
  assert.deepEqual(record.accesses.map(access => "address" in access ? access.address : -1), [0xfe, 0xff, 0x11]);
});
