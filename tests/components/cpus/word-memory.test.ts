import assert from "node:assert/strict";
import { test } from "node:test";
import { wordMemory, busFaultFromError, busFaultRecord } from "../../../src/components/cpus/word-memory.js";

test("word memory projects configurable bus widths while faults retain logical address and access space", () => {
  const calls: number[] = [];
  const record = wordMemory({ size: 256, read(address) { calls.push(address); return address === 0xff ? "bus-error" : 0x42; }, write() { return "bus-error"; } }, 8, 16);
  const memory = record();
  assert.equal(memory.readByte(0x123400), 0x42);
  assert.deepEqual(memory.accesses, [{ kind: "read", address: 0, value: 0x42 }]);
  for (const [run, operation, programSpace] of [
    [() => memory.fetchByte(0x1234ff), "fetch", true], [() => memory.readProgramByte(0x1234ff), "read", true],
    [() => memory.readByte(0x1234ff), "read", false], [() => memory.writeByte(0x1234ff, 1), "write", false],
  ] as const) assert.throws(run, error => {
    assert.deepEqual(busFaultFromError(error), { source: "bus-error", operation, address: 0x34ff, programSpace });
    assert.deepEqual(busFaultRecord(error), { source: "bus-error", operation, address: 0x34ff });
    return true;
  });
  assert.deepEqual(calls, [0, 255, 255, 255]);
  assert.equal(memory.accesses.length, 1);
  assert.deepEqual(record().accesses, []);
});

test("a full-width physical bus preserves unsigned addresses and rejects only explicit connection failures", () => {
  const addresses: number[] = [];
  const memory = wordMemory({ size: 2 ** 32, read(address) { addresses.push(address); return 0; }, write(address) { addresses.push(address); } }, 32, 32)();
  memory.readByte(0xffffffff); memory.writeByte(0x80000000, 0xff);
  assert.deepEqual(addresses, [0xffffffff, 0x80000000]);
  for (const thrown of ["bus-error", Error("host"), { operation: "read", address: 1, source: "bus-error" }]) {
    const failed = wordMemory({ size: 256, read() { throw thrown; }, write() { throw thrown; } }, 8, 16)();
    for (const run of [() => failed.fetchByte(1), () => failed.writeByte(1, 0)]) assert.throws(run, error => {
      assert.equal(error, thrown); assert.equal(busFaultFromError(error), undefined); return true;
    });
    assert.deepEqual(failed.accesses, []);
  }
});
