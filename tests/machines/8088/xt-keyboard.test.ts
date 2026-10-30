import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../src/components/cpus/generated/8088-cpu.js";
import { create8088XtKeyboard } from "../../../src/machines/generated/8088/xt-keyboard.js";
import { stepXtCpu } from "../../../src/machines/8088/pc-xt/interrupts.js";

type Machine = ReturnType<typeof create8088XtKeyboard>;
function until(machine: Machine, done: () => boolean, limit = 100) {
  const records = [];
  while (!done() && records.length < limit) records.push(stepXtCpu(machine));
  assert.ok(done(), "The example reached its instruction bound before the expected checkpoint.");
  return records;
}
const halted = (machine: Machine) => () => machine.cpu.snapshot().halted;
const at = (machine: Machine, ip: number) => () => machine.cpu.snapshot().ip === ip;

test("the executable XT example installs its vector and receives make/break codes through native interrupts", () => {
  const machine = create8088XtKeyboard();
  const boot = until(machine, halted(machine));
  assert.deepEqual(boot.flatMap(record => record.accesses.filter(access => access.kind === "output")), [
    { kind: "output", port: 0x20, value: 0x13 }, { kind: "output", port: 0x21, value: 8 },
    { kind: "output", port: 0x21, value: 9 }, { kind: "output", port: 0x21, value: 0xfd },
    { kind: "output", port: 0x63, value: 0x99 }, { kind: "output", port: 0x61, value: 0x4c },
  ]);
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => machine.ram.read(0x24 + i)), [0, 2, 0, 0]);
  assert.equal(machine.cpu.snapshot().ip, 0x12a);
  for (const [index, byte] of [0x1e, 0x9e].entries()) {
    const before = machine.cpu.snapshot();
    assert.equal(machine.io.offerScanCode(byte), true);
    const interrupt = stepXtCpu(machine);
    assert.equal(interrupt.outcome, "accepted");
    assert.equal(interrupt.after.ip, 0x200); assert.equal(interrupt.after.sp, 0x7ffa);
    assert.deepEqual(interrupt.accesses.slice(0, 5), [
      { kind: "acknowledge", value: 9 },
      { kind: "read", address: 0x24, value: 0 }, { kind: "read", address: 0x25, value: 2 },
      { kind: "read", address: 0x26, value: 0 }, { kind: "read", address: 0x27, value: 0 },
    ]);
    const handled = until(machine, halted(machine));
    assert.deepEqual(handled.flatMap(record => record.accesses.filter(access => access.kind === "input" || access.kind === "output")), [
      { kind: "input", port: 0x60, value: byte }, { kind: "input", port: 0x61, value: 0x4c },
      { kind: "output", port: 0x61, value: 0xcc }, { kind: "output", port: 0x61, value: 0x4c },
      { kind: "output", port: 0x20, value: 0x20 },
    ]);
    assert.equal(machine.ram.read(0x300 + index), byte);
    assert.equal(machine.cpu.snapshot().bx, 0x301 + index);
    assert.equal(machine.cpu.snapshot().sp, before.sp); assert.equal(machine.cpu.snapshot().ax, before.ax);
    assert.equal(machine.cpu.snapshot().flags.if, true);
    assert.equal(machine.io.keyboardPending, false); assert.equal(machine.io.snapshot().pic.isr, 0);
  }
  const io = machine.io.snapshot(); machine.cpu.reset();
  assert.deepEqual(machine.io.snapshot(), io);
  machine.reset(); assert.equal(machine.cpu.snapshot().pc, 0xffff0);
  assert.equal(machine.io.snapshot().pic.phase, 0); assert.equal(machine.ram.read(0x300), 0x1e);
});

test("a key pending before STI survives IF masking and the instruction shadow", () => {
  const machine = create8088XtKeyboard(); until(machine, at(machine, 0x128));
  assert.equal(machine.io.offerScanCode(0x1e), true);
  const pending = machine.io.snapshot();
  const sti = stepXtCpu(machine);
  assert.equal(sti.instruction?.bytes[0], 0xfb);
  assert.equal(sti.after.interruptDeferred, true); assert.deepEqual(machine.io.snapshot(), pending);
  assert.equal(stepXtCpu(machine).outcome, "halted"); assert.deepEqual(machine.io.snapshot(), pending);
  assert.equal(stepXtCpu(machine).outcome, "accepted");
  until(machine, halted(machine)); assert.equal(machine.ram.read(0x300), 0x1e);
});

test("MOV SS deferral preserves the PIC and returns to the interrupted code", () => {
  const machine = create8088XtKeyboard(); until(machine, halted(machine));
  const state = machine.cpu.snapshot();
  machine.ram.write(0x400, 0x8e); machine.ram.write(0x401, 0xd0); // MOV SS,AX
  machine.ram.write(0x402, 0x90); // NOP, protected by the segment-load shadow.
  machine.cpu = new Cpu8088(machine.ram, { ...state, ax: 0, halted: false, ip: 0x400 }, { ports: machine.ports });
  stepXtCpu(machine); machine.io.offerScanCode(0x1e);
  const pending = machine.io.snapshot();
  assert.equal(stepXtCpu(machine).instruction?.bytes[0], 0x90);
  assert.deepEqual(machine.io.snapshot(), pending);
  assert.equal(stepXtCpu(machine).outcome, "accepted");
  until(machine, at(machine, 0x403)); assert.equal(machine.cpu.snapshot().sp, 0x8000);
});

test("a second transfer waits behind the current handler and saved sessions continue identically", () => {
  const machine = create8088XtKeyboard(); until(machine, halted(machine));
  machine.io.offerScanCode(0x1e); stepXtCpu(machine);
  until(machine, at(machine, 0x212)); // Receiver re-enabled, but PIC service has not ended.
  assert.equal(machine.io.offerScanCode(0x9e), true); assert.equal(machine.io.irq, false);
  const saved = machine.snapshot(), restored = create8088XtKeyboard(saved);
  assert.equal(restored.io.snapshot().pic.irr, 2); assert.equal(restored.io.snapshot().pic.isr, 2);
  const records = until(machine, halted(machine));
  const replay = until(restored, halted(restored));
  assert.deepEqual(replay, records);
  assert.deepEqual(restored.snapshot(), machine.snapshot());
  assert.deepEqual([machine.ram.read(0x300), machine.ram.read(0x301)], [0x1e, 0x9e]);
  assert.equal(machine.cpu.snapshot().bx, 0x302); assert.equal(machine.cpu.snapshot().sp, 0x8000);
  assert.equal(saved.io.pic.isr, 2); assert.equal(saved.io.pic.irr, 2);
  const fresh = create8088XtKeyboard(); assert.equal(fresh.ram.read(0x300), 0);
});

test("PIC-masked input and pure inspection neither consume a key nor wake the halted CPU", () => {
  const machine = create8088XtKeyboard(); until(machine, halted(machine));
  machine.ports.writePort(0x21, 0xff); machine.io.offerScanCode(0x1e);
  const before = machine.snapshot();
  for (let i = 0; i < 3; i++) {
    assert.equal(stepXtCpu(machine).outcome, "halted");
    machine.io.snapshot(); machine.cpu.snapshot(); machine.ports.readPort(0x60);
    machine.ports.readPort(0x20); machine.ports.readPort(0x21); machine.ram.read(0x200);
  }
  assert.deepEqual(machine.snapshot(), before);
  const restored = create8088XtKeyboard(before);
  restored.ports.writePort(0x21, 0xfd);
  assert.equal(stepXtCpu(restored).outcome, "accepted");
  until(restored, halted(restored)); assert.equal(restored.ram.read(0x300), 0x1e);
  assert.deepEqual(machine.snapshot(), before);
});
