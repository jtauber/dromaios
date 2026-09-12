import assert from "node:assert/strict";
import { test } from "node:test";
import { Ram } from "../../../src/components/memory/ram.js";

test("RAM starts with the requested number of zero bytes", () => {
  const ram = new Ram(257);
  assert.equal(ram.size, 257);
  for (let address = 0; address < ram.size; address++) {
    assert.equal(ram.read(address), 0);
  }
});

test("RAM stores every byte value and allows overwriting with zero", () => {
  const ram = new Ram(256);
  for (let value = 0; value <= 0xff; value++) {
    ram.write(value, value);
  }
  for (let value = 0; value <= 0xff; value++) {
    assert.equal(ram.read(value), value);
  }
  ram.write(0xff, 0);
  assert.equal(ram.read(0xff), 0);
  assert.equal(ram.read(0xfe), 0xfe);
});

test("RAM keeps distinct addresses across the full 64 KiB range", () => {
  const ram = new Ram(0x10000);
  ram.write(0x0000, 0x12);
  ram.write(0x0100, 0x34);
  ram.write(0xffff, 0x56);
  assert.equal(ram.read(0x0000), 0x12);
  assert.equal(ram.read(0x0100), 0x34);
  assert.equal(ram.read(0xffff), 0x56);
  assert.equal(ram.read(0x0001), 0);
  assert.equal(ram.read(0xfffe), 0);
});

test("RAM instances own independent storage", () => {
  const first = new Ram(1);
  const second = new Ram(1);
  first.write(0, 0x12);
  assert.equal(second.read(0), 0);
  second.write(0, 0x34);
  assert.equal(first.read(0), 0x12);
});

test("RAM rejects invalid sizes", () => {
  for (const size of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new Ram(size), RangeError, `size ${size}`);
  }
});

test("RAM rejects invalid addresses without wrapping or changing memory", () => {
  const ram = new Ram(2);
  ram.write(0, 0x12);
  ram.write(1, 0x34);
  for (const address of [-1, 2, 0x10000, 0.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => ram.read(address), RangeError, `read address ${address}`);
    assert.throws(() => ram.write(address, 0xff), RangeError, `write address ${address}`);
    assert.equal(ram.read(0), 0x12);
    assert.equal(ram.read(1), 0x34);
    assert.equal(ram.size, 2);
  }
});

test("RAM rejects invalid byte values without truncating or changing memory", () => {
  const ram = new Ram(1);
  ram.write(0, 0x5a);
  for (const value of [-1, 0x100, 0x10000, 1.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => ram.write(0, value), RangeError, `byte value ${value}`);
    assert.equal(ram.read(0), 0x5a);
  }
});
