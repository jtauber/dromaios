import assert from "node:assert/strict";
import { test } from "node:test";
import { Mc6821 } from "../../../src/components/devices/generated/mc6821.js";

test("PIA latch writes survive input mode and become visible on direction changes", () => {
  for (const port of [0, 2]) {
    const pia = new Mc6821();
    pia.write(port + 1, 4); // Select data, with every pin still an input.
    pia.write(port, 0xa5);
    assert.equal(pia.read(port), 0xff);
    pia.write(port + 1, 0); pia.write(port, 0xf0);
    assert.equal(pia.read(port), 0xf0);
    assert.equal(port === 0 ? pia.driveA() : pia.driveB(), 0xaf);
    pia.write(port + 1, 4);
    assert.equal(pia.read(port), 0xaf);
    pia.setPortInputs(0x5a, 0x5a);
    assert.equal(pia.pinsA(), port === 0 ? 0x0a : 0x5a);
    assert.equal(pia.pinsB(), port === 2 ? 0x0a : 0x5a);
    assert.equal(pia.read(port), port === 0 ? 0x0a : 0xaa);
    pia.write(port + 1, 0); pia.write(port, 0xff);
    pia.setPortInputs(0xff, 0xff); pia.write(port + 1, 4);
    assert.equal(pia.read(port), 0xa5);
    pia.write(port, 0x80);
    assert.equal(port === 0 ? pia.driveA() : pia.driveB(), 0x80);
  }
});

test("PIA input readback preserves every byte and neither port leaks into the other", () => {
  const pia = new Mc6821(); pia.write(1, 4); pia.write(3, 4);
  for (let value = 0; value < 256; value++) {
    pia.setPortInputs(value, 255 - value);
    assert.equal(pia.read(0), value);
    assert.equal(pia.read(2), 255 - value);
  }
});

test("all four control inputs detect both edge polarities, latch while masked, and report current enables", () => {
  const inputs = [
    { method: "setCA1", control: 1, data: 0, flag: 0x80, falling: 4, rising: 6, enable: 1 },
    { method: "setCB1", control: 3, data: 2, flag: 0x80, falling: 4, rising: 6, enable: 1 },
    { method: "setCA2", control: 1, data: 0, flag: 0x40, falling: 4, rising: 0x14, enable: 8 },
    { method: "setCB2", control: 3, data: 2, flag: 0x40, falling: 4, rising: 0x14, enable: 8 },
  ] as const;
  for (const input of inputs) for (const rising of [false, true]) {
    const pia = new Mc6821(), control = rising ? input.rising : input.falling;
    pia.write(input.control, control);
    pia[input.method](!rising); // Initial inactive level (may be a non-selected edge).
    assert.equal(pia.read(input.control), control);
    pia[input.method](rising);
    assert.equal(pia.read(input.control), control + input.flag);
    assert.equal(pia.irq(), false);
    pia.write(input.control, control + input.enable);
    assert.equal(pia.irq(), true);
    assert.equal(pia.irqA(), input.control === 1);
    assert.equal(pia.irqB(), input.control === 3);
    pia.write(input.control, control); assert.equal(pia.irq(), false);
    pia.write(input.control, control + input.enable);
    pia.write(input.data, 0xff); // Data writes do not acknowledge.
    assert.equal(pia.irq(), true);
    pia.write(input.control, control + input.enable - 4); // DDR reads do not acknowledge.
    assert.equal(pia.read(input.data), 0);
    assert.equal(pia.irq(), true);
    pia.write(input.control, control + input.enable);
    pia.read(input.data);
    assert.equal(pia.read(input.control), control + input.enable);
    assert.equal(pia.irq(), false);
    pia[input.method](rising); // Holding the level cannot relatch.
    assert.equal(pia.irq(), false);
    pia[input.method](!rising); pia[input.method](rising);
    assert.equal(pia.irq(), true);
  }
});

test("PIA flags are independent and pure views neither acknowledge nor create an interrupt", () => {
  const pia = new Mc6821(); pia.write(1, 0x0d); pia.write(3, 0x0d);
  pia.setCA1(false); pia.setCA2(false); pia.setCB1(false); pia.setCB2(false);
  const saved = pia.snapshot();
  assert.equal(pia.controlA(), 0xcd); assert.equal(pia.controlB(), 0xcd);
  assert.equal(pia.pinsA(), 0xff); assert.equal(pia.pinsB(), 0xff);
  assert.equal(pia.dataB(), 0xff); assert.equal(pia.irq(), true);
  assert.deepEqual(pia.snapshot(), saved);
  pia.read(0);
  assert.equal(pia.controlA(), 0x0d); assert.equal(pia.controlB(), 0xcd);
  assert.equal(pia.irqA(), false); assert.equal(pia.irqB(), true);
  pia.read(2); assert.equal(pia.irq(), false);
  pia.write(1, 0x0f); // Change edge selection while CA1 remains low.
  assert.equal(pia.controlA(), 0x0f);
  pia.setCA1(false); assert.equal(pia.irq(), false);
});

test("C2 software outputs clear their flag and ignore external transitions until input mode returns", () => {
  for (const [control, set, high] of [[1, "setCA2", "ca2High"], [3, "setCB2", "cb2High"]] as const) {
    const pia = new Mc6821(); pia.write(control, 0x0c); pia[set](false);
    assert.equal(pia.irq(), true);
    pia.write(control, 0x34);
    assert.equal(pia.read(control), 0x34); assert.equal(pia.irq(), false);
    assert.equal(pia[high](), false);
    pia[set](true); pia[set](false);
    assert.equal(pia.read(control), 0x34);
    pia.write(control, 0x3c); assert.equal(pia[high](), true);
    pia.write(control, 0x0c); assert.equal(pia[high](), false);
    assert.equal(pia.irq(), false);
    pia[set](true); pia[set](false); assert.equal(pia.irq(), true);
  }
});

test("PIA control bytes ignore read-only bits, and unsupported strobes reject before mutation", () => {
  for (const control of [1, 3]) for (let byte = 0; byte < 256; byte++) {
    const pia = new Mc6821();
    const saved = pia.snapshot(), low = byte % 64;
    if (low >= 0x20 && low <= 0x2f) {
      assert.throws(() => pia.write(control, byte), /Unsupported/);
      assert.deepEqual(pia.snapshot(), saved);
    } else {
      pia.write(control, byte); assert.equal(pia.read(control), low);
    }
  }
});

test("PIA reset preserves external levels; snapshots retain pending flags and edge history", () => {
  const pia = new Mc6821(); pia.write(1, 0x0d); pia.write(3, 0x0d);
  pia.setPortInputs(0xaa, 0x55); pia.setCA1(false); pia.setCB2(false);
  const saved = pia.snapshot(), restored = new Mc6821(saved);
  pia.reset();
  assert.deepEqual(pia.snapshot(), {
    ora: 0, orb: 0, ddra: 0, ddrb: 0, cra: 0, crb: 0,
    input_a: 0xaa, input_b: 0x55, ca1: false, ca2: true, cb1: true, cb2: false,
    irqa1: false, irqa2: false, irqb1: false, irqb2: false,
  });
  assert.deepEqual(restored.snapshot(), saved);
  assert.equal(restored.irqA(), true); assert.equal(restored.irqB(), true);
  restored.read(0); restored.read(2);
  restored.setCA1(false); restored.setCB2(false); assert.equal(restored.irq(), false);
  restored.setCA1(true); restored.setCA1(false); assert.equal(restored.irqA(), true);
  assert.deepEqual(saved, { ...saved, irqa1: true, irqb2: true });
  assert.throws(() => new Mc6821({ ...saved, cra: 0x80 }), /Invalid/);
  assert.throws(() => new Mc6821({ ...saved, crb: 0x28 }), /Invalid/);
  assert.throws(() => new Mc6821({ ...saved, crb: 0x38 }), /Invalid/);
});

test("invalid PIA inputs and addresses are rejected before any effect", () => {
  const pia = new Mc6821(), saved = pia.snapshot();
  for (const value of [-1, 256, 0.5, NaN, Infinity]) {
    assert.throws(() => pia.setPortInputs(value, 0), RangeError);
    assert.throws(() => pia.setPortInputs(0, value), RangeError);
    assert.throws(() => pia.write(0, value), RangeError);
    assert.throws(() => pia.read(value), RangeError);
    assert.throws(() => new Mc6821({ ...saved, ora: value }), RangeError);
  }
  for (const input of ["setCA1", "setCA2", "setCB1", "setCB2"] as const) {
    assert.throws(() => pia[input](1 as never), TypeError);
  }
  assert.throws(() => pia.read(4), RangeError);
  assert.throws(() => pia.write(4, 0), RangeError);
  assert.deepEqual(pia.snapshot(), saved);
});
