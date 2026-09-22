import assert from "node:assert/strict";
import { test } from "node:test";
import { registerUpdates } from "../../../src/components/cpus/register-updates.js";

test("pending register reads are lazy, latest values retain first-stage order, and commits preserve the pending view", () => {
  const updates = registerUpdates(), writes: [string, number][] = [];
  let stored = 4, reads = 0;
  const read = () => { reads++; return stored; };
  assert.equal(updates.readPendingRegister("A", read), 4);
  stored = 5;
  assert.equal(updates.readPendingRegister("A", read), 5);
  updates.stageRegister("B", 9, value => { writes.push(["B", value]); });
  updates.stageRegister("A", 0, value => { stored = value; writes.push(["A", value]); });
  updates.stageRegister("B", 7, value => { writes.push(["B", value]); });
  assert.equal(updates.readPendingRegister("A", read), 0);
  assert.equal(reads, 2); assert.equal(stored, 5); assert.deepEqual(writes, []);
  updates.commit();
  assert.deepEqual(writes, [["B", 7], ["A", 0]]);
  stored = 10;
  assert.equal(updates.readPendingRegister("A", read), 0);
  updates.commit();
  assert.equal(stored, 0);
  assert.deepEqual(writes, [["B", 7], ["A", 0], ["B", 7], ["A", 0]]);
  assert.equal(registerUpdates().readPendingRegister("A", () => 12), 12);
});

test("failed commit preserves completed writes and stops before later registers", () => {
  for (const failed of [0, 1, 2]) {
    const updates = registerUpdates(), failure = Error("failed stored write"), writes: string[] = [], state = [0, 0, 0];
    for (let index = 0; index < 3; index++) updates.stageRegister(String(index), index + 1, value => {
      writes.push(String(index));
      if (index === failed) throw failure;
      state[index] = value;
    });
    assert.throws(() => updates.commit(), error => error === failure);
    assert.deepEqual(writes, ["0", "1", "2"].slice(0, failed + 1));
    assert.deepEqual(state, [1, 2, 3].map((value, index) => index < failed ? value : 0));
    assert.equal(updates.readPendingRegister(String(failed), () => assert.fail("Value remains staged")), failed + 1);
  }
});
