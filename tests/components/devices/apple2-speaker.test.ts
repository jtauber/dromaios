import assert from "node:assert/strict";
import { test } from "node:test";
import { Apple2Speaker } from "../../../src/components/devices/generated/apple2-speaker.js";

test("all sixteen speaker aliases toggle on reads and on every written byte, independently of output level", () => {
  for (const level of [false, true]) for (let address = 0; address < 16; address++) {
    const speaker = new Apple2Speaker({ level });
    assert.equal(speaker.read(address), 0);
    assert.equal(speaker.level(), !level);
    for (let byte = 0; byte < 256; byte++) {
      speaker.write(address, byte);
      assert.equal(speaker.level(), byte % 2 ? !level : level);
    }
  }
});

test("inspection and reset preserve the speaker; restoration validates and owns its latch", () => {
  const speaker = new Apple2Speaker();
  assert.deepEqual(speaker.snapshot(), { level: false });
  speaker.read(15); const saved = speaker.snapshot(), restored = new Apple2Speaker(saved);
  assert.equal(speaker.level(), true); speaker.reset(); assert.deepEqual(speaker.snapshot(), saved);
  restored.write(0, 255); assert.equal(restored.level(), false); assert.equal(saved.level, true);
  for (const value of [undefined, 0, 1, null, "true"]) assert.throws(() => new Apple2Speaker({ level: value } as never));
  for (const address of [-1, 16, 0.5, NaN, Infinity]) {
    assert.throws(() => speaker.read(address), RangeError);
    assert.throws(() => speaker.write(address, 0), RangeError);
  }
  for (const value of [-1, 256, 0.5, NaN, Infinity]) assert.throws(() => speaker.write(0, value), RangeError);
  assert.deepEqual(speaker.snapshot(), saved);
});
