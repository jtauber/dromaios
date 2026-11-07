import assert from "node:assert/strict";
import { test } from "node:test";
import { create6502Apple2 } from "../../../src/machines/generated/6502/apple2.js";
import { Cpu6502 } from "../../../src/components/cpus/generated/6502-cpu.js";

function program() {
  const machine = create6502Apple2({ firmware: null });
  // LDX #2; DEX; BNE $0202; INC $10. 2 + 2 + 3 + 2 + 2 + 5 = 16 clocks.
  [0xa2, 2, 0xca, 0xd0, 0xfd, 0xe6, 0x10].forEach((byte, i) => machine.ram.write(0x200 + i, byte));
  machine.cpu = new Cpu6502(machine.memory, { ...machine.cpu.snapshot(), pc: 0x200 });
  return machine;
}

test("Apple II machine clocks count each completed instruction and replay exactly from a checkpoint", () => {
  const machine = program();
  assert.equal(machine.clock.ticks, 0);
  assert.equal(machine.clock.hertz, 1_023_000);
  const clocks = [machine.step().clocks, machine.step().clocks, machine.step().clocks];
  assert.equal(machine.clock.ticks, 7);
  const saved = machine.snapshot(), restored = create6502Apple2({ firmware: null }, saved);
  assert.deepEqual(saved.clock, { ticks: 7 }, "Frequency is chapter configuration, not mutable checkpoint state");
  assert.equal(restored.clock.hertz, 1_023_000);
  for (let i = 0; i < 3; i++) {
    const record = machine.step();
    clocks.push(record.clocks);
    assert.deepEqual(restored.step(), record);
  }
  assert.deepEqual(clocks, [2, 2, 3, 2, 2, 5]);
  assert.equal(machine.clock.ticks, 16); assert.equal(machine.ram.read(0x10), 1);
  assert.deepEqual(restored.snapshot(), machine.snapshot()); assert.equal(saved.clock.ticks, 7);
  machine.reset();
  assert.equal(machine.clock.ticks, 16, "The reset boundary has no declared duration");
  assert.equal(machine.ram.read(0x10), 1);
  assert.equal(program().clock.ticks, 0, "New construction starts a new clock");
  const { clock: omitted, ...legacy } = saved;
  assert.throws(() => create6502Apple2({ firmware: null }, legacy as never), /snapshot/);
});

test("clocked interrupts follow the current CPU and ignored IRQs consume no time", () => {
  const machine = program();
  machine.step();
  assert.equal(machine.interrupt("irq").clocks, 7);
  assert.equal(machine.clock.ticks, 9);
  assert.equal(machine.interrupt("irq").clocks, 0);
  assert.equal(machine.clock.ticks, 9);
  assert.equal(machine.interrupt("nmi").clocks, 7);
  assert.equal(machine.clock.ticks, 16);
});

test("unsupported or failed instructions do not invent elapsed time or roll back completed CPU effects", () => {
  const machine = program(); machine.step();
  machine.ram.write(0x202, 0x02); // Undocumented opcode: no timing contract.
  assert.throws(() => machine.step(), /timing unavailable/i);
  assert.equal(machine.clock.ticks, 2); assert.equal(machine.cpu.snapshot().pc, 0x202);
  // A failing data write leaves the completed opcode and operand fetch visible.
  machine.ram.write(0x202, 0x85); machine.ram.write(0x203, 0x10);
  machine.memory.write = () => { throw new Error("Failed write"); };
  assert.throws(() => machine.step(), /Failed write/);
  assert.equal(machine.clock.ticks, 2); assert.equal(machine.cpu.snapshot().pc, 0x204);
});
