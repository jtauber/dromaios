import assert from "node:assert/strict";
import { test } from "node:test";
import { recordMemory } from "../../../src/components/cpus/memory-access.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

test("memory recording starts empty and records actual calls in order, including repeated reads and unchanged writes", () => {
  const ram = new ObservedRam(0x10002);
  ram.write(0, 0x11);
  ram.write(0x10000, 0xa5);
  ram.accesses.length = 0;
  const { accesses, readByte, writeByte } = recordMemory(ram);
  assert.deepEqual(accesses, []);
  assert.deepEqual(ram.accesses, []);
  // Destructured callbacks need no receiver; addresses are passed to RAM without masking.
  assert.equal(readByte(0x10000), 0xa5);
  assert.equal(readByte(0x10000), 0xa5);
  writeByte(0x10000, 0xa5);
  writeByte(0x10001, 0x7f);
  assert.equal(readByte(0x10001), 0x7f);
  assert.equal(readByte(0), 0x11);
  const expected = [
    { kind: "read", address: 0x10000, value: 0xa5 },
    { kind: "read", address: 0x10000, value: 0xa5 },
    { kind: "write", address: 0x10000, value: 0xa5 },
    { kind: "write", address: 0x10001, value: 0x7f },
    { kind: "read", address: 0x10001, value: 0x7f },
    { kind: "read", address: 0, value: 0x11 },
  ];
  assert.deepEqual(accesses, expected);
  assert.deepEqual(ram.accesses, expected);
  assert.equal(ram.read(0x10001), 0x7f);
});

test("recorders have independent logs and read current RAM without retroactively changing recorded values", () => {
  const ram = new ObservedRam();
  const first = recordMemory(ram);
  first.readByte(0);
  const second = recordMemory(ram);
  second.writeByte(0, 0xa5);
  second.readByte(0);
  const saved = structuredClone(second.accesses);
  assert.deepEqual(first.accesses, [{ kind: "read", address: 0, value: 0 }]);
  assert.equal(first.readByte(0), 0xa5);
  ram.write(0, 0x55);
  assert.equal(first.readByte(0), 0x55);
  assert.deepEqual(first.accesses, [
    { kind: "read", address: 0, value: 0 },
    { kind: "read", address: 0, value: 0xa5 },
    { kind: "read", address: 0, value: 0x55 },
  ]);
  // Even bypassing readonly typing on one log cannot change the other log or RAM.
  Reflect.set(first.accesses[1]!, "value", 0xff);
  assert.deepEqual(second.accesses, saved);
  assert.equal(ram.read(0), 0x55);
});

test("RAM validation errors propagate without recording a completed access", () => {
  const ram = new ObservedRam(16);
  const { accesses, readByte, writeByte } = recordMemory(ram);
  writeByte(0, 0x55);
  for (const address of [-1, 16, 0.5, NaN, Infinity]) {
    assert.throws(() => readByte(address), RangeError);
    assert.throws(() => writeByte(address, 0), RangeError);
  }
  for (const value of [-1, 256, 0.5, NaN, Infinity]) {
    assert.throws(() => writeByte(0, value), RangeError);
  }
  const expected = [{ kind: "write", address: 0, value: 0x55 }];
  assert.deepEqual(accesses, expected);
  assert.deepEqual(ram.accesses, expected);
  assert.equal(readByte(0), 0x55);
});
