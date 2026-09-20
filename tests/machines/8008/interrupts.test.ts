import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8008 } from "../../../src/components/cpus/generated/8008-cpu.js";
import { create8008Example } from "../../../src/machines/generated/8008/example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

test("8008 starts after reset, services a halted program, and resumes identically across restored boundaries", () => {
  const execute = (restore: boolean) => {
    const { cpu: initial, ram } = create8008Example();
    // Main: LAI 2A; HLT; ADI 1; OUT 1F; HLT.
    // Startup at 08 sets H:L to 3FFF, writes 99 there, then returns to main at 00.
    // Service at 0100: INP 3; LMA; RET. An external CAL supplies its full address.
    for (const [address, bytes] of [[0, [0x06, 0x2a, 0xff, 0x04, 1, 0x7f, 0xff]],
      [8, [0x2e, 0xff, 0x36, 0xff, 0x3e, 0x99, 0x07]], [0x100, [0x47, 0xf8, 0x07]]] as const) {
      bytes.forEach((byte, offset) => ram.write(address + offset, byte));
    }
    const outputs: number[] = [];
    let inputs = 0;
    const ports = { readPort: (port: number) => { assert.equal(port, 3); inputs++; return 0xfe; },
      writePort: (port: number, value: number) => { assert.equal(port, 31); outputs.push(value); } };
    let cpu = new Cpu8008(ram, initial.snapshot(), ports);
    const reconnect = () => { if (restore) cpu = new Cpu8008(ram, cpu.snapshot(), ports); };
    const reset = cpu.reset();
    reconnect();
    const stopped = runCpu(cpu, { maxSteps: 10 });
    assert.equal(stopped.stopReason, "halted");
    assert.equal(stopped.records[0]!.instruction, null);
    const start = cpu.interrupt(() => 0x0d); // RST 08
    assert.equal(start.after.pc, 8);
    assert.equal(start.after.stackIndex, 1);
    assert.equal(start.after.addressStack[0], 0);
    reconnect();
    const setup = [];
    for (let i = 0; i < 4; i++) { setup.push(cpu.step()); reconnect(); }
    assert.deepEqual(setup.map(record => record.after.pc), [10, 12, 14, 0]);
    assert.equal(ram.read(0x3fff), 0x99);
    const main = runCpu(cpu, { maxSteps: 10 });
    assert.equal(main.stopReason, "halted");
    assert.equal(main.records.length, 2);
    assert.equal(cpu.snapshot().pc, 3); // The RAM HLT advanced PC; the supplied CAL must preserve 3.
    reconnect();
    let index = 0;
    const service = cpu.interrupt(() => { assert.ok(index < 3); return [0x46, 0, 0xc1][index++]!; });
    assert.equal(index, 3);
    assert.equal(service.after.pc, 0x100); // Ignore address bits 15..14.
    assert.equal(service.after.addressStack[0], 3);
    assert.equal(service.after.stackIndex, 1);
    reconnect();
    const handler = [];
    for (let i = 0; i < 3; i++) { handler.push(cpu.step()); reconnect(); }
    assert.deepEqual(handler.map(record => record.after.pc), [0x101, 0x102, 3]);
    assert.equal(ram.read(0x3fff), 0xfe);
    const resumed = runCpu(cpu, { maxSteps: 10 });
    assert.equal(resumed.stopReason, "halted");
    assert.deepEqual(resumed.records.map(record => record.after.pc), [5, 6, 7]);
    assert.equal(cpu.snapshot().a, 0xff);
    assert.equal(cpu.snapshot().stackIndex, 0);
    assert.equal(cpu.snapshot().addressStack[1], 0x103);
    assert.deepEqual(outputs, [0xff]);
    assert.equal(inputs, 1);
    const records = { reset, stopped, start, setup, main, service, handler, resumed };
    const saved = structuredClone(records);
    cpu.reset();
    ram.write(0x3fff, 0);
    assert.deepEqual(records, saved);
    return records;
  };
  assert.deepEqual(execute(true), execute(false));
});
