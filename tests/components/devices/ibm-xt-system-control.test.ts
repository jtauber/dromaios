import assert from "node:assert/strict";
import { test } from "node:test";
import { IbmXtSystemControl } from "../../../src/components/devices/generated/ibm-xt-system-control.js";

test("XT check controls clear each error independently; port A0 captures only bit 7", () => {
  for (const [parity, channel, status, clear] of [[true, false, 0x80, 0x10], [false, true, 0x40, 0x20]] as const) {
    const control = new IbmXtSystemControl();
    control.setErrors(parity, channel); // Released-high controls hold both checks clear.
    assert.equal(control.status(), 0);
    control.setControl(0); assert.equal(control.status(), status);
    control.setErrors(false, false); assert.equal(control.status(), status);
    assert.equal(control.nmiPending(), false);
    control.write(0, 0x7f); assert.equal(control.nmiPending(), false);
    control.write(0, 0x80); assert.equal(control.nmiPending(), true);
    control.acknowledgeNmi(); control.write(0, 0xff);
    assert.equal(control.nmiPending(), false); // A held high level is not another edge.
    control.setControl(clear ^ 0x30); assert.equal(control.status(), status);
    control.setControl(clear); assert.equal(control.status(), 0);
    control.setControl(0); control.setErrors(parity, channel);
    assert.equal(control.nmiPending(), true);
  }
});

test("XT NMI pending edges survive disable, status reads, and detached restoration", () => {
  const control = new IbmXtSystemControl(); control.setControl(0);
  control.write(0, 0x80); control.setErrors(true, true);
  const pending = control.snapshot(), restored = new IbmXtSystemControl(pending);
  assert.equal(restored.status(), 0xc0); assert.equal(restored.nmiPending(), true);
  assert.equal(restored.read(0), "bus-error"); assert.deepEqual(restored.snapshot(), pending);
  restored.write(0, 0); assert.equal(restored.nmiPending(), true);
  restored.setControl(0x30); assert.equal(restored.status(), 0);
  assert.equal(restored.nmiPending(), true);
  restored.acknowledgeNmi(); assert.equal(restored.nmiPending(), false);
  restored.write(0, 0x80); assert.equal(restored.nmiPending(), false);
  restored.setControl(0); assert.equal(restored.status(), 0xc0); // Inputs remain asserted.
  assert.equal(restored.nmiPending(), true);
  assert.deepEqual(control.snapshot(), pending);
  restored.reset(); assert.deepEqual(restored.snapshot(), new IbmXtSystemControl().snapshot());
});

test("XT system control rejects invalid or unsettled snapshots and inputs", () => {
  const control = new IbmXtSystemControl(), before = control.snapshot();
  assert.throws(() => new IbmXtSystemControl({ ...before, enabled: 1 } as never), TypeError);
  for (const invalid of [{ nmi_level: true }, { parity_error: true }, { channel_error: true }]) {
    assert.throws(() => new IbmXtSystemControl({ ...before, ...invalid }), /Invalid/);
  }
  assert.throws(() => new IbmXtSystemControl({ ...before, control: 0, parity_input: true }), /Invalid/);
  assert.throws(() => control.setControl(256), RangeError);
  assert.throws(() => control.setErrors(true, 1 as never), TypeError);
  assert.throws(() => control.write(0, -1), RangeError);
  assert.deepEqual(control.snapshot(), before);
});
