import assert from "node:assert/strict";
import { test } from "node:test";
import { AltairSenseSwitches } from "../../../src/components/devices/generated/altair-sense-switches.js";

test("sense switches retain every position across reads and reset, with no guest write", () => {
  const sense = new AltairSenseSwitches(), other = new AltairSenseSwitches();
  assert.equal(sense.size, 1);
  assert.deepEqual(sense.snapshot(), { switches: 0 });
  for (let byte = 0; byte < 256; byte++) {
    assert.equal(sense.offer(byte), true);
    assert.equal(sense.read(0), byte); assert.equal(sense.read(0), byte);
    assert.equal(sense.write(0, byte ^ 255), "bus-error");
    sense.reset();
    assert.deepEqual(sense.snapshot(), { switches: byte });
    assert.equal(new AltairSenseSwitches(sense.snapshot()).read(0), byte);
  }
  assert.equal(other.read(0), 0);
});

test("sense-switch restoration copies state and rejects invalid host values before effects", () => {
  const initial = { switches: 12 }, sense = new AltairSenseSwitches(initial);
  initial.switches = 0;
  assert.equal(sense.read(0), 12);
  const before = sense.snapshot();
  sense.offer(42);
  assert.deepEqual(before, { switches: 12 });
  for (const value of [-1, 256, 0.5, NaN]) {
    assert.throws(() => sense.offer(value), RangeError);
    assert.throws(() => sense.write(0, value), RangeError);
    assert.throws(() => new AltairSenseSwitches({ switches: value }), RangeError);
  }
  for (const address of [-1, 1, 0.5, NaN]) {
    assert.throws(() => sense.read(address), RangeError);
    assert.throws(() => sense.write(address, 0), RangeError);
  }
  assert.deepEqual(sense.snapshot(), { switches: 42 });
});
