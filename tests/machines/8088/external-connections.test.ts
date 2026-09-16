import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../src/components/cpus/8088.js";
import type { Cpu8088State, Cpu8088Connections } from "../../../src/components/cpus/8088.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

test("8088 ESC/WAIT program restores CPU and device state, handles an interrupt, and resumes through word output", () => {
  const ram = new Ram(0x100000);
  const initial: Cpu8088State = { ax: 0, bx: 0, cx: 0, dx: 0, sp: 0x8000, bp: 0, si: 0, di: 0,
    cs: 0x1000, ds: 0x2000, ss: 0x3000, es: 0, ip: 0x100,
    halted: false, waiting: false, interruptDeferred: false, recognitionDeferred: false, trapPending: false,
    flags: { cf: false, pf: false, af: false, zf: false, sf: false, tf: false, if: true, df: false, of: false } };
  // ESC 0,[FFFF]; WAIT; MOV AX,[0080]; OUT 80,AX; HLT.
  [0xd8, 0x06, 0xff, 0xff, 0x9b, 0xa1, 0x80, 0, 0xe7, 0x80, 0xf4].forEach((value, i) => ram.write(0x10100 + i, value));
  ram.write(0x2ffff, 0x34); ram.write(0x20000, 0x12);
  [0, 1, 0, 0x40].forEach((value, i) => ram.write(0x80 + i, value)); // Type 20 -> 4000:0100.
  ram.write(0x40100, 0x43); ram.write(0x40101, 0xcf); // INC BX; IRET.
  // A deliberately small external processor: capture a word, then double it when the machine advances it.
  let device = { busy: false, operand: 0, commands: 0, output: [] as number[][] };
  function connect(): Cpu8088Connections {
    return { escape: request => {
      assert.equal(request.opcode, 0); assert.equal(request.memory?.address, 0x2ffff);
      device.operand = request.memory!.value; device.busy = true; device.commands++;
    }, test: () => device.busy,
    ports: { readPort: () => assert.fail("output only"), writePort: (port, value) => { device.output.push([port, value]); } } };
  }
  let cpu = new Cpu8088(ram, initial, connect());
  const paused = runCpu(cpu, { maxSteps: 10 });
  assert.equal(paused.stopReason, "waiting"); assert.equal(paused.records.length, 2);
  const savedCpu = cpu.snapshot(), savedDevice = structuredClone(device);
  assert.equal(savedCpu.ip, 0x104); assert.equal(savedDevice.operand, 0x1234);
  device = structuredClone(savedDevice); cpu = new Cpu8088(ram, savedCpu, connect());
  assert.equal(cpu.interrupt("intr", () => 0x20).outcome, "accepted");
  const interrupted = runCpu(cpu, { maxSteps: 10 });
  assert.equal(interrupted.stopReason, "waiting"); assert.equal(interrupted.records.length, 3);
  assert.equal(cpu.snapshot().bx, 1); assert.equal(cpu.snapshot().ip, 0x104);
  assert.equal(device.commands, 1, "IRET resumes WAIT without issuing ESC again");
  const result = device.operand * 2;
  ram.write(0x20080, result % 256); ram.write(0x20081, Math.floor(result / 256)); device.busy = false;
  const resumed = runCpu(cpu, { maxSteps: 10 });
  assert.equal(resumed.stopReason, "halted"); assert.equal(resumed.records.length, 4);
  assert.equal(resumed.records[0]?.instruction, null); assert.equal(cpu.snapshot().ax, 0x2468);
  assert.equal(cpu.snapshot().ip, 0x10b); assert.equal(cpu.snapshot().sp, initial.sp);
  assert.equal(cpu.snapshot().waiting, false); assert.deepEqual(device.output, [[0x80, 0x68], [0x81, 0x24]]);
  assert.equal(savedCpu.waiting, true); assert.deepEqual(savedDevice.output, []);
});
