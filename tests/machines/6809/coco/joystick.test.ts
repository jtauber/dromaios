import assert from "node:assert/strict";
import { test } from "node:test";
import { CocoPias } from "../../../../src/machines/6809/coco/pias.js";
import { create6809Coco } from "../../../../src/machines/generated/6809/coco.js";

function ports(io: CocoPias): void {
  io.write(0x20, 0xfc); io.write(0x21, 4); // Six DAC output bits.
  io.write(1, 0x34); io.write(3, 0x34); // Port data, manual low selectors.
}

test("all four joystick axes compare against every DAC code, including equality and travel limits", () => {
  const io = new CocoPias(); ports(io);
  for (const port of ["right", "left"] as const) io.connectJoystick(port, true);
  for (const [port, vertical, select1, select2] of [
    ["right", false, 0x34, 0x34], ["right", true, 0x3c, 0x34],
    ["left", false, 0x34, 0x3c], ["left", true, 0x3c, 0x3c],
  ] as const) {
    io.write(1, select1); io.write(3, select2);
    for (let position = 0; position < 64; position++) {
      io.setJoystickPosition(port, vertical ? 7 : position, vertical ? position : 51);
      for (let dac = 0; dac < 64; dac++) {
        io.write(0x3c, dac * 4 + 3); // DAC alias, unrelated low bits high.
        assert.equal(io.read(0) >>> 7, Number(position >= dac));
      }
    }
  }
  io.setJoystickPosition("left", 64, 255);
  assert.deepEqual(io.joystick("left"), { x: 63, y: 63, connected: true, pressed: false });
});

test("conversion follows resolved DAC and selector pins independently of the sound enable", () => {
  const io = new CocoPias(); ports(io); io.connectJoystick("right", true);
  io.setJoystickPosition("right", 32, 0); io.write(0x20, 0x80);
  assert.equal(io.read(0) & 0x80, 0x80);
  io.write(0x21, 0); io.write(0x20, 0); // DAC pins released high, not ORA=$80.
  assert.equal(io.read(0) & 0x80, 0);
  io.write(0x20, 0xfc); io.write(0x21, 4);
  for (const sound of [0x34, 0x3c]) {
    io.write(0x23, sound); assert.equal(io.read(0) & 0x80, 0x80);
  }
  io.write(1, 0x3c); assert.equal(io.read(0) & 0x80, 0, "CA2 selects right Y");
  io.write(3, 4); assert.equal(io.read(0) & 0x80, 0x80, "released CB2 selects the disconnected left port");
  io.write(3, 0x34); io.connectJoystick("right", false);
  assert.equal(io.read(0) & 0x80, 0x80);
});

test("fire grounds PA0/PA1 and propagates through held keyboard switches without selecting a column", () => {
  const io = new CocoPias(); ports(io);
  io.connectJoystick("right", true); io.connectJoystick("left", true);
  for (const [right, left, rows] of [[false, false, 3], [true, false, 2], [false, true, 1], [true, true, 0]] as const) {
    io.setJoystickButton("right", right); io.setJoystickButton("left", left);
    assert.equal(io.read(0) & 3, rows);
  }
  io.setJoystickButton("left", false);
  io.setKey("A", true); io.setKey("I", true); // PA0↔PB1↔PA1: right fire grounds both rows.
  assert.equal(io.read(0) & 3, 0); assert.equal(io.read(2), 0xfd);
  io.releaseKeys(); assert.equal(io.read(0) & 3, 2); assert.equal(io.read(2), 0xff);
  io.connectJoystick("right", false); assert.equal(io.read(0) & 3, 3);
  io.connectJoystick("right", true); assert.equal(io.read(0) & 3, 2);
  io.releaseJoystickButtons(); assert.equal(io.read(0) & 3, 3);
});

test("joystick observations and snapshots preserve positions, held buttons and pending interrupts", () => {
  const machine = create6809Coco({ firmware: null, extended: null }), io = machine.pias; ports(io);
  io.connectJoystick("left", true); io.setJoystickPosition("left", 7, 46); io.setJoystickButton("left", true);
  io.write(1, 0x35); io.setHorizontalSync(false);
  const before = machine.snapshot();
  const view = io.joystick("left"); assert.deepEqual(view, { x: 7, y: 46, connected: true, pressed: true });
  assert.equal(io.irq, true); assert.deepEqual(machine.snapshot(), before);
  const restored = create6809Coco({ firmware: null, extended: null }, JSON.parse(JSON.stringify(before)));
  assert.deepEqual(restored.snapshot(), before); restored.reset(); assert.deepEqual(restored.pias.snapshot(), before.pias);
  io.reset(); assert.deepEqual(io.joystick("left"), view);
  const stable = io.snapshot();
  for (const invalid of [-1, 0.5, 256, NaN]) assert.throws(() => io.setJoystickPosition("left", 12, invalid));
  assert.throws(() => io.connectJoystick("left", 1 as never));
  assert.throws(() => io.setJoystickButton("left", 1 as never));
  assert.throws(() => io.joystick("middle" as never));
  assert.deepEqual(io.snapshot(), stable);
  assert.throws(() => new CocoPias({ ...stable, joysticks: undefined } as never), /joysticks/);
  assert.throws(() => new CocoPias({ ...stable, joysticks: { ...stable.joysticks, left: { ...view, x: 64 } } }));
  assert.throws(() => new CocoPias({ ...stable, pia0: { ...stable.pia0, input_a: 0xff } }), /wiring/);
  const fresh = new CocoPias();
  for (const port of ["right", "left"] as const) assert.deepEqual(fresh.joystick(port), { x: 32, y: 32, connected: false, pressed: false });
});
