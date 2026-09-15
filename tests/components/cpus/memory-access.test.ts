import assert from "node:assert/strict";
import { test } from "node:test";
import { recordMemory } from "../../../src/components/cpus/memory-access.js";
import type { MemoryAccess } from "../../../src/components/cpus/memory-access.js";
import { recordPorts } from "../../../src/components/cpus/port-access.js";
import type { PortAccess } from "../../../src/components/cpus/port-access.js";
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

test("memory and port recorders report completed transfers in actual order to a combined log", () => {
  const ram = new ObservedRam();
  const combined: (MemoryAccess | PortAccess)[] = [];
  const record = (access: MemoryAccess | PortAccess) => combined.push(access);
  const memory = recordMemory(ram, record);
  let device = 0x5a;
  const ports = recordPorts({ readPort: () => device, writePort: (_port, value) => { device = value; } }, access => {
    assert.equal(access.value, device); // Notification follows the device operation.
    record(access);
  });
  assert.deepEqual(combined, []);
  const input = ports.readPort(0x1234);
  memory.writeByte(0xffff, input);
  ports.writePort(0xabcd, 0xa5);
  memory.writeByte(0, ports.readPort(0xabcd));
  assert.equal(memory.readByte(0xffff), 0x5a);
  assert.deepEqual(combined, [
    { kind: "input", port: 0x1234, value: 0x5a }, { kind: "write", address: 0xffff, value: 0x5a },
    { kind: "output", port: 0xabcd, value: 0xa5 }, { kind: "input", port: 0xabcd, value: 0xa5 },
    { kind: "write", address: 0, value: 0xa5 }, { kind: "read", address: 0xffff, value: 0x5a },
  ]);
  assert.deepEqual(memory.accesses, ram.accesses);
  assert.equal(ports.accesses.length, 3);
});

test("failed memory and port transfers do not notify combined logs or roll back earlier effects", () => {
  const ram = new ObservedRam(1);
  const combined: (MemoryAccess | PortAccess)[] = [];
  const record = (access: MemoryAccess | PortAccess) => combined.push(access);
  const memory = recordMemory(ram, record);
  const failure = new Error("device failure");
  let writes = 0;
  const ports = recordPorts({ readPort: () => 256, writePort: () => { writes++; throw failure; } }, record);
  memory.writeByte(0, 0x42);
  assert.throws(() => memory.readByte(1), RangeError);
  assert.throws(() => memory.writeByte(1, 0), RangeError);
  assert.throws(() => ports.readPort(0), RangeError);
  assert.throws(() => ports.writePort(0, 0), error => error === failure);
  assert.equal(writes, 1);
  assert.deepEqual(combined, [{ kind: "write", address: 0, value: 0x42 }]);
  assert.deepEqual(ports.accesses, []);
  assert.equal(ram.read(0), 0x42);
});
