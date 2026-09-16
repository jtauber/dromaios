import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryMap } from "../../../src/components/memory/memory-map.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { Rom } from "../../../src/components/memory/rom.js";

test("memory maps translate disjoint and adjacent regions with exclusive upper bounds", () => {
  const ram = new Ram(2);
  const rom = new Rom([0x12, 0x34]);
  // Deliberately unsorted, with adjacent ROM/RAM and holes on either side.
  const memory = new MemoryMap(8, [{ start: 3, memory: ram }, { start: 1, memory: rom }]);
  assert.equal(memory.size, 8);
  assert.equal(memory.write(3, 0x56), undefined);
  assert.equal(memory.write(4, 0x78), undefined);
  assert.equal(ram.read(0), 0x56);
  assert.equal(ram.read(1), 0x78);
  assert.deepEqual(Array.from({ length: 8 }, (_, address) => memory.read(address)),
    ["bus-error", 0x12, 0x34, 0x56, 0x78, "bus-error", "bus-error", "bus-error"]);
  for (const address of [0, 1, 2, 5, 6, 7]) assert.equal(memory.write(address, 0), "bus-error");
  assert.equal(rom.read(0), 0x12);
  assert.equal(rom.read(1), 0x34);
});

test("memory maps own their routing definitions while retaining the connected components", () => {
  const ram = new Ram(2);
  const region = { start: 4, memory: ram };
  const regions = [region];
  const memory = new MemoryMap(8, regions);
  region.start = 0;
  region.memory = new Ram(2);
  regions.push({ start: 6, memory: new Ram(1) });
  ram.write(0, 0x5a);
  assert.equal(memory.read(4), 0x5a);
  assert.equal(memory.read(0), "bus-error");
  assert.equal(memory.read(6), "bus-error");
  memory.write(5, 0xa5);
  assert.equal(ram.read(1), 0xa5);
  const definitions = [{ start: 6, memory: new Ram(1) }, { start: 1, memory: new Ram(1) }];
  new MemoryMap(8, definitions);
  assert.deepEqual(definitions.map(item => item.start), [6, 1]);
});

test("memory maps delegate exactly once, retain method receivers, and propagate reported or thrown failures", () => {
  const calls: unknown[] = [];
  const failure = new Error("host device failure");
  const device = {
    size: 3,
    read(address: number): number | "bus-error" {
      assert.equal(this, device);
      calls.push(["read", address]);
      if (address === 2) throw failure;
      return address === 1 ? "bus-error" : 0x5a;
    },
    write(address: number, value: number): void | "bus-error" {
      assert.equal(this, device);
      calls.push(["write", address, value]);
      if (address === 2) throw "bus-error";
      if (address === 1) return "bus-error";
    },
  };
  const memory = new MemoryMap(8, [{ start: 3, memory: device }]);
  assert.deepEqual(calls, []); // Construction does not access the component.
  assert.equal(memory.read(3), 0x5a);
  assert.equal(memory.read(4), "bus-error");
  assert.throws(() => memory.read(5), error => error === failure);
  assert.equal(memory.write(3, 0x12), undefined);
  assert.equal(memory.write(4, 0x34), "bus-error");
  assert.throws(() => memory.write(5, 0x56), error => error === "bus-error");
  assert.equal(memory.read(2), "bus-error");
  assert.equal(memory.write(6, 0), "bus-error");
  assert.deepEqual(calls, [["read", 0], ["read", 1], ["read", 2], ["write", 0, 0x12], ["write", 1, 0x34], ["write", 2, 0x56]]);
});

test("memory maps allow holes, an empty map, and a region ending at the address-space limit", () => {
  const empty = new MemoryMap(1, []);
  assert.equal(empty.read(0), "bus-error");
  assert.equal(empty.write(0, 0), "bus-error");
  const size = Number.MAX_SAFE_INTEGER;
  const memory = new MemoryMap(size, [{ start: size - 1, memory: new Rom([0xff]) }]);
  assert.equal(memory.read(size - 2), "bus-error");
  assert.equal(memory.read(size - 1), 0xff);
  assert.throws(() => memory.read(size), RangeError);
});

test("memory maps reject invalid sizes, out-of-range regions, and any overlap", () => {
  assert.throws(() => new MemoryMap(8, new Array<{ start: number; memory: Ram }>(1)), TypeError);
  for (const size of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new MemoryMap(size, []), RangeError);
  }
  for (const start of [-1, 8, 7, 0.5, NaN, Infinity]) {
    assert.throws(() => new MemoryMap(8, [{ start, memory: new Ram(2) }]), RangeError);
  }
  for (const size of [0, -1, 9, 0.5, NaN, Infinity]) {
    const memory = { size, read: () => 0, write: () => {} };
    assert.throws(() => new MemoryMap(8, [{ start: 0, memory }]), RangeError);
  }
  for (const starts of [[0, 0], [0, 1], [1, 0]]) {
    assert.throws(() => new MemoryMap(8, starts.map(start => ({ start, memory: new Ram(2) }))), /overlap/);
  }
  assert.throws(() => new MemoryMap(8, [{ start: 0, memory: new Ram(8) }, { start: 3, memory: new Ram(1) }]), /overlap/);
});

test("memory maps validate host arguments even in holes and before touching a component", () => {
  const memory = new MemoryMap(8, [{ start: 0, memory: {
    size: 2, read: () => assert.fail("Unexpected read"), write: () => assert.fail("Unexpected write"),
  } }]);
  for (const address of [-1, 8, 0x1000000, 0.5, NaN, Infinity]) {
    assert.throws(() => memory.read(address), RangeError);
    assert.throws(() => memory.write(address, 0), RangeError);
  }
  for (const address of [0, 7]) for (const value of [-1, 256, 0.5, NaN, Infinity]) {
    assert.throws(() => memory.write(address, value), RangeError);
  }
});
