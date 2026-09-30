import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8080 } from "../../src/components/cpus/generated/8080-cpu.js";
import { create8080AltairBasic } from "../../src/machines/generated/8080/altair-basic.js";
import { SerialSession } from "../../src/runtime/serial-session.js";
import { createAltairMachinePanel } from "../../site/interactive/altair-machine-panel.js";

function setSwitches(panel: ReturnType<typeof createAltairMachinePanel>, value: number): void {
  for (let bit = 0; bit < 16; bit++) if ((panel.switches ^ value) & (1 << bit)) panel.toggleSwitch(bit);
}

test("the machine panel follows the declared RAM boundary, discarded writes, and 16-bit wrap", () => {
  const machine = create8080AltairBasic({ serial() {} });
  const panel = createAltairMachinePanel(machine, () => true);
  assert.deepEqual([panel.address, panel.data, panel.switches], [0, 0x3e, 0]);
  setSwitches(panel, 0x0fff); panel.examine();
  setSwitches(panel, 0xab42); panel.deposit();
  assert.deepEqual([panel.address, panel.data, machine.ram.read(0xfff)], [0xfff, 0x42, 0x42]);
  panel.depositNext();
  assert.deepEqual([panel.address, panel.data, machine.cpu.snapshot().pc], [0x1000, 0xff, 0x1000]);
  assert.equal(machine.ram.read(0), 0x3e); // A missing address must not alias low RAM.
  assert.equal(machine.ram.read(0xfff), 0x42);
  setSwitches(panel, 0xffff); panel.examine(); panel.deposit();
  assert.equal(panel.data, 0xff);
  panel.examineNext();
  assert.deepEqual([panel.address, panel.data, panel.switches], [0, 0x3e, 0xffff]);
  setSwitches(panel, 0xffff); panel.examine();
  setSwitches(panel, 0x25); panel.depositNext();
  assert.deepEqual([panel.address, panel.data], [0, 0x25]);
});

test("EXAMINE and NEXT change only PC; display reads leave serial input and all other CPU state alone", () => {
  const machine = create8080AltairBasic({ serial() {} });
  machine.cpu = new Cpu8080(machine.memory, {
    ...machine.cpu.snapshot(), a: 0xa5, b: 1, c: 2, d: 3, e: 4, h: 5, l: 6, sp: 0xf00,
    flags: { s: true, z: false, ac: true, p: false, cy: true },
    interruptEnabled: true, interruptDeferred: true, halted: true,
  }, machine.ports);
  machine.serial.write(0, 0x15); machine.serial.offer(0x41);
  const cpu = machine.cpu, state = cpu.snapshot(), serial = machine.serial.snapshot();
  const ram = machine.ram, memory = machine.memory, ports = machine.ports;
  const panel = createAltairMachinePanel(machine, () => true);
  setSwitches(panel, 0x37); panel.examine();
  assert.deepEqual(machine.cpu.snapshot(), { ...state, pc: 0x37 });
  panel.examineNext();
  assert.deepEqual(machine.cpu.snapshot(), { ...state, pc: 0x38 });
  assert.deepEqual([panel.address, panel.data], [0x38, 0]);
  assert.deepEqual(machine.serial.snapshot(), serial);
  assert.deepEqual(cpu.snapshot(), state);
  assert.equal(machine.ram, ram); assert.equal(machine.memory, memory); assert.equal(machine.ports, ports);
});

test("a panel-entered program executes on the same CPU wiring and reads live upper switches while running", () => {
  const session = new SerialSession(output => create8080AltairBasic({ serial: output }));
  const panel = createAltairMachinePanel(session.machine, () => !session.running);
  setSwitches(panel, 0x100); panel.examine();
  // IN FF / OUT 11 / JMP 0100: sense switches to the serial terminal, repeatedly.
  for (const [index, byte] of [0xdb, 0xff, 0xd3, 0x11, 0xc3, 0x00, 0x01].entries()) {
    setSwitches(panel, byte); index === 0 ? panel.deposit() : panel.depositNext();
  }
  setSwitches(panel, 0x100); panel.examine();
  session.machine.serial.write(0, 0x15);
  setSwitches(panel, 0x4123);
  session.start();
  const before = session.machine.cpu.snapshot();
  for (const action of ["examine", "examineNext", "deposit", "depositNext"] as const) {
    assert.throws(() => panel[action](), /STOP/);
    assert.deepEqual(session.machine.cpu.snapshot(), before);
    assert.equal(session.machine.ram.read(0x100), 0xdb);
  }
  const batch = session.run(3);
  assert.equal(batch.stopReason, "step-limit");
  assert.deepEqual(session.drainOutput(), [0x41]);
  setSwitches(panel, 0x42ff); // Changing switches does not need STOP or change PC.
  assert.equal(panel.address, 0x100);
  session.run(3);
  assert.deepEqual(session.drainOutput(), [0x42]);
  session.machine.sense.offer(0x7f);
  assert.equal(panel.switches, 0x7fff); // One shared upper bank, not two copies.
  session.stop();
});

test("reset follows a panel-restored CPU, preserves RAM and switches, and reload gets fresh panel state", () => {
  const session = new SerialSession(output => create8080AltairBasic({ serial: output }));
  const machine = session.machine, initialCpu = machine.cpu, reset = machine.reset;
  const panel = createAltairMachinePanel(machine, () => !session.running);
  setSwitches(panel, 0x200); panel.examine();
  setSwitches(panel, 0x0c76); panel.deposit();
  session.step(); // HLT at 0200: reset must release this CPU, not the factory's original one.
  const halted = machine.cpu.snapshot();
  assert.equal(halted.halted, true);
  machine.serial.write(0, 0x15); machine.serial.offer(0x55);
  const record = reset(); // The closure works even when detached from the instance.
  assert.deepEqual(record.before, halted);
  assert.equal(machine.cpu.snapshot().halted, false);
  assert.equal(machine.cpu.snapshot().pc, 0);
  assert.deepEqual(initialCpu.snapshot(), create8080AltairBasic({ serial() {} }).cpu.snapshot());
  assert.equal(machine.serial.snapshot().full, false);
  assert.deepEqual([panel.address, panel.switches, machine.ram.read(0x200)], [0, 0x0c76, 0x76]);
  session.reload();
  const fresh = createAltairMachinePanel(session.machine, () => !session.running);
  assert.deepEqual([fresh.address, fresh.data, fresh.switches], [0, 0x3e, 0]);
  assert.equal(session.machine.ram.read(0x200), 0);
  assert.equal(panel.switches, 0x0c76);
});
