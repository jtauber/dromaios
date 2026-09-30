import assert from "node:assert/strict";
import { test } from "node:test";
import { create8080AltairBasic } from "../../../src/machines/generated/8080/altair-basic.js";

// MITS BASIC manual, Appendix A supplement, printed page 99, one-stop-bit choice.
const bootstrap = [0x3e, 3, 0xd3, 0x10, 0x3e, 0x15, 0xd3, 0x10, 0x21, 0xae, 0x0f,
  0x31, 0x1a, 0, 0xdb, 0x10, 0x0f, 0xd0, 0xdb, 0x11, 0xbd, 0xc8, 0x2d, 0x77, 0xc0, 0xe9, 0x0b, 0];

test("the BASIC machine contains only the entered bootstrap and four kilobytes of RAM", () => {
  const output: number[] = [], m = create8080AltairBasic({ serial: byte => { output.push(byte); } });
  const other = create8080AltairBasic({ serial: () => assert.fail("Independent machine") });
  assert.equal(m.ram.size, 0x1000); assert.equal(m.memory.size, 0x10000);
  for (let address = 0; address < 0x10000; address++) {
    assert.equal(m.memory.read(address), address < 0x1000 ? bootstrap[address] ?? 0 : 255);
  }
  m.memory.write(0x0fff, 0x42);
  for (const address of [0x1000, 0xffff]) {
    m.memory.write(address, 0x42);
    assert.equal(m.memory.read(address), 255);
  }
  assert.throws(() => m.ram.read(0x1000), RangeError);
  assert.throws(() => m.memory.read(0x10000), RangeError);
  for (let index = 0; index < 4; index++) assert.equal(m.cpu.step().outcome, "executed");
  assert.equal(m.serial.read(0), 2);
  m.sense.offer(0x0c); m.serial.offer(42);
  m.reset();
  assert.equal(m.cpu.snapshot().pc, 0);
  assert.equal(m.serial.read(0), 0);
  assert.equal(m.ports.readPort(0xff), 0x0c);
  assert.equal(m.ram.read(0x0fff), 0x42);
  for (const [address, byte] of bootstrap.entries()) assert.equal(m.ram.read(address), byte);
  assert.equal(other.ports.readPort(0xff), 0);
  assert.equal(other.ram.read(0x0fff), 0);
  assert.deepEqual(output, []);
});

test("8080 records physical RAM boundaries, sense input, and unanswered bus transfers", () => {
  const m = create8080AltairBasic({ serial: () => assert.fail("No serial output") });
  // STA last RAM byte; STA first hole; LDA first hole; IN sense; OUT sense; IN old SIO; HLT.
  const program = [0x3e, 0x42, 0x32, 0xff, 0x0f, 0x32, 0, 0x10, 0x3a, 0, 0x10,
    0xdb, 0xff, 0xd3, 0xff, 0xdb, 1, 0x76];
  program.forEach((byte, address) => m.ram.write(address, byte));
  m.sense.offer(0x0c);
  const steps = Array.from({ length: 8 }, () => m.cpu.step());
  assert.deepEqual(steps[1]!.accesses.at(-1), { kind: "write", address: 0x0fff, value: 0x42 });
  assert.deepEqual(steps[2]!.accesses.at(-1), { kind: "write", address: 0x1000, value: 0x42 });
  assert.deepEqual(steps[3]!.accesses.at(-1), { kind: "read", address: 0x1000, value: 255 });
  assert.deepEqual(steps[4]!.accesses.at(-1), { kind: "input", port: 255, value: 12 });
  assert.deepEqual(steps[5]!.accesses.at(-1), { kind: "output", port: 255, value: 12 });
  assert.deepEqual(steps[6]!.accesses.at(-1), { kind: "input", port: 1, value: 255 });
  assert.equal(steps[7]!.outcome, "halted");
  assert.equal(m.ram.read(0xfff), 0x42);
  assert.equal(m.memory.read(0x1000), 255);
  assert.equal(m.sense.read(0), 12);
});

test("panel IN samples all eight switches without consumption, and unused ports have explicit defaults", () => {
  const m = create8080AltairBasic({ serial: () => assert.fail("No serial output") });
  m.ram.write(0, 0xdb); m.ram.write(1, 0xff);
  for (let switches = 0; switches < 256; switches++) {
    m.sense.offer(switches);
    m.cpu.reset();
    assert.equal(m.cpu.step().after.a, switches);
    assert.equal(m.ports.readPort(0xff), switches);
  }
  for (let port = 0; port < 256; port++) {
    if (![0x10, 0x11, 0xff].includes(port)) assert.equal(m.ports.readPort(port), 255);
    if (port !== 0x10 && port !== 0x11) assert.equal(m.ports.writePort(port, 42), undefined);
  }
  for (const port of [-1, 256, 1.5, NaN]) {
    assert.throws(() => m.ports.readPort(port), RangeError);
    assert.throws(() => m.ports.writePort(port, 0), RangeError);
  }
  for (const value of [-1, 256, 1.5, NaN]) assert.throws(() => m.ports.writePort(0, value), RangeError);
});
