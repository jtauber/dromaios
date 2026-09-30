import assert from "node:assert/strict";
import { test } from "node:test";
import { create8080AltairSerial } from "../../../src/machines/generated/8080/altair-serial.js";

// Independently assembled initialization and receive/transmit polling loop.
const bytes = [0x3e, 3, 0xd3, 0x10, 0x3e, 0x15, 0xd3, 0x10, 0xdb, 0x10, 0xe6, 1, 0xca, 8, 1,
  0xdb, 0x11, 0x47, 0xdb, 0x10, 0xe6, 2, 0xca, 0x12, 1, 0x78, 0xd3, 0x11, 0xc3, 8, 1];

test("the serial machine initializes through OUT and polls the declared historical port pair", () => {
  const output: number[] = [], machine = create8080AltairSerial({ serial: value => { output.push(value); } });
  const other = create8080AltairSerial({ serial: () => assert.fail("Independent instance") });
  assert.equal(machine.cpu.snapshot().pc, 0x100);
  assert.equal(machine.serial.offer(42), false);
  for (let address = 0; address < 65536; address++) assert.equal(machine.ram.read(address), bytes[address - 0x100] ?? 0);
  const io = (steps: number) => Array.from({ length: steps }, () => machine.cpu.step()).flatMap(record =>
    record.accesses.filter(access => access.kind === "input" || access.kind === "output"));
  assert.deepEqual(io(4), [
    { kind: "output", port: 0x10, value: 3 }, { kind: "output", port: 0x10, value: 0x15 },
  ]);
  assert.deepEqual(output, []);
  assert.deepEqual(io(6), [{ kind: "input", port: 0x10, value: 2 }, { kind: "input", port: 0x10, value: 2 }]);
  for (let byte = 0; byte < 256; byte++) {
    assert.equal(machine.serial.offer(byte), true);
    assert.deepEqual(io(11), [
      { kind: "input", port: 0x10, value: 3 }, { kind: "input", port: 0x11, value: byte },
      { kind: "input", port: 0x10, value: 2 }, { kind: "output", port: 0x11, value: byte },
    ]);
    assert.equal(machine.cpu.snapshot().pc, 0x108);
    assert.equal(machine.cpu.snapshot().a, byte);
    assert.equal(machine.cpu.snapshot().b, byte);
    assert.equal(output.at(-1), byte);
  }
  for (let port = 0; port < 256; port++) if (port !== 0x10 && port !== 0x11) {
    assert.throws(() => machine.ports.readPort(port), /Unconnected/);
    assert.throws(() => machine.ports.writePort(port, 0), /Unconnected/);
  }
  assert.equal(other.cpu.snapshot().pc, 0x100);
  assert.equal(other.serial.read(0), 0);
  machine.reset();
  assert.equal(machine.cpu.snapshot().pc, 0);
  assert.equal(machine.serial.read(0), 0);
  for (let address = 0; address < 65536; address++) assert.equal(machine.ram.read(address), bytes[address - 0x100] ?? 0);
  assert.equal(output.length, 256);
});
