import assert from "node:assert/strict";
import { test } from "node:test";
import { ByteMemoryBus } from "../../../src/components/memory/byte-memory-bus.js";
import { MemoryMap } from "../../../src/components/memory/memory-map.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { Rom } from "../../../src/components/memory/rom.js";

test("a byte bus resolves unanswered transfers while preserving mapped storage and validation", () => {
  const ram = new Ram(2), rom = new Rom([0x76]);
  const map = new MemoryMap(8, [{ start: 1, memory: ram }, { start: 6, memory: rom }]);
  for (const undriven of [0, 0xff, 0x5a]) {
    const bus = new ByteMemoryBus(map, undriven);
    assert.equal(bus.size, 8);
    for (const address of [0, 3, 4, 5, 7]) {
      assert.equal(bus.write(address, 0), undefined);
      assert.equal(bus.read(address), undriven);
      assert.equal(map.read(address), "bus-error");
    }
    bus.write(1, 0x42); bus.write(2, 0xa5);
    assert.equal(ram.read(0), 0x42); assert.equal(ram.read(1), 0xa5);
    assert.equal(bus.read(1), 0x42); assert.equal(bus.read(2), 0xa5);
    assert.equal(bus.write(6, 0), undefined);
    assert.equal(bus.read(6), 0x76);
    for (const address of [-1, 8, 0.5, NaN]) {
      assert.throws(() => bus.read(address), RangeError);
      assert.throws(() => bus.write(address, 0), RangeError);
    }
    for (const byte of [-1, 256, 0.5, NaN]) for (const address of [0, 1, 6]) {
      assert.throws(() => bus.write(address, byte), RangeError);
    }
  }
  for (const byte of [-1, 256, 0.5, NaN]) assert.throws(() => new ByteMemoryBus(map, byte), RangeError);
});

test("a byte bus calls a connection once and never swallows host exceptions", () => {
  const failure = new Error("Device failed"), calls: number[] = [];
  const connection = {
    size: 1,
    read(address: number): never { assert.equal(this, connection); calls.push(address); throw failure; },
    write(address: number, byte: number): never { assert.equal(this, connection); calls.push(address, byte); throw failure; },
  };
  const bus = new ByteMemoryBus(connection, 0xff);
  assert.deepEqual(calls, []);
  assert.throws(() => bus.read(0), error => error === failure);
  assert.throws(() => bus.write(0, 42), error => error === failure);
  assert.deepEqual(calls, [0, 0, 42]);
});
